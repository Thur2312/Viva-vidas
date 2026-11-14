import { BadRequestException, ForbiddenException, Injectable, NotFoundException, Optional } from '@nestjs/common'
import { Db, PgService } from './pg.service'
import { classify, similarity } from './similarity'
import { AuditService, RequestCtx, SYSTEM_CTX } from './compliance/audit.service'
import { ConsentService, GrantInput } from './compliance/consent.service'
import { CryptoService } from './compliance/crypto.service'
import { LearningService } from './compliance/learning.service'
import { maskPhone, normalizePhone } from './compliance/phone'
import { enqueueCrmEvent } from '../crm/crm.outbox'
import { RESTRICTED_TEXT } from './compliance/content-access'
import { flagSensitive } from './compliance/redaction'
import { markBroadcastReply } from './broadcasts/broadcast-reply'
import { fallbackWid } from './ingest-dedupe'

export { normalizePhone }

export const STAGES = ['contatado', 'respondeu', 'qualificado', 'reuniao', 'compareceu', 'venda'] as const
export type Stage = (typeof STAGES)[number] | 'perdido'

export type EventType =
  | 'contatado' | 'respondeu' | 'qualificado' | 'reuniao_marcada'
  | 'compareceu' | 'venda' | 'perdido' | 'opt_out'

const EVENT_TO_STAGE: Record<EventType, Stage | null> = {
  contatado: 'contatado',
  respondeu: 'respondeu',
  qualificado: 'qualificado',
  reuniao_marcada: 'reuniao',
  compareceu: 'compareceu',
  venda: 'venda',
  perdido: 'perdido',
  opt_out: null,
}

const rank = (s: string) => STAGES.indexOf(s as any)

export interface IngestMessage {
  phone: string
  name?: string
  direction: 'in' | 'out'
  author: 'lead' | 'humano' | 'agente'
  body: string
  wid?: string
  source?: Record<string, unknown>
  externalRef?: string
  /** Origem do opt-in/consentimento (ex.: 'ctwa:<anuncio>', 'formulario_site'). */
  optInOrigin?: string
  /** Registros explícitos de consentimento (marketing e aprendizado_agente só existem por aqui ou pelo painel). */
  consents?: GrantInput[]
}

@Injectable()
export class PilotService {
  readonly tenant = process.env.PILOT_TENANT || 'alberto'

  private readonly crypto: CryptoService
  readonly consents: ConsentService
  readonly audit: AuditService
  private readonly learning: LearningService

  // Os serviços de conformidade são opcionais no construtor só para os testes que montam
  // `new PilotService(client)`; no Nest eles vêm do módulo.
  constructor(
    private readonly pg: PgService,
    @Optional() crypto?: CryptoService,
    @Optional() consents?: ConsentService,
    @Optional() audit?: AuditService,
    @Optional() learning?: LearningService,
  ) {
    this.crypto = crypto ?? new CryptoService()
    this.audit = audit ?? new AuditService(pg)
    this.consents = consents ?? new ConsentService(pg, this.audit)
    this.learning = learning ?? new LearningService(pg, this.consents, this.crypto)
  }

  // ───────────── Leads e eventos ─────────────

