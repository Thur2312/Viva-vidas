import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { Interval } from '@nestjs/schedule'
import { Db, PgService } from '../pilot/pg.service'
import { PilotService } from '../pilot/pilot.service'
import { AuditService, RequestCtx } from '../pilot/compliance/audit.service'
import { registerSubjectHook } from '../pilot/compliance/subject-hooks'
import { AdvisoryLockService } from '../pilot/broadcasts/advisory-lock.service'
import { BATCH_SIZE, MAX_ATTEMPTS, STALE_CLAIM_MS, TICK_MS, backoffMs, crmEnabled, dealTitle, isTransient, parseStageMap, planFor, safeError } from './crm.rules'
import { CRM_ADAPTER, CrmAdapter, CrmNotConfiguredError } from './crm.types'

export const CRM_LOCK_KEY = 7_204_008

/**
 * Worker da fila do CRM. A cada ciclo, sob trava consultiva (uma instancia por vez): devolve a fila o que ficou
 * "em processamento" de um processo que morreu, pega o item MAIS ANTIGO de cada lead (a ordem dos eventos de um
 * lead e preservada) e envia ao CRM. Falha de rede/429/5xx: nova tentativa com espera crescente; 4xx: vai direto
 * para "dead" (visivel no painel, reenvio manual pelo dono). As chamadas ao CRM sao idempotentes, entao reprocessar
 * apos uma queda no meio nao duplica pessoa nem negocio.
 */
@Injectable()
export class CrmService implements OnModuleInit {
  private readonly log = new Logger('CrmSync')
  private busy = false

  constructor(
    private readonly pg: PgService,
    private readonly pilot: PilotService,
    private readonly audit: AuditService,
    private readonly lock: AdvisoryLockService,
    @Inject(CRM_ADAPTER) private readonly crm: CrmAdapter,
  ) {}

  onModuleInit() {
    // Direito de exclusao (LGPD): antes de apagar o lead, apaga a pessoa no CRM. Falha ALTO: se nao conseguir,
    // o pedido do titular fica em andamento (e nao some do CRM sem ninguem saber).
    registerSubjectHook({
      name: 'crm',
      eraseLead: async (leadId, _ctx, db) => {
        const personId = await this.personIdOf(leadId, db)
        if (!personId) return { crm_pessoas: 0 }
        await this.crm.deletePerson(personId) // nao configurado => lanca, de proposito
        return { crm_pessoas: 1 }
      },
    })
  }

  @Interval(TICK_MS)
  async onInterval() {
    if (process.env.NODE_ENV === 'test' || process.env.CRM_WORKER === 'off' || !crmEnabled()) return
    await this.tick()
  }

  async tick(now: Date = new Date()): Promise<{ ran: boolean }> {
    if (this.busy) return { ran: false }
    this.busy = true
    try {
      if (!this.crm.status().configured) return { ran: false } // ligado mas sem credencial: a fila acumula e o status avisa
      const r = await this.lock.withLock(CRM_LOCK_KEY, () => this.runOnce(now))
      return { ran: r.ran }
    } catch (e) {
      this.log.warn(`ciclo falhou: ${safeError(e)}`) // sem dados pessoais
      return { ran: false }
    } finally {
      this.busy = false
    }
  }

  async runOnce(now: Date) {
    const tenant = this.pilot.tenant
    await this.pg.query(
      `UPDATE horizon_agent.crm_outbox SET status = 'pending', claimed_at = NULL
       WHERE tenant = $1 AND status = 'processing' AND claimed_at < now() - ($2 || ' milliseconds')::interval`,
      [tenant, String(STALE_CLAIM_MS)],
    )
    const { rows } = await this.pg.query(
      `UPDATE horizon_agent.crm_outbox o SET status = 'processing', claimed_at = now(), attempts = o.attempts + 1
       WHERE o.id IN (
         SELECT c.id FROM horizon_agent.crm_outbox c
         WHERE c.tenant = $1 AND c.status = 'pending' AND c.next_attempt_at <= $2
           AND NOT EXISTS (SELECT 1 FROM horizon_agent.crm_outbox p WHERE p.lead_id = c.lead_id AND p.id < c.id AND p.status IN ('pending','processing'))
         ORDER BY c.id LIMIT $3 FOR UPDATE SKIP LOCKED)
       RETURNING o.*`,
      [tenant, now, BATCH_SIZE],
    )
    for (const item of rows) await this.process(item, now)
    return { processed: rows.length }
  }

