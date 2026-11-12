import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common'
import { ChatGatewayService } from '../../chat-gateway/chat-gateway.service'
import { Db, PgService } from '../pg.service'
import { PilotService, STAGES } from '../pilot.service'
import { AuditService, RequestCtx } from '../compliance/audit.service'
import { maskPhone } from '../compliance/phone'
import { BroadcastBodyDto, CreateBroadcastDto, PreviewDto, RecipientsQuery, StartDto } from './broadcasts.dto'
import { DEFAULT_FREQUENCY_DAYS, GateContext, LeadFacts, SKIP_LABELS, SkipReason, decideLead, summarizeReasons } from './gates'
import { CachedTemplate, TemplatesService } from './templates.service'
import { HealthService } from './health.service'
import { HEALTH_REASON_LABELS, HEALTH_STALE_MS } from './health-policy'
import {
  DRAFT_TEMPLATES, TemplateButton, VariablesMap, countVariables, hasOptOutHint, renderPreview, resolveVariables, validateVariablesMap,
} from './template-rules'
import { DEFAULT_WINDOW, WindowSpec, inSendWindow } from './throttle'

export const MAX_AUDIENCE = 5000
export const GLOBAL_DAILY_CAP_DEFAULT = 250

/** Interruptor geral. Falha fechado: só o texto exato "true" (ou "1") liga o envio real. */
export function broadcastsEnabled(): boolean {
  return ['true', '1'].includes(String(process.env.BROADCASTS_ENABLED ?? '').trim().toLowerCase())
}

export function globalDailyCap(): number {
  const n = Number(process.env.BROADCASTS_GLOBAL_DAILY_CAP)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : GLOBAL_DAILY_CAP_DEFAULT
}

export interface AudienceFilter { stages?: string[]; campaignIds?: string[]; scoreMin?: number; scoreMax?: number; optInOrigins?: string[] }

export function sanitizeAudienceFilter(raw: unknown): AudienceFilter {
  const r = (raw ?? {}) as Record<string, any>
  const out: AudienceFilter = {}
  const allowedStages = [...STAGES, 'perdido'] as string[]
  const strs = (v: any, max: number, len: number) =>
    Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.length > 0 && x.length <= len).slice(0, max) : undefined
  const stages = strs(r.stages, 10, 20)?.filter((s) => allowedStages.includes(s))
  if (stages?.length) out.stages = stages
  const camps = strs(r.campaignIds, 20, 100)
  if (camps?.length) out.campaignIds = camps
  const origins = strs(r.optInOrigins, 20, 100)
  if (origins?.length) out.optInOrigins = origins
  for (const k of ['scoreMin', 'scoreMax'] as const) {
    const n = Number(r[k])
    if (r[k] !== undefined && r[k] !== null && r[k] !== '' && Number.isFinite(n)) out[k] = Math.min(100, Math.max(0, Math.round(n)))
  }
  return out
}

const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => '\\' + c)

