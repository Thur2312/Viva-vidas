import { Injectable } from '@nestjs/common'
import { ChatGatewayService, NumberHealthInfo } from '../../chat-gateway/chat-gateway.service'
import { PgService } from '../pg.service'
import { PilotService } from '../pilot.service'
import { AuditService } from '../compliance/audit.service'
import { HEALTH_POLL_MS, HEALTH_REASON_LABELS, HealthSnapshot, HealthVerdict, dailyLimitOf, evaluateHealth } from './health-policy'

export const HEALTH_PAUSE_REASON = 'saude_numero'

@Injectable()
export class HealthService {
  private lastError: string | null = null
  private lastAttempt = 0

  constructor(
    private readonly pg: PgService,
    private readonly pilot: PilotService,
    private readonly gateway: ChatGatewayService,
    private readonly audit: AuditService,
  ) {}

  private get tenant() { return this.pilot.tenant }

  async lastTwo(): Promise<HealthSnapshot[]> {
    return (await this.pg.query(`SELECT * FROM horizon_agent.number_health_snapshots WHERE tenant = $1 ORDER BY checked_at DESC, id DESC LIMIT 2`, [this.tenant])).rows
  }

  async history(days = 14) {
    return (
      await this.pg.query(
        `SELECT checked_at, quality_rating, limit_tier, daily_limit, status FROM horizon_agent.number_health_snapshots
         WHERE tenant = $1 AND checked_at > now() - ($2 || ' days')::interval ORDER BY checked_at ASC, id ASC LIMIT 1500`,
        [this.tenant, String(days)],
      )
    ).rows
  }

  async runningCount(): Promise<number> {
    return Number((await this.pg.query(`SELECT count(*)::int n FROM horizon_agent.broadcasts WHERE tenant = $1 AND status = 'running' AND dry_run = false`, [this.tenant])).rows[0]?.n ?? 0)
  }

  async verdict(strict: boolean, now = new Date()): Promise<HealthVerdict> {
    const [latest, previous] = await this.lastTwo()
    return evaluateHealth({ latest: latest ?? null, previous: previous ?? null, now, strict })
  }

  async record(info: NumberHealthInfo, source: 'poll' | 'webhook' = 'poll') {
    const q = ['GREEN', 'YELLOW', 'RED'].includes(info.qualityRating) ? info.qualityRating : 'UNKNOWN'
    const tier = info.limitTier || 'UNKNOWN'
    await this.pg.query(
      `INSERT INTO horizon_agent.number_health_snapshots (tenant, source, quality_rating, limit_tier, daily_limit, status, account_review_status, raw)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
      [this.tenant, source, q, tier, dailyLimitOf(tier, info.dailyLimit), info.status ?? null, info.accountReviewStatus ?? null,
        JSON.stringify({ nameStatus: info.nameStatus ?? null })],
    )
  }

  /** Lê do chat e grava. Sem valores inventados: em falha só guarda o motivo (nenhuma linha nova). */
  async refresh(): Promise<{ ok: boolean; error?: string }> {
    this.lastAttempt = Date.now()
    const r = await this.gateway.numberHealth()
    if ('error' in r) { this.lastError = r.error; return { ok: false, error: r.error } }
    this.lastError = null
    await this.record(r.data, 'poll')
    return { ok: true }
  }

  /** Só consulta com chat configurado e envio real habilitado (sem isso não há o que proteger). */
  async pollIfDue(enabled: boolean, now = Date.now()): Promise<void> {
    if (!enabled || !this.gateway.configured()) return
    const [latest] = await this.lastTwo()
    const age = latest ? now - new Date(latest.checked_at).getTime() : Infinity
    if (age >= HEALTH_POLL_MS && now - this.lastAttempt >= 60_000) await this.refresh()
  }

  /** Aviso da Meta (phone_number_quality_update) encaminhado pelo chat. Se a releitura falhar num rebaixamento, falha FECHADO (vermelho). */
  async onQualityWebhook(event: string, currentLimit?: string) {
    const r = await this.refresh()
    if (!r.ok && /DOWNGRADE|FLAGGED/i.test(event)) {
      await this.record({ qualityRating: 'RED', limitTier: currentLimit && /^TIER_/.test(currentLimit) ? currentLimit : 'UNKNOWN', dailyLimit: null, status: 'WEBHOOK_REBAIXAMENTO', nameStatus: null, accountReviewStatus: null, checkedAt: new Date().toISOString() }, 'webhook')
    }
    return { received: true }
  }

  /** Pausa todo disparo real em andamento se a política mandar bloquear. Retorna quantos pausou. Auditoria sem dados pessoais. */
  async enforce(now = new Date()): Promise<number> {
    const running = await this.pg.query(`SELECT id FROM horizon_agent.broadcasts WHERE tenant = $1 AND status = 'running' AND dry_run = false`, [this.tenant])
    if (!running.rowCount) return 0
    const v = await this.verdict(true, now)
    if (v.state !== 'block') return 0
    let n = 0
    for (const row of running.rows) {
      const r = await this.pg.query(`UPDATE horizon_agent.broadcasts SET status = 'paused', paused_reason = $2, updated_at = now() WHERE id = $1 AND status = 'running'`, [row.id, HEALTH_PAUSE_REASON])
      if (r.rowCount) {
        n++
        await this.audit.log({ actor: 'sistema', action: 'broadcast.autopause', entity: 'broadcast', entityId: row.id, details: { reason: HEALTH_PAUSE_REASON, reasons: v.reasons } })
      }
    }
    return n
  }

  async overview() {
    const [latest, previous] = await this.lastTwo()
    const running = await this.runningCount()
    const verdict = evaluateHealth({ latest: latest ?? null, previous: previous ?? null, now: new Date(), strict: running > 0 })
    const paused = (await this.pg.query(`SELECT id, name FROM horizon_agent.broadcasts WHERE tenant = $1 AND status = 'paused' AND paused_reason = $2`, [this.tenant, HEALTH_PAUSE_REASON])).rows
    const chat = this.gateway.status()
    return {
      chat: { configured: chat.configured, missing: chat.missing },
      latest: latest ? {
        checkedAt: latest.checked_at, qualityRating: latest.quality_rating, limitTier: latest.limit_tier, dailyLimit: latest.daily_limit,
        status: latest.status, accountReviewStatus: (latest as any).account_review_status ?? null,
      } : null,
      history: (await this.history(14)).map((h: any) => ({ checkedAt: h.checked_at, qualityRating: h.quality_rating, limitTier: h.limit_tier, dailyLimit: h.daily_limit, status: h.status })),
      verdict: { ...verdict, labels: verdict.reasons.map((r) => HEALTH_REASON_LABELS[r]) },
      lastError: this.lastError,
      autoPaused: paused.map((p: any) => ({ id: p.id, name: p.name })),
      pollEveryMinutes: HEALTH_POLL_MS / 60_000,
    }
  }
}