  async upsertLead(
    input: { phone: string; name?: string; source?: Record<string, unknown>; optInOrigin?: string; consents?: GrantInput[]; initiatedByLead?: boolean },
    db: Db = this.pg,
  ) {
    const phone = normalizePhone(input.phone)

    // Telefone de lead anonimizado COM opt-out continua bloqueado: não recria o lead.
    const hashed = await db.query(`SELECT 1 FROM horizon_agent.leads WHERE tenant = $1 AND phone_hash IS NOT NULL LIMIT 1`, [this.tenant])
    if (hashed.rowCount) {
      const blocked = await db.query(
        `SELECT * FROM horizon_agent.leads WHERE tenant = $1 AND phone_hash = $2 AND opt_out LIMIT 1`,
        [this.tenant, this.crypto.hashPhone(phone)],
      )
      if (blocked.rows[0]) return { ...blocked.rows[0], created: false, blocked: true }
    }

    const { rows } = await db.query(
      `INSERT INTO horizon_agent.leads (tenant, phone, name, source, opt_in_origin)
       VALUES ($1, $2, $3, coalesce($4::jsonb, '{}'::jsonb), $5)
       ON CONFLICT (tenant, phone) DO UPDATE SET
         name = coalesce(horizon_agent.leads.name, EXCLUDED.name),
         source = CASE WHEN horizon_agent.leads.source = '{}'::jsonb THEN EXCLUDED.source ELSE horizon_agent.leads.source END,
         opt_in_origin = coalesce(horizon_agent.leads.opt_in_origin, EXCLUDED.opt_in_origin),
         updated_at = now()
       RETURNING *, (xmax = 0) AS created`,
      [this.tenant, phone, input.name ?? null, input.source ? JSON.stringify(input.source) : null, input.optInOrigin ?? null],
    )
    const lead = rows[0]
    if (lead.created) await this.addEvent(lead.id, 'contatado', { actor: 'sistema' }, db)

    // Registro da origem do consentimento/opt-in. Atendimento e qualificação nascem de o titular
    // ter iniciado/aceitado o contato (art. 7º, V); marketing e aprendizado só entram se explícitos.
    // SEM evidência não há registro: um lead criado por importação/cadastro sem origem informada NÃO ganha
    // consentimento algum e, por isso, não passa nas travas de voz e de disparo. A evidência é (a) o lead ter
    // escrito primeiro (`initiatedByLead`) ou (b) uma origem de opt-in informada por quem criou o registro.
    if (lead.created) {
      const source = input.optInOrigin ?? (input.initiatedByLead ? 'mensagem_do_lead' : undefined)
      if (source) {
        for (const purpose of ['atendimento', 'qualificacao'] as const) {
          await this.consents.grant(lead.id, { purpose, legalBasis: 'procedimentos_preliminares', source }, SYSTEM_CTX, db)
        }
      }
    }
    if (input.consents?.length && !lead.opt_out) {
      for (const c of input.consents) {
        await this.consents.grant(lead.id, { ...c, source: c.source ?? input.optInOrigin }, SYSTEM_CTX, db)
      }
    }
    return lead
  }

  async addEvent(
    leadId: string,
    type: EventType,
    opts: { value?: number; actor?: 'humano' | 'agente' | 'sistema'; payload?: Record<string, unknown> } = {},
    db: Db = this.pg,
  ) {
    // Idempotência simples: o mesmo tipo de etapa não é registrado duas vezes para o lead.
    const dup = await db.query(
      `SELECT 1 FROM horizon_agent.lead_events WHERE lead_id = $1 AND type = $2 AND type <> 'venda' LIMIT 1`,
      [leadId, type],
    )
    if (dup.rowCount) return { duplicated: true }

    const inserted = await db.query(
      `INSERT INTO horizon_agent.lead_events (lead_id, type, value, actor, payload)
       VALUES ($1, $2, $3, $4, coalesce($5::jsonb, '{}'::jsonb)) RETURNING id`,
      [leadId, type, opts.value ?? null, opts.actor ?? 'humano', opts.payload ? JSON.stringify(opts.payload) : null],
    )
    // Fila do CRM (Pipedrive): mesma transacao do evento. Sem CRM_PROVIDER=pipedrive nao faz nada.
    await enqueueCrmEvent(db, { tenant: this.tenant, leadId, type, eventId: inserted.rows?.[0]?.id, value: opts.value })

    if (type === 'opt_out') {
      await db.query(`UPDATE horizon_agent.leads SET opt_out = true, updated_at = now() WHERE id = $1`, [leadId])
      // Opt-out revoga todos os consentimentos; canLearn/canContact passam a negar.
      await this.consents.revokeAll(leadId, 'opt_out', { actor: opts.actor ?? 'sistema' }, db)
      await this.audit.log({ actor: opts.actor ?? 'sistema', action: 'lead.opt_out', entity: 'lead', entityId: leadId }, db)
      return { duplicated: false }
    }

    const target = EVENT_TO_STAGE[type]!
    // Etapa só avança. 'perdido' vale a qualquer momento, exceto depois da venda.
    await db.query(
      `UPDATE horizon_agent.leads SET stage = $2, updated_at = now()
       WHERE id = $1 AND (
         ($2 = 'perdido' AND stage <> 'venda')
         OR ($2 <> 'perdido' AND stage <> 'perdido' AND array_position($3::text[], $2) > array_position($3::text[], stage))
       )`,
      [leadId, target, STAGES as unknown as string[]],
    )
    return { duplicated: false }
  }