/** Fatos de conformidade por lead. As portas (gates.ts) decidem; o banco só informa. */
export async function loadLeadFacts(db: Db, tenant: string, where: string, params: any[]): Promise<LeadFacts[]> {
  const sql = `
    SELECT l.id, l.name, l.phone, l.opt_out, l.anonymized_at,
      EXISTS (SELECT 1 FROM horizon_agent.consents c WHERE c.lead_id = l.id AND c.purpose = 'marketing' AND c.revoked_at IS NULL) AS marketing_active,
      EXISTS (SELECT 1 FROM horizon_agent.consents c WHERE c.lead_id = l.id AND c.purpose = 'marketing' AND c.revoked_at IS NULL
              AND c.source IS NOT NULL AND length(btrim(c.source)) > 0) AS marketing_active_has_source,
      (EXISTS (SELECT 1 FROM horizon_agent.consents c WHERE c.lead_id = l.id AND c.purpose = 'marketing')
       AND NOT EXISTS (SELECT 1 FROM horizon_agent.consents c WHERE c.lead_id = l.id AND c.purpose = 'marketing' AND c.revoked_at IS NULL)) AS marketing_revoked,
      EXISTS (SELECT 1 FROM horizon_agent.consents c WHERE c.lead_id = l.id AND c.purpose = 'atendimento' AND c.revoked_at IS NULL) AS atendimento_active,
      EXISTS (SELECT 1 FROM horizon_agent.consents c WHERE c.lead_id = l.id AND c.purpose = 'atendimento' AND c.revoked_at IS NULL
              AND c.source IS NOT NULL AND length(btrim(c.source)) > 0) AS atendimento_active_has_source,
      (SELECT max(r.sent_at) FROM horizon_agent.broadcast_recipients r
         JOIN horizon_agent.broadcasts b ON b.id = r.broadcast_id
         WHERE r.lead_id = l.id AND b.dry_run = false AND b.template_category = 'MARKETING'
           AND r.status IN ('sent','delivered','read','replied') AND r.sent_at IS NOT NULL) AS last_marketing_sent_at,
      (SELECT max(m.created_at) FROM horizon_agent.messages m JOIN horizon_agent.conversations cv ON cv.id = m.conversation_id
         WHERE cv.lead_id = l.id AND m.direction = 'in') AS last_inbound_at
    FROM horizon_agent.leads l
    WHERE l.tenant = $1 AND ${where}
    ORDER BY l.created_at, l.id`
  return (await db.query<LeadFacts>(sql, [tenant, ...params])).rows
}

export interface BroadcastCtx {
  kind: 'template' | 'text_in_window'
  category: 'MARKETING' | 'UTILITY'
  variablesMap: VariablesMap
  varCount: number
  now: Date
}

/** Decisão completa por destinatário: portas de conformidade + variável vazia. Usada no público e no envio. */
export function decideRecipient(f: LeadFacts | null | undefined, b: BroadcastCtx): SkipReason | null {
  const gate: GateContext = { kind: b.kind, category: b.category, now: b.now, frequencyDays: DEFAULT_FREQUENCY_DAYS }
  const r = decideLead(f, gate)
  if (r) return r
  if (b.varCount > 0 && !resolveVariables(b.variablesMap, b.varCount, f!)) return 'variavel_vazia'
  return null
}

/** Template efetivo para validação: cache ou, em simulação, o rascunho da documentação. */
export interface ResolvedTemplate {
  name: string; language: string; category: 'MARKETING' | 'UTILITY' | null; status: string
  bodyText: string | null; footerText: string | null; buttons: TemplateButton[]; known: boolean
}

@Injectable()
export class BroadcastsService {
  constructor(
    private readonly pg: PgService,
    private readonly pilot: PilotService,
    private readonly audit: AuditService,
    private readonly templates: TemplatesService,
    private readonly gateway: ChatGatewayService,
    private readonly health: HealthService,
  ) {}

  get tenant() { return this.pilot.tenant }

  // ───────────── Leitura ─────────────

  async list() {
    const rows = (
      await this.pg.query(
        `SELECT b.*, coalesce(c.counts, '{}'::jsonb) AS live_counts
         FROM horizon_agent.broadcasts b
         LEFT JOIN (SELECT broadcast_id, jsonb_object_agg(status, n) AS counts
                    FROM (SELECT broadcast_id, status, count(*)::int n FROM horizon_agent.broadcast_recipients GROUP BY 1, 2) s GROUP BY broadcast_id) c
           ON c.broadcast_id = b.id
         WHERE b.tenant = $1 ORDER BY b.created_at DESC LIMIT 200`,
        [this.tenant],
      )
    ).rows
    return { data: rows.map((r) => this.present(r, r.live_counts)), safety: this.safety() }
  }

