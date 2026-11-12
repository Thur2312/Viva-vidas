import { Injectable, Logger } from '@nestjs/common'
import { Interval } from '@nestjs/schedule'
import { ChatGatewayService } from '../../chat-gateway/chat-gateway.service'
import { PgService } from '../pg.service'
import { PilotService } from '../pilot.service'
import { AuditService } from '../compliance/audit.service'
import { AdvisoryLockService } from './advisory-lock.service'
import { BroadcastsService, BroadcastCtx, broadcastsEnabled, decideRecipient, globalDailyCap, loadLeadFacts } from './broadcasts.service'
import { LeadFacts } from './gates'
import { TemplatesService } from './templates.service'
import { HealthService } from './health.service'
import { effectiveDailyCap, effectiveRate } from './health-policy'
import { countVariables, renderPreview, resolveVariables } from './template-rules'
import {
  MAX_ATTEMPTS, STALE_CLAIM_MS, TICK_MS, WindowSpec, backoffMs, batchBudget, inSendWindow, isTransientStatus, parseGatewayStatus,
  shouldAutoPause, startOfLocalDay,
} from './throttle'

export const LOCK_KEY = 7_204_006
const CONVERSION_REFRESH_MS = 5 * 60_000

interface Counters { sent: number; failed: number; skipped: number; simulated: number }

/**
 * Worker de envio. A cada ciclo (15s), sob trava consultiva (uma instância por vez):
 * promove agendados, recupera "em fila" abandonado (marca falha, NUNCA reenvia: no máximo uma vez),
 * e para cada disparo em andamento aplica janela, vazão, portas por destinatário e auto-pausa.
 * Sem BROADCASTS_ENABLED=true só os disparos em simulação (dry_run) são processados.
 */
@Injectable()
export class BroadcastsWorker {
  private readonly log = new Logger('BroadcastsWorker')
  private busy = false
  private lastConversionRefresh = 0

  constructor(
    private readonly pg: PgService,
    private readonly pilot: PilotService,
    private readonly audit: AuditService,
    private readonly lock: AdvisoryLockService,
    private readonly gateway: ChatGatewayService,
    private readonly templates: TemplatesService,
    private readonly service: BroadcastsService,
    private readonly health: HealthService,
  ) {}

  @Interval(TICK_MS)
  async onInterval() {
    if (process.env.NODE_ENV === 'test' || process.env.BROADCASTS_WORKER === 'off') return
    await this.tick()
  }

  async tick(now: Date = new Date()): Promise<{ ran: boolean }> {
    if (this.busy) return { ran: false }
    this.busy = true
    try {
      const r = await this.lock.withLock(LOCK_KEY, () => this.runOnce(now))
      return { ran: r.ran }
    } catch (e: any) {
      this.log.warn(`ciclo falhou: ${String(e?.message ?? e).slice(0, 120)}`) // sem dados pessoais
      return { ran: false }
    } finally {
      this.busy = false
    }
  }

  async runOnce(now: Date) {
    const tenant = this.pilot.tenant
    await this.recoverStale()
    await this.pg.query(
      `UPDATE horizon_agent.broadcasts SET status = 'running', updated_at = now()
       WHERE tenant = $1 AND status = 'scheduled' AND scheduled_at <= $2`, [tenant, now])
    const enabled = broadcastsEnabled()
    // Saúde do número: lê a cada 15 min e pausa tudo se a política mandar (desconhecido = inseguro).
    await this.health.pollIfDue(enabled).catch(() => undefined)
    if (enabled) await this.health.enforce(now)
    const rows = (
      await this.pg.query(`SELECT * FROM horizon_agent.broadcasts WHERE tenant = $1 AND status = 'running' ORDER BY started_at`, [tenant])
    ).rows
    for (const b of rows) {
      if (!enabled && !b.dry_run) continue // interruptor geral desligado: nada de envio real
      if (b.backoff_until && new Date(b.backoff_until) > now) continue
      try { await this.processBroadcast(b, now) } catch (e: any) {
        this.log.warn(`disparo ${b.id}: ${String(e?.message ?? e).slice(0, 120)}`)
      }
    }
    if (Date.now() - this.lastConversionRefresh > CONVERSION_REFRESH_MS) {
      this.lastConversionRefresh = Date.now()
      await this.refreshConversions(tenant).catch(() => undefined)
    }
  }