  private async process(item: any, now: Date) {
    try {
      const lead = (await this.pg.query(`SELECT id, name, phone, opt_out, anonymized_at, pipedrive_ids FROM horizon_agent.leads WHERE id = $1`, [item.lead_id])).rows[0]
      if (!lead) return this.finish(item.id, 'skipped', 'lead_inexistente')
      const ids = { ...(lead.pipedrive_ids ?? {}) } as { person_id?: number; deal_id?: number }
      const plan = planFor(item.event_type, item.value == null ? null : Number(item.value), lead, ids, parseStageMap(process.env.PIPEDRIVE_STAGE_MAP))
      if (plan.skip) return this.finish(item.id, 'skipped', plan.skip)

      if (plan.ensurePerson && !ids.person_id) {
        ids.person_id = (await this.crm.findPersonByPhone(lead.phone)) ?? (await this.crm.createPerson({ name: lead.name, phone: lead.phone }))
        await this.saveIds(lead.id, ids) // grava ja: se cair depois daqui, a nova tentativa reaproveita e nao duplica
      }
      if (plan.ensureDeal && !ids.deal_id && ids.person_id) {
        ids.deal_id = (await this.crm.findOpenDeal(ids.person_id)) ?? (await this.crm.createDeal(ids.person_id, { title: dealTitle(lead.name), stageId: plan.stageId, value: plan.value }))
        await this.saveIds(lead.id, ids)
      }
      if (ids.deal_id) {
        await this.crm.updateDeal(ids.deal_id, { stageId: plan.stageId, status: plan.status, value: plan.value })
        if (plan.note) await this.crm.addNote(ids.deal_id, plan.note)
      }
      await this.finish(item.id, 'sent', null)
    } catch (e) {
      await this.fail(item, e, now)
    }
  }

  private async fail(item: any, e: unknown, now: Date) {
    const err = safeError(e)
    if (e instanceof CrmNotConfiguredError) {
      // Credencial sumiu no meio: devolve sem gastar tentativa.
      await this.pg.query(`UPDATE horizon_agent.crm_outbox SET status = 'pending', attempts = attempts - 1, claimed_at = NULL, last_error = $2, next_attempt_at = $3 WHERE id = $1`, [item.id, err, new Date(now.getTime() + 60_000)])
      return
    }
    if (isTransient(e) && item.attempts < MAX_ATTEMPTS) {
      await this.pg.query(`UPDATE horizon_agent.crm_outbox SET status = 'pending', claimed_at = NULL, last_error = $2, next_attempt_at = $3 WHERE id = $1`, [item.id, err, new Date(now.getTime() + backoffMs(item.attempts))])
      return
    }
    await this.finish(item.id, 'dead', err)
    this.log.warn(`item ${item.id} foi para dead: ${err}`)
  }

  private finish(id: number | string, status: 'sent' | 'skipped' | 'dead', note: string | null) {
    return this.pg.query(
      `UPDATE horizon_agent.crm_outbox SET status = $2, last_error = $3, claimed_at = NULL, sent_at = CASE WHEN $2 = 'sent' THEN now() ELSE sent_at END WHERE id = $1`,
      [id, status, note],
    )
  }

  private saveIds(leadId: string, ids: object) {
    return this.pg.query(`UPDATE horizon_agent.leads SET pipedrive_ids = $2::jsonb WHERE id = $1`, [leadId, JSON.stringify(ids)])
  }

  private async personIdOf(leadId: string, db: Db): Promise<number | null> {
    const r = (await db.query(`SELECT pipedrive_ids FROM horizon_agent.leads WHERE id = $1`, [leadId])).rows[0]
    const id = Number(r?.pipedrive_ids?.person_id)
    return Number.isInteger(id) && id > 0 ? id : null
  }

  // ───────────── Painel ─────────────
  async status() {
    const counts = (await this.pg.query(`SELECT status, count(*)::int n FROM horizon_agent.crm_outbox WHERE tenant = $1 GROUP BY status`, [this.pilot.tenant])).rows
    const by = Object.fromEntries(counts.map((r: any) => [r.status, r.n]))
    return { enabled: crmEnabled(), ...this.crm.status(), queue: { pending: by.pending ?? 0, processing: by.processing ?? 0, sent: by.sent ?? 0, skipped: by.skipped ?? 0, dead: by.dead ?? 0 } }
  }

  /** O dono reenfileira o que foi para "dead" depois de corrigir a causa (ex.: token trocado). */
  async retryDead(ctx: RequestCtx) {
    const r = await this.pg.query(`UPDATE horizon_agent.crm_outbox SET status = 'pending', attempts = 0, next_attempt_at = now(), last_error = NULL WHERE tenant = $1 AND status = 'dead'`, [this.pilot.tenant])
    await this.audit.log({ ...ctx, action: 'crm.retry_dead', entity: 'crm_outbox', details: { requeued: r.rowCount ?? 0 } })
    return { requeued: r.rowCount ?? 0 }
  }
}