  safety() {
    const chat = this.gateway.status()
    return {
      enabled: broadcastsEnabled(),
      chat: { configured: chat.configured, missing: chat.missing },
      globalDailyCap: globalDailyCap(),
      note: 'Envio real exige BROADCASTS_ENABLED=true no servidor. Sem isso só a simulação funciona.',
    }
  }

  private present(r: any, counts: Record<string, number> = {}) {
    const c = (k: string) => counts[k] ?? 0
    const total = Object.values(counts).reduce((a, b) => a + b, 0)
    const done = c('sent') + c('delivered') + c('read') + c('replied') + c('failed') + c('skipped')
    return {
      id: r.id, name: r.name, objective: r.objective, status: r.status, kind: r.kind,
      templateName: r.template_name, templateLanguage: r.template_language, templateCategory: r.template_category, textBody: r.text_body,
      variablesMap: r.variables_map, audienceFilter: r.audience_filter, scheduledAt: r.scheduled_at,
      window: { start: r.window_start, end: r.window_end, days: r.window_days, timezone: r.timezone },
      ratePerMinute: r.rate_per_minute, dailyCap: r.daily_cap, dryRun: r.dry_run, expectedRecipients: r.expected_recipients,
      pausedReason: r.paused_reason, createdBy: r.created_by, createdAt: r.created_at, startedAt: r.started_at, finishedAt: r.finished_at,
      counts: counts, total, progress: total ? Math.round((done / total) * 100) : 0,
    }
  }

  private async load(id: string, db: Db = this.pg) {
    const b = (await db.query(`SELECT * FROM horizon_agent.broadcasts WHERE id = $1 AND tenant = $2`, [id, this.tenant])).rows[0]
    if (!b) throw new NotFoundException('Disparo não encontrado')
    return b
  }

  async get(id: string) {
    const b = await this.load(id)
    const counts: Record<string, number> = Object.fromEntries(
      (await this.pg.query(`SELECT status, count(*)::int n FROM horizon_agent.broadcast_recipients WHERE broadcast_id = $1 GROUP BY status`, [id])).rows.map((r: any) => [r.status, r.n]),
    )
    const n = (...ks: string[]) => ks.reduce((a, k) => a + (counts[k] ?? 0), 0)
    const ev = (
      await this.pg.query(
        `SELECT
           count(*) FILTER (WHERE EXISTS (SELECT 1 FROM horizon_agent.lead_events e WHERE e.lead_id = r.lead_id AND e.type IN ('reuniao_marcada','venda')
              AND e.occurred_at >= r.sent_at AND e.occurred_at <= r.sent_at + interval '30 days'))::int AS converted,
           count(*) FILTER (WHERE EXISTS (SELECT 1 FROM horizon_agent.lead_events e WHERE e.lead_id = r.lead_id AND e.type = 'opt_out' AND e.occurred_at >= r.sent_at))::int AS opt_outs
         FROM horizon_agent.broadcast_recipients r
         WHERE r.broadcast_id = $1 AND r.sent_at IS NOT NULL AND r.status IN ('sent','delivered','read','replied')`,
        [id],
      )
    ).rows[0]
    const errors = (
      await this.pg.query(
        `SELECT error_code AS code, count(*)::int AS n FROM horizon_agent.broadcast_recipients
         WHERE broadcast_id = $1 AND status = 'failed' GROUP BY error_code ORDER BY n DESC`,
        [id],
      )
    ).rows
    const skips = (
      await this.pg.query(
        `SELECT skip_reason AS reason, count(*)::int AS n FROM horizon_agent.broadcast_recipients
         WHERE broadcast_id = $1 AND status = 'skipped' GROUP BY skip_reason ORDER BY n DESC`,
        [id],
      )
    ).rows.map((r: any) => ({ ...r, label: SKIP_LABELS[r.reason as SkipReason] ?? r.reason }))
    const sent = n('sent', 'delivered', 'read', 'replied')
    return {
      broadcast: this.present(b, counts),
      funnel: { sent, delivered: n('delivered', 'read', 'replied'), read: n('read', 'replied'), replied: n('replied'), converted: ev.converted },
      kpis: { sent, delivered: n('delivered', 'read', 'replied'), read: n('read', 'replied'), replied: n('replied'), converted: ev.converted, failed: n('failed'), skipped: n('skipped'), optOuts: ev.opt_outs },
      errors,
      skipReasons: skips,
      safety: this.safety(),
      simulated: b.dry_run,
    }
  }