  async registerEventByPhone(phone: string, type: EventType, opts: Parameters<PilotService['addEvent']>[2] = {}) {
    const lead = await this.upsertLead({ phone })
    if (lead.blocked) return { duplicated: false, blocked: true }
    return this.addEvent(lead.id, type, opts)
  }

  async updateQualification(leadId: string, patch: { score?: number; qualification?: Record<string, unknown> }) {
    await this.pg.query(
      `UPDATE horizon_agent.leads SET
         score = coalesce($2, score),
         qualification = qualification || coalesce($3::jsonb, '{}'::jsonb),
         updated_at = now()
       WHERE id = $1`,
      [leadId, patch.score ?? null, patch.qualification ? JSON.stringify(patch.qualification) : null],
    )
  }

  // ───────────── Mensagens (vem do chat) ─────────────

  async ingestMessage(m: IngestMessage, db: Db = this.pg) {
    this.crypto.assertReady() // sem PILOT_DATA_KEY a ingestão não roda (fail closed)
    // Antes de qualquer escrita: sem `wid` não há idempotência garantida (ver ingest-dedupe.ts). Desligado por padrão até o chat enviar `wid`.
    if (process.env.PILOT_REQUIRE_WID === 'true' && m.direction === 'in' && !m.wid) throw new BadRequestException('wid obrigatório para mensagens recebidas')
    const lead = await this.upsertLead(
      { phone: m.phone, name: m.name, source: m.source, optInOrigin: m.optInOrigin, consents: m.consents, initiatedByLead: m.direction === 'in' && m.author === 'lead' },
      db,
    )
    if (lead.blocked) return { duplicated: false, blocked: true as const, leadId: lead.id }

    // O agente não envia nada a quem não pode ser contatado (opt-out, anonimizado, marketing revogado).
    if (m.direction === 'out' && m.author === 'agente') {
      const can = await this.consents.canContact(lead, db)
      if (!can.allowed) throw new ForbiddenException(`Lead não pode ser contatado (${can.reason})`)
    }

    // Uma unica instrucao atomica (migration 010: UNIQUE (lead_id, channel)). Antes era SELECT e depois INSERT: duas primeiras
    // mensagens simultaneas criavam duas conversas. No conflito o DO UPDATE e um "nao faz nada" so para o RETURNING devolver a
    // linha existente; ele NAO mexe em updated_at (reenvio de mensagem repetida nao pode reordenar a lista) nem em external_ref.
    const conv = (
      await db.query(
        `INSERT INTO horizon_agent.conversations (lead_id, channel, external_ref) VALUES ($1, 'whatsapp', $2)
         ON CONFLICT (lead_id, channel) DO UPDATE SET channel = EXCLUDED.channel
         RETURNING id`,
        [lead.id, m.externalRef ?? null],
      )
    ).rows[0]

    const ins = await db.query(
      `INSERT INTO horizon_agent.messages (conversation_id, direction, author, body, wid, contains_sensitive)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (conversation_id, wid) DO NOTHING
       RETURNING id`,
      [conv.id, m.direction, m.author, this.crypto.encrypt(m.body), m.wid ?? fallbackWid(m), flagSensitive(m.body).containsSensitive],
    )
    if (!ins.rowCount) return { duplicated: true, leadId: lead.id, conversationId: conv.id }
    const messageId = Number(ins.rows[0].id)

    if (m.direction === 'in') await this.addEvent(lead.id, 'respondeu', { actor: 'sistema' }, db)
    if (m.direction === 'in') await markBroadcastReply(db, lead.id) // disparos: resposta em até 72h (nunca lança)

    let comparison: { draftId: number; similarity: number; humanAction: string } | null = null
    if (m.direction === 'out' && m.author === 'humano') {
      comparison = await this.compareWithDraft(conv.id, messageId, m.body, db)
      await this.learning.capture(lead, conv.id, messageId, m.body, db)
    }

    await db.query(`UPDATE horizon_agent.conversations SET updated_at = now() WHERE id = $1`, [conv.id])
    return { duplicated: false, leadId: lead.id, conversationId: conv.id, messageId, comparison }
  }