  /** "Em fila" há mais de 5 min = o processo morreu no meio. Não sabemos se a Meta recebeu: marca falha, jamais reenvia. */
  async recoverStale() {
    await this.pg.query(
      `UPDATE horizon_agent.broadcast_recipients SET status = 'failed', error_code = 'envio_interrompido', processed_at = now()
       WHERE status = 'queued' AND claimed_at < now() - ($1 || ' milliseconds')::interval`,
      [String(STALE_CLAIM_MS)],
    )
  }

  async refreshConversions(tenant: string) {
    await this.pg.query(
      `UPDATE horizon_agent.broadcast_recipients r SET converted_at = (
         SELECT min(e.occurred_at) FROM horizon_agent.lead_events e
         WHERE e.lead_id = r.lead_id AND e.type IN ('reuniao_marcada','venda') AND e.occurred_at >= r.sent_at AND e.occurred_at <= r.sent_at + interval '30 days')
       FROM horizon_agent.broadcasts b
       WHERE b.id = r.broadcast_id AND b.tenant = $1 AND b.dry_run = false AND r.converted_at IS NULL AND r.sent_at IS NOT NULL
         AND r.status IN ('sent','delivered','read','replied') AND r.sent_at > now() - interval '30 days'
         AND EXISTS (SELECT 1 FROM horizon_agent.lead_events e WHERE e.lead_id = r.lead_id AND e.type IN ('reuniao_marcada','venda') AND e.occurred_at >= r.sent_at)`,
      [tenant],
    )
  }

  private windowOf(b: any): WindowSpec {
    return { timezone: b.timezone, start: b.window_start, end: b.window_end, days: b.window_days }
  }

  async pauseBroadcast(b: any, reason: string, action = 'broadcast.autopause', details: Record<string, unknown> = {}) {
    const r = await this.pg.query(
      `UPDATE horizon_agent.broadcasts SET status = 'paused', paused_reason = $2, updated_at = now() WHERE id = $1 AND status = 'running'`, [b.id, reason])
    if (r.rowCount) await this.audit.log({ actor: 'sistema', action, entity: 'broadcast', entityId: b.id, details: { reason, ...details } })
  }