  async recipients(id: string, q: RecipientsQuery) {
    await this.load(id)
    const page = Math.max(1, q.page ?? 1)
    const size = 50
    const params: any[] = [id]
    let where = 'r.broadcast_id = $1'
    if (q.status) { params.push(q.status); where += ` AND r.status = $${params.length}` }
    const total = (await this.pg.query(`SELECT count(*)::int n FROM horizon_agent.broadcast_recipients r WHERE ${where}`, params)).rows[0].n
    params.push(size, (page - 1) * size)
    const rows = (
      await this.pg.query(
        `SELECT r.id, r.lead_id, r.status, r.skip_reason, r.error_code, r.attempts, r.sent_at, r.delivered_at, r.read_at, r.replied_at, r.converted_at, l.name, l.phone
         FROM horizon_agent.broadcast_recipients r JOIN horizon_agent.leads l ON l.id = r.lead_id
         WHERE ${where} ORDER BY r.id LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      )
    ).rows
    return {
      data: rows.map((r: any) => ({
        id: Number(r.id), leadId: r.lead_id, firstName: String(r.name ?? '').split(' ')[0] || null, phone: maskPhone(r.phone),
        status: r.status, skipReason: r.skip_reason, skipLabel: r.skip_reason ? SKIP_LABELS[r.skip_reason as SkipReason] ?? r.skip_reason : null,
        errorCode: r.error_code, attempts: r.attempts, sentAt: r.sent_at, deliveredAt: r.delivered_at, readAt: r.read_at, repliedAt: r.replied_at, convertedAt: r.converted_at,
      })),
      meta: { page, pageSize: size, totalItems: total, totalPages: Math.ceil(total / size) },
    }
  }

  // ───────────── Rascunho ─────────────

  private normalizeWindow(d: BroadcastBodyDto, cur?: any) {
    return {
      start: d.windowStart ?? cur?.window_start ?? DEFAULT_WINDOW.start,
      end: d.windowEnd ?? cur?.window_end ?? DEFAULT_WINDOW.end,
      days: d.windowDays ? [...new Set(d.windowDays)].sort() : cur?.window_days ?? DEFAULT_WINDOW.days,
    }
  }

  async create(dto: CreateBroadcastDto, ctx: RequestCtx) {
    const w = this.normalizeWindow(dto)
    if (w.start >= w.end) throw new BadRequestException('A janela de envio precisa começar antes de terminar.')
    if (!w.days.length) throw new BadRequestException('Escolha ao menos um dia da semana.')
    const row = (
      await this.pg.query(
        `INSERT INTO horizon_agent.broadcasts
           (tenant, name, objective, kind, template_name, template_language, text_body, variables_map, audience_filter, scheduled_at,
            window_start, window_end, window_days, rate_per_minute, daily_cap, dry_run, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *`,
        [
          this.tenant, dto.name.trim(), dto.objective ?? null, dto.kind ?? 'template', dto.templateName ?? null, dto.templateLanguage ?? 'pt_BR', dto.textBody ?? null,
          JSON.stringify(dto.variablesMap ?? {}), JSON.stringify(sanitizeAudienceFilter(dto.audienceFilter)), dto.scheduledAt ?? null,
          w.start, w.end, w.days, dto.ratePerMinute ?? 20, dto.dailyCap ?? 200, dto.dryRun ?? true, ctx.actor,
        ],
      )
    ).rows[0]
    await this.audit.log({ ...ctx, action: 'broadcast.create', entity: 'broadcast', entityId: row.id, details: { kind: row.kind, dryRun: row.dry_run } })
    return this.present(row)
  }

  async update(id: string, dto: BroadcastBodyDto, ctx: RequestCtx) {
    const cur = await this.load(id)
    if (cur.status !== 'draft') throw new ConflictException('Só é possível editar um disparo em rascunho.')
    const w = this.normalizeWindow(dto, cur)
    if (w.start >= w.end) throw new BadRequestException('A janela de envio precisa começar antes de terminar.')
    if (!w.days.length) throw new BadRequestException('Escolha ao menos um dia da semana.')
    const has = (k: keyof BroadcastBodyDto) => dto[k] !== undefined
    const row = (
      await this.pg.query(
        `UPDATE horizon_agent.broadcasts SET
           name = $3, objective = $4, kind = $5, template_name = $6, template_language = $7, text_body = $8,
           variables_map = $9::jsonb, audience_filter = $10::jsonb, scheduled_at = $11,
           window_start = $12, window_end = $13, window_days = $14, rate_per_minute = $15, daily_cap = $16, dry_run = $17, updated_at = now()
         WHERE id = $1 AND tenant = $2 AND status = 'draft' RETURNING *`,
        [
          id, this.tenant, has('name') ? dto.name!.trim() : cur.name, has('objective') ? dto.objective ?? null : cur.objective,
          dto.kind ?? cur.kind, has('templateName') ? dto.templateName ?? null : cur.template_name, dto.templateLanguage ?? cur.template_language,
          has('textBody') ? dto.textBody ?? null : cur.text_body,
          JSON.stringify(has('variablesMap') ? dto.variablesMap : cur.variables_map),
          JSON.stringify(has('audienceFilter') ? sanitizeAudienceFilter(dto.audienceFilter) : cur.audience_filter),
          has('scheduledAt') ? dto.scheduledAt ?? null : cur.scheduled_at,
          w.start, w.end, w.days, dto.ratePerMinute ?? cur.rate_per_minute, dto.dailyCap ?? cur.daily_cap, dto.dryRun ?? cur.dry_run,
        ],
      )
    ).rows[0]
    if (!row) throw new ConflictException('O disparo mudou de estado.')
    return this.present(row)
  }

  // ───────────── Template e público ─────────────

  /** Resolve o template do disparo. Em simulação aceita o rascunho da documentação (ainda não criado na Meta). */
  async resolveTemplate(b: any): Promise<ResolvedTemplate | null> {
    if (b.kind === 'text_in_window') {
      return { name: '', language: b.template_language, category: 'UTILITY', status: 'APPROVED', bodyText: b.text_body, footerText: null, buttons: [], known: true }
    }
    if (!b.template_name) return null
    const c: CachedTemplate | null = await this.templates.get(b.template_name, b.template_language)
    if (c) {
      const cat = c.category === 'MARKETING' || c.category === 'UTILITY' ? c.category : null
      return { name: c.name, language: c.language, category: cat, status: c.status, bodyText: c.body_text, footerText: c.footer_text, buttons: c.buttons ?? [], known: true }
    }
    const d = DRAFT_TEMPLATES.find((x) => x.name === b.template_name)
    if (d) return { name: d.name, language: b.template_language, category: d.category, status: 'NAO_CRIADO', bodyText: d.bodyText, footerText: null, buttons: d.buttons, known: false }
    return null
  }

  private buildWhere(f: AudienceFilter) {
    const where: string[] = ['true']
    const params: any[] = []
    const add = (sql: string, v: any) => { params.push(v); where.push(sql.replace('?', `$${params.length + 1}`)) } // $1 é o tenant
    if (f.stages?.length) add('l.stage = ANY(?::text[])', f.stages)
    if (f.campaignIds?.length) add(`l.source->>'campaign_id' = ANY(?::text[])`, f.campaignIds)
    if (f.scoreMin !== undefined) add('l.score >= ?', f.scoreMin)
    if (f.scoreMax !== undefined) add('l.score <= ?', f.scoreMax)
    if (f.optInOrigins?.length) add(`l.opt_in_origin LIKE ANY(?::text[])`, f.optInOrigins.map((o) => likeEscape(o) + '%'))
    return { where: where.join(' AND '), params }
  }

  /** Avalia todo o público filtrado. Devolve contagens e a decisão por lead. */
  async evaluateAudience(b: { kind: 'template' | 'text_in_window'; category: 'MARKETING' | 'UTILITY'; variablesMap: VariablesMap; bodyText: string | null; audienceFilter: AudienceFilter }) {
    const { where, params } = this.buildWhere(b.audienceFilter)
    const facts = await loadLeadFacts(this.pg, this.tenant, where, params)
    if (facts.length > MAX_AUDIENCE) {
      throw new BadRequestException(`O filtro seleciona ${facts.length} leads (máximo ${MAX_AUDIENCE} por disparo). Refine o público.`)
    }
    const now = new Date()
    const ctx: BroadcastCtx = { kind: b.kind, category: b.category, variablesMap: b.variablesMap, varCount: b.bodyText ? countVariables(b.bodyText) : 0, now }
    const decisions = facts.map((f) => ({ leadId: f.id, reason: decideRecipient(f, ctx) }))
    return { decisions, summary: summarizeReasons(decisions.map((d) => d.reason)) }
  }

  async preview(id: string, override: PreviewDto = {}) {
    const b = await this.load(id)
    const merged = {
      ...b,
      kind: override.kind ?? b.kind,
      template_name: override.templateName ?? b.template_name,
      template_language: override.templateLanguage ?? b.template_language,
      variables_map: override.variablesMap ?? b.variables_map,
      audience_filter: override.audienceFilter ?? b.audience_filter,
    }
    const t = await this.resolveTemplate(merged)
    const warnings: string[] = []
    if (merged.kind === 'template' && !t) throw new BadRequestException('Escolha um template.')
    if (t && !t.category) warnings.push('Categoria do template desconhecida: tratada como MARKETING (mais restritivo).')
    if (t && merged.kind === 'template' && t.status !== 'APPROVED') warnings.push(t.status === 'NAO_CRIADO' ? 'Template ainda não criado na Meta: só a simulação é possível.' : `Template com status ${t.status}: envio real bloqueado.`)
    const category = t?.category ?? 'MARKETING'
    const ev = await this.evaluateAudience({
      kind: merged.kind, category, variablesMap: merged.variables_map ?? {}, bodyText: t?.bodyText ?? null, audienceFilter: sanitizeAudienceFilter(merged.audience_filter),
    })
    return {
      category, eligible: ev.summary.eligible, skipped: ev.summary.skippedTotal, total: ev.summary.total,
      reasons: Object.entries(ev.summary.skipped).map(([reason, n]) => ({ reason, label: SKIP_LABELS[reason as SkipReason], n })).sort((a, b2) => b2.n - a.n),
      warnings,
      sample: t?.bodyText ? renderPreview(t.bodyText, ['Maria', 'Alberto', '15/12', '14:00', 'exemplo5', 'exemplo6']) : null,
    }
  }

  // ───────────── Ciclo de vida ─────────────

  async start(id: string, dto: StartDto, ctx: RequestCtx) {
    if (dto.confirm !== true) throw new BadRequestException('Confirmação obrigatória (confirm: true).')
    const b = await this.load(id)
    if (b.status !== 'draft') throw new ConflictException('Só um rascunho pode ser iniciado.')

    if (!b.dry_run) {
      if (!broadcastsEnabled()) throw new ForbiddenException('Envio real desligado (BROADCASTS_ENABLED). Use a simulação ou peça ao responsável para ligar.')
      if (!this.gateway.configured()) throw new ServiceUnavailableException('Chat não configurado: o envio real não é possível.')
    }
    if (b.window_start >= b.window_end || !b.window_days?.length) throw new BadRequestException('Janela de envio inválida.')
    if (!b.dry_run) await this.assertNumberHealthy()

    let t: ResolvedTemplate | null
    if (b.kind === 'template') {
      if (!b.dry_run && !(await this.templates.ensureFresh(b.template_name, b.template_language))) {
        throw new BadRequestException('Status do template desconhecido ou desatualizado. Sincronize os templates e tente de novo.')
      }
      t = await this.resolveTemplate(b)
      if (!t) throw new BadRequestException('Template não encontrado.')
      if (!b.dry_run && t.status !== 'APPROVED') throw new BadRequestException(`Template não aprovado (status: ${t.status}).`)
      if (!t.bodyText) throw new BadRequestException('Corpo do template desconhecido: não dá para validar o aviso de saída. Sincronize os templates.')
    } else {
      t = await this.resolveTemplate(b)
      if (!t?.bodyText?.trim()) throw new BadRequestException('Informe o texto da mensagem.')
    }
    const category = t!.category ?? 'MARKETING'
    if (b.kind === 'template' && category === 'MARKETING' && !hasOptOutHint({ bodyText: t!.bodyText, footerText: t!.footerText, buttons: t!.buttons })) {
      throw new BadRequestException('Template de marketing sem aviso de saída ("responda PARAR para sair") nem botão de resposta rápida.')
    }
    const varErrs = validateVariablesMap(b.variables_map, t!.bodyText)
    if (varErrs.length) throw new BadRequestException(varErrs.join(' '))

    const ev = await this.evaluateAudience({
      kind: b.kind, category, variablesMap: b.variables_map, bodyText: t!.bodyText, audienceFilter: sanitizeAudienceFilter(b.audience_filter),
    })
    if (dto.expectedRecipients !== ev.summary.eligible) {
      throw new ConflictException({ message: 'O público mudou desde a prévia. Confira a nova contagem e confirme de novo.', eligible: ev.summary.eligible, expected: dto.expectedRecipients })
    }
    if (ev.summary.eligible === 0) throw new BadRequestException('Nenhum destinatário elegível.')

    // 1) materializa os destinatários (idempotente: UNIQUE + DO NOTHING) enquanto o disparo ainda é rascunho
    await this.pg.query(
      `INSERT INTO horizon_agent.broadcast_recipients (broadcast_id, lead_id, status, skip_reason)
       SELECT $1, x.lead_id, CASE WHEN x.reason IS NULL THEN 'pending' ELSE 'skipped' END, x.reason
       FROM unnest($2::uuid[], $3::text[]) AS x(lead_id, reason)
       ON CONFLICT (broadcast_id, lead_id) DO NOTHING`,
      [id, ev.decisions.map((d) => d.leadId), ev.decisions.map((d) => d.reason)],
    )
    // 2) vira o estado de forma atômica (só um start vence)
    const future = b.scheduled_at && new Date(b.scheduled_at).getTime() > Date.now()
    const upd = await this.pg.query(
      `UPDATE horizon_agent.broadcasts SET status = $3, template_category = $4, expected_recipients = $5, started_at = now(), updated_at = now()
       WHERE id = $1 AND tenant = $2 AND status = 'draft' RETURNING *`,
      [id, this.tenant, future ? 'scheduled' : 'running', b.kind === 'template' ? category : 'UTILITY', ev.summary.eligible],
    )
    if (!upd.rowCount) throw new ConflictException('O disparo já foi iniciado.')
    await this.audit.log({
      ...ctx, action: 'broadcast.start', entity: 'broadcast', entityId: id,
      details: { eligible: ev.summary.eligible, skipped: ev.summary.skippedTotal, dryRun: b.dry_run, category, scheduled: !!future },
    })
    return this.present(upd.rows[0])
  }

  private async transition(id: string, from: string[], to: string, action: string, ctx: RequestCtx, extra = '') {
    const r = await this.pg.query(
      `UPDATE horizon_agent.broadcasts SET status = $3, updated_at = now() ${extra} WHERE id = $1 AND tenant = $2 AND status = ANY($4::text[]) RETURNING *`,
      [id, this.tenant, to, from],
    )
    if (!r.rowCount) {
      await this.load(id)
      throw new ConflictException(`Não é possível ${action.split('.')[1]} um disparo neste estado.`)
    }
    await this.audit.log({ ...ctx, action, entity: 'broadcast', entityId: id, details: {} })
    return this.present(r.rows[0])
  }

  pause(id: string, ctx: RequestCtx) {
    return this.transition(id, ['running', 'scheduled'], 'paused', 'broadcast.pause', ctx, `, paused_reason = 'manual'`)
  }

  /** Saúde do número: sem leitura recente ou com qualquer sinal de risco, não começa nem retoma (falha fechado). */
  async assertNumberHealthy() {
    const [latest] = await this.health.lastTwo()
    if (!latest || Date.now() - new Date(latest.checked_at).getTime() > HEALTH_STALE_MS / 4) await this.health.refresh()
    const v = await this.health.verdict(true)
    if (v.state === 'block') {
      throw new ConflictException({ message: 'Saúde do número impede o envio: ' + v.reasons.map((r) => HEALTH_REASON_LABELS[r]).join('; '), reasons: v.reasons })
    }
  }

  async resume(id: string, ctx: RequestCtx) {
    const b = await this.load(id)
    if (!b.dry_run && !broadcastsEnabled()) throw new ForbiddenException('Envio real desligado (BROADCASTS_ENABLED).')
    if (!b.dry_run) await this.assertNumberHealthy()
    return this.transition(id, ['paused'], 'running', 'broadcast.resume', ctx, `, paused_reason = NULL, backoff_until = NULL, resumed_at = now()`)
  }

  async cancel(id: string, ctx: RequestCtx) {
    const r = await this.transition(id, ['draft', 'scheduled', 'running', 'paused'], 'cancelled', 'broadcast.cancel', ctx, ', finished_at = now()')
    // o que não foi enviado não será mais: libera a fila
    await this.pg.query(`UPDATE horizon_agent.broadcast_recipients SET status = 'skipped', skip_reason = 'disparo_cancelado' WHERE broadcast_id = $1 AND status IN ('pending','queued')`, [id])
    return r
  }

  // ───────────── Retorno de entrega (chat → API) ─────────────

  /** Só avança (sent → delivered → read). `failed` não derruba quem já foi lido/respondido. */
  async applyStatus(wid: string, status: 'delivered' | 'read' | 'failed', errorCode?: string) {
    let r
    if (status === 'delivered') {
      r = await this.pg.query(
        `UPDATE horizon_agent.broadcast_recipients SET status = 'delivered', delivered_at = coalesce(delivered_at, now())
         WHERE wid = $1 AND status = 'sent'`, [wid])
    } else if (status === 'read') {
      r = await this.pg.query(
        `UPDATE horizon_agent.broadcast_recipients SET status = 'read', read_at = coalesce(read_at, now()), delivered_at = coalesce(delivered_at, now())
         WHERE wid = $1 AND status IN ('sent','delivered')`, [wid])
    } else {
      r = await this.pg.query(
        `UPDATE horizon_agent.broadcast_recipients SET status = 'failed', error_code = $2
         WHERE wid = $1 AND status IN ('sent','delivered')`, [wid, (errorCode || 'entrega_falhou').slice(0, 60)])
    }
    return { updated: r.rowCount ?? 0 }
  }
}