  /** Compara a resposta real do colaborador com o último rascunho ainda sem comparação. */
  private async compareWithDraft(conversationId: string, humanMessageId: number, body: string, db: Db) {
    const draft = (
      await db.query(
        `SELECT id, draft_body FROM horizon_agent.agent_drafts
         WHERE conversation_id = $1 AND human_message_id IS NULL
         ORDER BY created_at DESC LIMIT 1`,
        [conversationId],
      )
    ).rows[0]
    if (!draft) return null
    const sim = similarity(this.crypto.decrypt(draft.draft_body), body)
    const action = classify(sim)
    await db.query(
      `UPDATE horizon_agent.agent_drafts SET human_message_id = $2, similarity = $3, human_action = $4 WHERE id = $1`,
      [draft.id, humanMessageId, sim, action],
    )
    return { draftId: Number(draft.id), similarity: sim, humanAction: action }
  }

  // ───────────── Leitura para o painel ─────────────

  private range(from?: string, to?: string) {
    const end = to ? new Date(to) : new Date()
    const start = from ? new Date(from) : new Date(end.getTime() - 14 * 86400000)
    if (isNaN(+start) || isNaN(+end)) throw new Error('Período inválido')
    return { start, end }
  }

  async overview(from?: string, to?: string) {
    const { start, end } = this.range(from, to)

    const funnelRows = (
      await this.pg.query(
        `SELECT e.type, count(DISTINCT e.lead_id)::int AS n
         FROM horizon_agent.lead_events e JOIN horizon_agent.leads l ON l.id = e.lead_id
         WHERE l.tenant = $1 AND e.occurred_at BETWEEN $2::timestamptz AND $3::timestamptz
         GROUP BY e.type`,
        [this.tenant, start, end],
      )
    ).rows
    const f = Object.fromEntries(funnelRows.map((r) => [r.type, r.n])) as Record<string, number>
    const funnel = {
      contatado: f.contatado ?? 0,
      respondeu: f.respondeu ?? 0,
      qualificado: f.qualificado ?? 0,
      reuniao: f.reuniao_marcada ?? 0,
      compareceu: f.compareceu ?? 0,
      venda: f.venda ?? 0,
    }

    const series = (
      await this.pg.query(
        `SELECT to_char(d, 'DD/MM') AS dia,
                coalesce(count(DISTINCT e.lead_id) FILTER (WHERE e.type = 'contatado'), 0)::int AS contatos,
                coalesce(count(DISTINCT e.lead_id) FILTER (WHERE e.type = 'qualificado'), 0)::int AS qualificados
         FROM generate_series(($2::timestamptz)::date, ($3::timestamptz)::date, interval '1 day') d
         LEFT JOIN (
           SELECT e.* FROM horizon_agent.lead_events e JOIN horizon_agent.leads l ON l.id = e.lead_id WHERE l.tenant = $1
         ) e ON e.occurred_at::date = d::date
         GROUP BY d ORDER BY d`,
        [this.tenant, start, end],
      )
    ).rows

    const money = (
      await this.pg.query(
        `SELECT
           coalesce((SELECT sum(spend) FROM horizon_agent.ad_spend_daily WHERE day BETWEEN ($2::timestamptz)::date AND ($3::timestamptz)::date), 0)::float AS investido,
           coalesce((SELECT sum(e.value) FROM horizon_agent.lead_events e JOIN horizon_agent.leads l ON l.id = e.lead_id
                     WHERE l.tenant = $1 AND e.type = 'venda' AND e.occurred_at BETWEEN $2::timestamptz AND $3::timestamptz), 0)::float AS receita`,
        [this.tenant, start, end],
      )
    ).rows[0]

    const activity = (
      await this.pg.query(
        `SELECT to_char(e.occurred_at AT TIME ZONE 'America/Sao_Paulo', 'HH24:MI') AS hora, e.type, e.actor, l.name, l.id AS lead_id
         FROM horizon_agent.lead_events e JOIN horizon_agent.leads l ON l.id = e.lead_id
         WHERE l.tenant = $1 ORDER BY e.occurred_at DESC LIMIT 12`,
        [this.tenant],
      )
    ).rows

    return { periodo: { from: start, to: end }, funnel, series, investido: money.investido, receita: money.receita, activity }
  }