  async processBroadcast(b: any, now: Date) {
    if (!inSendWindow(now, this.windowOf(b))) return

    // Template aprovado NO MOMENTO do envio (e com status conhecido). Simulação não exige.
    let bodyText: string | null = b.text_body
    let category: 'MARKETING' | 'UTILITY' = b.template_category ?? 'MARKETING'
    if (b.kind === 'template') {
      if (!b.dry_run) {
        const t = await this.templates.ensureFresh(b.template_name, b.template_language)
        if (!t) return this.pauseBroadcast(b, 'template_nao_verificado')
        if (t.status !== 'APPROVED') return this.pauseBroadcast(b, 'template_nao_aprovado', 'broadcast.autopause', { status: t.status })
        bodyText = t.body_text
        category = t.category === 'UTILITY' ? 'UTILITY' : 'MARKETING'
      } else {
        const t = await this.service.resolveTemplate(b)
        bodyText = t?.bodyText ?? null
        category = t?.category ?? 'MARKETING'
      }
    }
    if (!bodyText) return this.pauseBroadcast(b, 'corpo_desconhecido')
    if (!b.dry_run && !this.gateway.configured()) return this.pauseBroadcast(b, 'chat_nao_configurado')

    // Vazão
    const tz = b.timezone
    const q = async (sql: string, p: any[]) => Number((await this.pg.query(sql, p)).rows[0].n)
    const sentLast60s = await q(`SELECT count(*)::int n FROM horizon_agent.broadcast_recipients WHERE broadcast_id = $1 AND processed_at > $2`, [b.id, new Date(now.getTime() - 60_000)])
    const dayStart = startOfLocalDay(now, tz)
    const sentToday = await q(`SELECT count(*)::int n FROM horizon_agent.broadcast_recipients WHERE broadcast_id = $1 AND sent_at >= $2`, [b.id, dayStart])
    let globalRemaining: number | undefined
    let gToday = 0
    if (!b.dry_run) {
      gToday = await q(
        `SELECT count(*)::int n FROM horizon_agent.broadcast_recipients r JOIN horizon_agent.broadcasts x ON x.id = r.broadcast_id
         WHERE x.tenant = $1 AND x.dry_run = false AND r.sent_at >= $2`, [this.pilot.tenant, dayStart])
      globalRemaining = globalDailyCap() - gToday
    }
    let ratePerMinute = b.rate_per_minute
    let dailyCap = b.daily_cap
    if (!b.dry_run) {
      // limite real do número e velocidade pela metade em qualidade amarela
      const v = await this.health.verdict(true, now)
      if (v.state === 'block') return this.pauseBroadcast(b, 'saude_numero', 'broadcast.autopause', { reasons: v.reasons })
      ratePerMinute = effectiveRate(ratePerMinute, v.rateFactor)
      dailyCap = effectiveDailyCap(dailyCap, v.dailyLimit)
      if (v.dailyLimit != null) globalRemaining = Math.min(globalDailyCap(), v.dailyLimit) - gToday // limite real do número vale para todos os disparos juntos
    }
    const budget = batchBudget({ ratePerMinute, sentLast60s, dailyCap, sentToday, globalRemaining })
    if (budget <= 0) return

    // Reivindicação atômica: um destinatário só é pego por UM worker (e por isso nunca enviado duas vezes).
    const claimed = (
      await this.pg.query(
        `UPDATE horizon_agent.broadcast_recipients SET status = 'queued', claimed_at = now(), attempts = attempts + 1
         WHERE id IN (
           SELECT id FROM horizon_agent.broadcast_recipients
           WHERE broadcast_id = $1 AND status = 'pending' AND (next_attempt_at IS NULL OR next_attempt_at <= now())
           ORDER BY id LIMIT $2 FOR UPDATE SKIP LOCKED)
         RETURNING id, lead_id, attempts`,
        [b.id, budget],
      )
    ).rows as { id: string; lead_id: string; attempts: number }[]

    const counters: Counters = { sent: 0, failed: 0, skipped: 0, simulated: 0 }
    if (claimed.length) {
      const facts = new Map<string, LeadFacts>(
        (await loadLeadFacts(this.pg, this.pilot.tenant, 'l.id = ANY($2::uuid[])', [claimed.map((c) => c.lead_id)])).map((f) => [f.id, f]),
      )
      const ctx: BroadcastCtx = {
        kind: b.kind, category, variablesMap: b.variables_map, varCount: countVariables(bodyText), now,
      }
      let stop = false
      const t0 = Date.now()
      const clock = () => new Date(now.getTime() + (Date.now() - t0)) // relógio do ciclo (respeita o `now` recebido)
      for (const r of claimed) {
        if (stop) { await this.release(r.id); continue }
        if (!inSendWindow(clock(), this.windowOf(b))) { await this.release(r.id); stop = true; continue } // janela fechou no meio do lote
        const f = facts.get(r.lead_id)
        // Portas de novo, na hora do envio (o consentimento pode ter sido revogado depois do início).
        const reason = decideRecipient(f, { ...ctx, now: clock() })
        if (reason) {
          await this.pg.query(`UPDATE horizon_agent.broadcast_recipients SET status = 'skipped', skip_reason = $2 WHERE id = $1 AND status = 'queued'`, [r.id, reason])
          counters.skipped++
          continue
        }
        if (b.dry_run) {
          await this.pg.query(
            `UPDATE horizon_agent.broadcast_recipients SET status = 'sent', sent_at = now(), processed_at = now(), wid = NULL, error_code = NULL WHERE id = $1 AND status = 'queued'`, [r.id])
          counters.simulated++
          continue
        }
        const vars = resolveVariables(b.variables_map, ctx.varCount, f!)!
        try {
          const res = b.kind === 'template'
            ? await this.gateway.sendTemplate({ phone: f!.phone!, templateName: b.template_name, language: b.template_language, variables: vars, requestedBy: `disparo:${b.id}` })
            : await this.gateway.sendText({ phone: f!.phone!, body: renderPreview(bodyText, vars), requestedBy: `disparo:${b.id}` })
          await this.pg.query(
            `UPDATE horizon_agent.broadcast_recipients SET status = 'sent', wid = $2, sent_at = now(), processed_at = now(), error_code = NULL WHERE id = $1 AND status = 'queued'`,
            [r.id, res.wid],
          )
          counters.sent++
        } catch (e: any) {
          const httpStatus: number | undefined = typeof e?.getStatus === 'function' ? e.getStatus() : undefined
          if (httpStatus === 503) { // chat não configurado: nada foi enviado; devolve à fila e pausa
            await this.release(r.id)
            await this.pauseBroadcast(b, 'chat_nao_configurado')
            stop = true
            continue
          }
          const status = parseGatewayStatus(e?.message)
          if (isTransientStatus(status) && r.attempts < MAX_ATTEMPTS) {
            const wait = backoffMs(r.attempts)
            const until = new Date(Date.now() + wait)
            await this.pg.query(
              `UPDATE horizon_agent.broadcast_recipients SET status = 'pending', next_attempt_at = $2, claimed_at = NULL WHERE id = $1 AND status = 'queued'`, [r.id, until])
            await this.pg.query(`UPDATE horizon_agent.broadcasts SET backoff_until = $2 WHERE id = $1`, [b.id, until])
            stop = true // espera o backoff antes de continuar com o disparo
          } else {
            await this.pg.query(
              `UPDATE horizon_agent.broadcast_recipients SET status = 'failed', error_code = $2, processed_at = now() WHERE id = $1 AND status = 'queued'`,
              [r.id, status ? `chat_${status}` : 'chat_timeout'],
            )
            counters.failed++
          }
        }
      }
    }

    if (counters.sent + counters.failed + counters.skipped + counters.simulated > 0) {
      await this.audit.log({ actor: 'sistema', action: 'broadcast.batch', entity: 'broadcast', entityId: b.id, details: { ...counters, dryRun: b.dry_run } })
    }
    if (!b.dry_run) await this.checkAutoPause(b)
    await this.completeIfDone(b.id)
  }