  async listLeads(q: { stage?: string; search?: string; campaignId?: string; page?: number; pageSize?: number }) {
    const page = Math.max(1, q.page ?? 1)
    const size = Math.min(100, Math.max(1, q.pageSize ?? 15))
    const where = ['l.tenant = $1']
    const params: any[] = [this.tenant]
    if (q.stage) { params.push(q.stage); where.push(`l.stage = $${params.length}`) }
    if (q.campaignId) { params.push(q.campaignId); where.push(`l.source->>'campaign_id' = $${params.length}`) }
    if (q.search) { params.push(`%${q.search.toLowerCase()}%`); where.push(`(lower(l.name) LIKE $${params.length} OR l.phone LIKE $${params.length})`) }
    const w = where.join(' AND ')

    const total = (await this.pg.query(`SELECT count(*)::int n FROM horizon_agent.leads l WHERE ${w}`, params)).rows[0].n
    params.push(size, (page - 1) * size)
    const rows = (
      await this.pg.query(
        `SELECT l.id, l.name, l.phone, l.stage, l.score, l.source, l.opt_out, l.created_at,
                lm.body AS last_message, lm.created_at AS last_at
         FROM horizon_agent.leads l
         LEFT JOIN LATERAL (
           SELECT m.body, m.created_at FROM horizon_agent.messages m
           JOIN horizon_agent.conversations c ON c.id = m.conversation_id
           WHERE c.lead_id = l.id ORDER BY m.created_at DESC LIMIT 1
         ) lm ON true
         WHERE ${w}
         ORDER BY coalesce(lm.created_at, l.created_at) DESC
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      )
    ).rows
    // Minimização: telefone mascarado e prévia curta da última mensagem.
    const data = rows.map((r) => ({
      ...r,
      phone: maskPhone(r.phone),
      last_message: r.last_message == null ? null : this.crypto.decrypt(r.last_message).slice(0, 120),
    }))
    return { data, meta: { page, pageSize: size, totalItems: total, totalPages: Math.ceil(total / size) } }
  }

  async getLead(id: string, ctx: RequestCtx = SYSTEM_CTX, content = true) {
    const lead = (await this.pg.query(`SELECT * FROM horizon_agent.leads WHERE id = $1 AND tenant = $2`, [id, this.tenant])).rows[0]
    if (!lead) throw new NotFoundException('Lead não encontrado')
    delete lead.phone_hash
    const events = (await this.pg.query(`SELECT type, actor, value, payload, occurred_at FROM horizon_agent.lead_events WHERE lead_id = $1 ORDER BY occurred_at`, [id])).rows
    const messages = (
      await this.pg.query(
        `SELECT m.id, m.direction, m.author, m.body, m.created_at FROM horizon_agent.messages m
         JOIN horizon_agent.conversations c ON c.id = m.conversation_id WHERE c.lead_id = $1 ORDER BY m.created_at`,
        [id],
      )
    ).rows
    const drafts = (
      await this.pg.query(
        `SELECT d.id, d.draft_body, d.stage_guess, d.qualified_guess, d.next_action_guess, d.similarity, d.human_action, d.created_at
         FROM horizon_agent.agent_drafts d JOIN horizon_agent.conversations c ON c.id = d.conversation_id
         WHERE c.lead_id = $1 ORDER BY d.created_at`,
        [id],
      )
    ).rows
    await this.audit.log({ ...ctx, action: 'lead.read', entity: 'lead', entityId: id, details: { messages: messages.length, drafts: drafts.length } })
    // Sem permissao de conteudo: telefone mascarado e textos substituidos (a leitura continua auditada acima).
    if (!content) lead.phone = maskPhone(lead.phone)
    return {
      lead,
      events,
      messages: messages.map((m) => ({ ...m, body: content ? this.crypto.decrypt(m.body) : RESTRICTED_TEXT })),
      drafts: drafts.map((d) => ({ ...d, draft_body: content ? this.crypto.decrypt(d.draft_body) : RESTRICTED_TEXT })),
    }
  }

  async campaigns(from?: string, to?: string) {
    const { start, end } = this.range(from, to)
    const { rows } = await this.pg.query(
      `WITH spend AS (
         SELECT campaign_id, max(campaign_name) AS name, sum(spend)::float AS investido
         FROM horizon_agent.ad_spend_daily WHERE day BETWEEN ($2::timestamptz)::date AND ($3::timestamptz)::date GROUP BY campaign_id
       ), funil AS (
         SELECT l.source->>'campaign_id' AS campaign_id, max(l.source->>'campaign_name') AS name,
                count(DISTINCT l.id)::int AS leads,
                count(DISTINCT l.id) FILTER (WHERE e.type = 'qualificado')::int AS qualificados,
                count(DISTINCT l.id) FILTER (WHERE e.type = 'reuniao_marcada')::int AS reunioes,
                count(DISTINCT l.id) FILTER (WHERE e.type = 'venda')::int AS vendas,
                coalesce(sum(e.value) FILTER (WHERE e.type = 'venda'), 0)::float AS receita
         FROM horizon_agent.leads l LEFT JOIN horizon_agent.lead_events e ON e.lead_id = l.id
         WHERE l.tenant = $1 AND l.created_at BETWEEN $2::timestamptz AND $3::timestamptz AND l.source->>'campaign_id' IS NOT NULL
         GROUP BY 1
       )
       SELECT coalesce(f.campaign_id, s.campaign_id) AS campaign_id, coalesce(s.name, f.name) AS nome,
              coalesce(s.investido, 0) AS investido, coalesce(f.leads, 0) AS leads, coalesce(f.qualificados, 0) AS qualificados,
              coalesce(f.reunioes, 0) AS reunioes, coalesce(f.vendas, 0) AS vendas, coalesce(f.receita, 0) AS receita
       FROM funil f FULL JOIN spend s ON s.campaign_id = f.campaign_id
       ORDER BY investido DESC, leads DESC`,
      [this.tenant, start, end],
    )
    return rows
  }

  async readiness() {
    const { rows } = await this.pg.query(`SELECT stage, drafts::int, compared::int, avg_similarity::float, usable_rate::float FROM horizon_agent.agent_readiness ORDER BY drafts DESC`)
    return rows
  }
}