  private release(id: string) {
    return this.pg.query(
      `UPDATE horizon_agent.broadcast_recipients SET status = 'pending', claimed_at = NULL, attempts = greatest(attempts - 1, 0) WHERE id = $1 AND status = 'queued'`, [id])
  }

  /** Qualidade do número: mais de 30% de falha nos últimos 20 envios (depois da última retomada) pausa o disparo. */
  async checkAutoPause(b: any) {
    const cur = (await this.pg.query(`SELECT status, resumed_at FROM horizon_agent.broadcasts WHERE id = $1`, [b.id])).rows[0]
    if (!cur || cur.status !== 'running') return
    const rows = (
      await this.pg.query(
        `SELECT (status = 'failed') AS failed FROM horizon_agent.broadcast_recipients
         WHERE broadcast_id = $1 AND processed_at IS NOT NULL AND status IN ('sent','delivered','read','replied','failed')
           AND ($2::timestamptz IS NULL OR processed_at > $2)
         ORDER BY processed_at DESC, id DESC LIMIT 20`,
        [b.id, cur.resumed_at],
      )
    ).rows
    const d = shouldAutoPause(rows.map((r: any) => r.failed === true))
    if (d.pause) await this.pauseBroadcast(b, 'taxa_falha_alta', 'broadcast.autopause', { rate: Math.round(d.rate * 100), samples: d.samples })
  }

  async completeIfDone(id: string) {
    const open = Number((await this.pg.query(`SELECT count(*)::int n FROM horizon_agent.broadcast_recipients WHERE broadcast_id = $1 AND status IN ('pending','queued')`, [id])).rows[0].n)
    if (open > 0) return
    await this.pg.query(
      `UPDATE horizon_agent.broadcasts SET status = 'completed', finished_at = now(), updated_at = now(),
         counts = coalesce((SELECT jsonb_object_agg(status, n) FROM (SELECT status, count(*)::int n FROM horizon_agent.broadcast_recipients WHERE broadcast_id = $1 GROUP BY status) s), '{}'::jsonb)
       WHERE id = $1 AND status = 'running'`, [id])
  }
}
