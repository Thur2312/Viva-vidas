import { BadGatewayException, BadRequestException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common'
import { RESTRICTED_TEXT } from '../compliance/content-access'
import { Db, PgService } from '../pg.service'
import { AuditService, RequestCtx, SYSTEM_CTX } from '../compliance/audit.service'
import { ConsentService } from '../compliance/consent.service'
import { CryptoService } from '../compliance/crypto.service'
import { maskPhone } from '../compliance/phone'
import { PilotService } from '../pilot.service'
import { ChatGatewayService } from '../../chat-gateway/chat-gateway.service'

export const TZ = 'America/Sao_Paulo'
const MAX_RANGE_DAYS = 366
/** Leituras de conteúdo do mesmo operador na mesma conversa dentro desta janela geram UMA linha de auditoria. */
export const AUDIT_DEDUP_MINUTES = 5
/** Janela de atendimento do WhatsApp: texto livre só até 24h após a última mensagem do cliente. */
export const SERVICE_WINDOW_HOURS = 24

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`)
const preview = (s: string) => {
  const flat = s.replace(/\s+/g, ' ').trim()
  return flat.length > 120 ? `${flat.slice(0, 119)}…` : flat
}
const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v))

export interface ListQuery {
  search?: string
  mode?: string
  status?: string
  stage?: string
  leadId?: string
  page?: number
  pageSize?: number
}

@Injectable()
export class ConversationsService {
  tenant = process.env.PILOT_TENANT || 'alberto'

  constructor(
    private readonly pg: PgService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly consents: ConsentService,
    private readonly pilot: PilotService,
    private readonly gateway: ChatGatewayService,
  ) {}

  // ───────────── Lista (telefone mascarado, prévia curta) ─────────────
  async list(q: ListQuery) {
    const page = Math.max(1, q.page ?? 1)
    const size = Math.min(50, Math.max(1, q.pageSize ?? 20))
    const params: any[] = [this.tenant]
    const where = ['l.tenant = $1']
    // Busca só por nome e telefone. O corpo das mensagens é criptografado e nunca entra na busca.
    if (q.search?.trim()) {
      const s = q.search.trim().toLowerCase()
      params.push(`%${escapeLike(s)}%`)
      const nameIdx = params.length
      const digits = s.replace(/\D/g, '')
      let cond = `lower(coalesce(l.name,'')) LIKE $${nameIdx}`
      if (digits.length >= 3) {
        params.push(`%${escapeLike(digits)}%`)
        cond += ` OR l.phone LIKE $${params.length}`
      }
      where.push(`(${cond})`)
    }
    if (q.leadId) { params.push(q.leadId); where.push(`l.id = $${params.length}::uuid`) }
    if (q.mode) { params.push(q.mode); where.push(`c.mode = $${params.length}`) }
    if (q.stage) { params.push(q.stage); where.push(`l.stage = $${params.length}`) }
    if (q.status === 'aguardando') where.push(`lm.direction = 'in'`)
    if (q.status === 'respondida') where.push(`lm.direction = 'out'`)
    if (q.status === 'rascunho') where.push(`pd.pending`)
    const w = where.join(' AND ')

    const base = `
      FROM horizon_agent.conversations c
      JOIN horizon_agent.leads l ON l.id = c.lead_id
      LEFT JOIN LATERAL (
        SELECT m.body, m.author, m.direction, m.created_at FROM horizon_agent.messages m
        WHERE m.conversation_id = c.id ORDER BY m.created_at DESC, m.id DESC LIMIT 1
      ) lm ON true
      LEFT JOIN LATERAL (
        SELECT count(*)::int AS n FROM horizon_agent.messages m WHERE m.conversation_id = c.id
      ) mc ON true
      LEFT JOIN LATERAL (
        -- rascunho "pendente": sem resposta humana comparada e gerado para mensagem posterior à última saída
        SELECT EXISTS (
          SELECT 1 FROM horizon_agent.agent_drafts d
          JOIN horizon_agent.messages tm ON tm.id = d.trigger_message_id
          WHERE d.conversation_id = c.id AND d.human_message_id IS NULL
            AND d.action IS DISTINCT FROM 'aguardar' -- rascunho vazio não é sugestão pendente
            AND tm.created_at > coalesce((SELECT max(h.created_at) FROM horizon_agent.messages h WHERE h.conversation_id = c.id AND h.direction = 'out'), '-infinity'::timestamptz)
        ) AS pending
      ) pd ON true
      WHERE ${w}`

    const total = (await this.pg.query(`SELECT count(*)::int AS n ${base}`, params)).rows[0].n as number
    const rows = (
      await this.pg.query(
        `SELECT c.id, c.lead_id, l.name AS lead_name, l.phone, l.stage, c.mode,
                lm.body AS last_body, lm.author AS last_author, lm.direction AS last_direction,
                coalesce(lm.created_at, c.created_at) AS last_at,
                coalesce(mc.n, 0) AS messages_count, pd.pending AS has_pending_draft
         ${base}
         ORDER BY coalesce(lm.created_at, c.created_at) DESC, c.id
         LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, size, (page - 1) * size],
      )
    ).rows
    const data = rows.map((r) => ({
      id: r.id,
      lead_id: r.lead_id,
      lead_name: r.lead_name,
      phone: maskPhone(r.phone),
      stage: r.stage,
      mode: r.mode,
      last_message_preview: r.last_body == null ? null : preview(this.crypto.decrypt(r.last_body)),
      last_author: r.last_author ?? null,
      last_at: r.last_at,
      unread_for_human: r.last_direction === 'in',
      messages_count: r.messages_count,
      has_pending_draft: !!r.has_pending_draft,
    }))
    return { data, meta: { page, pageSize: size, totalItems: total, totalPages: Math.ceil(total / size) } }
  }

  private async findConversation(id: string) {
    const conv = (
      await this.pg.query(
        `SELECT c.id, c.lead_id FROM horizon_agent.conversations c JOIN horizon_agent.leads l ON l.id = c.lead_id
         WHERE c.id = $1 AND l.tenant = $2`,
        [id, this.tenant],
      )
    ).rows[0]
    if (!conv) throw new NotFoundException('Conversa não encontrada')
    return conv as { id: string; lead_id: string }
  }

  // ───────────── Mensagens (conteúdo descriptografado, com auditoria) ─────────────
  async messages(id: string, opts: { before?: string; limit?: number } = {}, ctx: RequestCtx = SYSTEM_CTX, content = true) {
    const limit = Math.min(100, Math.max(1, opts.limit ?? 40))
    await this.findConversation(id)

    const params: any[] = [id]
    let cursor = ''
    if (opts.before) {
      params.push(opts.before)
      cursor = `AND (m.created_at, m.id) < (SELECT b.created_at, b.id FROM horizon_agent.messages b WHERE b.id = $2::bigint AND b.conversation_id = $1)`
    }
    params.push(limit + 1)
    const rows = (
      await this.pg.query(
        `SELECT m.id, m.direction, m.author, m.body, m.created_at FROM horizon_agent.messages m
         WHERE m.conversation_id = $1 ${cursor}
         ORDER BY m.created_at DESC, m.id DESC LIMIT $${params.length}`,
        params,
      )
    ).rows
    const hasMore = rows.length > limit
    const page = rows.slice(0, limit).reverse()

    const drafts = page.length
      ? (
          await this.pg.query(
            `SELECT DISTINCT ON (d.trigger_message_id) d.id, d.trigger_message_id, d.draft_body, d.similarity, d.human_action, d.stage_guess, d.next_action_guess
             FROM horizon_agent.agent_drafts d
             WHERE d.conversation_id = $1 AND d.trigger_message_id = ANY($2::bigint[])
             ORDER BY d.trigger_message_id, d.created_at DESC, d.id DESC`,
            [id, page.map((m) => m.id)],
          )
        ).rows
      : []
    // Rascunho vazio (ação 'aguardar') existe só para dedupe/telemetria: não vira sugestão no painel.
    const byTrigger = new Map(drafts.filter((d) => this.crypto.decrypt(d.draft_body)).map((d) => [String(d.trigger_message_id), d]))

    const data = page.map((m) => {
      const d = byTrigger.get(String(m.id))
      return {
        id: Number(m.id),
        direction: m.direction,
        author: m.author,
        body: content ? this.crypto.decrypt(m.body) : RESTRICTED_TEXT,
        created_at: m.created_at,
        ...(d
          ? {
              draft: {
                id: Number(d.id),
                draft_body: content ? this.crypto.decrypt(d.draft_body) : RESTRICTED_TEXT,
                similarity: num(d.similarity),
                human_action: d.human_action ?? null,
                stage_guess: d.stage_guess ?? null,
                next_action_guess: d.next_action_guess ?? null,
              },
            }
          : {}),
      }
    })

    await this.auditRead(id, { count: data.length, older: !!opts.before }, ctx)
    return { data, hasMore }
  }

  /** Uma linha por operador+conversa a cada janela de AUDIT_DEDUP_MINUTES, para a atualização automática não inundar a trilha. */
  private async auditRead(conversationId: string, details: Record<string, unknown>, ctx: RequestCtx) {
    const seen = (
      await this.pg.query(
        `SELECT 1 FROM horizon_agent.audit_log
         WHERE action = 'conversation.read' AND entity_id = $1 AND actor = $2 AND at > now() - make_interval(mins => $3::int) LIMIT 1`,
        [conversationId, ctx.actor, AUDIT_DEDUP_MINUTES],
      )
    ).rows.length
    if (seen) return
    await this.audit.log({ ...ctx, action: 'conversation.read', entity: 'conversation', entityId: conversationId, details })
  }

  // ───────────── Envio (texto livre dentro da janela de 24h) ─────────────
  async send(id: string, body: string, ctx: RequestCtx = SYSTEM_CTX) {
    const text = (body ?? '').trim()
    if (!text) throw new BadRequestException('Mensagem vazia')
    if (text.length > 4096) throw new BadRequestException('Mensagem acima de 4096 caracteres')
    const conv = await this.findConversation(id)

    const lead = (await this.pg.query(`SELECT id, phone, opt_out, anonymized_at FROM horizon_agent.leads WHERE id = $1`, [conv.lead_id])).rows[0]
    const can = await this.consents.canContact(lead)
    if (!can.allowed) {
      throw new UnprocessableEntityException({
        code: 'contact_blocked',
        reason: can.reason,
        message: 'Este lead não pode ser contatado (opt-out, dados anonimizados ou consentimento revogado).',
      })
    }

    // Janela de atendimento: calculada pela última mensagem recebida do lead.
    const win = (
      await this.pg.query(
        `SELECT max(created_at) AS last_in, (max(created_at) > now() - make_interval(hours => $2::int)) AS open
         FROM horizon_agent.messages WHERE conversation_id = $1 AND direction = 'in'`,
        [id, SERVICE_WINDOW_HOURS],
      )
    ).rows[0]
    if (!win?.open) {
      throw new UnprocessableEntityException({
        code: 'window_closed',
        message: 'A janela de 24 horas com este cliente está fechada: só é possível enviar um modelo (template) aprovado.',
        last_inbound_at: win?.last_in ?? null,
      })
    }

    // Se o chat não estiver configurado, sendText lança 503 com mensagem honesta, antes de gravar qualquer coisa.
    const sent = await this.gateway.sendText({ phone: lead.phone, body: text, requestedBy: ctx.actor })

    let stored: Awaited<ReturnType<PilotService['ingestMessage']>>
    try {
      stored = await this.pilot.ingestMessage({ phone: lead.phone, direction: 'out', author: 'humano', body: text, wid: sent?.wid })
    } catch {
      await this.audit.log({ ...ctx, action: 'conversation.send', entity: 'conversation', entityId: id, details: { sent: true, stored: false } })
      throw new BadGatewayException('A mensagem foi enviada, mas não foi registrada no painel. Atualize a conversa.')
    }

    // "duplicated": o chat devolveu a mesma mensagem (mesmo wid) antes de nós; usamos a já registrada.
    const row = (
      await this.pg.query(
        `SELECT id, direction, author, body, created_at FROM horizon_agent.messages
         WHERE conversation_id = $1 AND ${sent?.wid ? 'wid = $2' : 'id = $2::bigint'}`,
        [id, sent?.wid ?? (stored as any).messageId],
      )
    ).rows[0]
    await this.audit.log({
      ...ctx, action: 'conversation.send', entity: 'conversation', entityId: id,
      details: { sent: true, stored: true, message_id: row ? Number(row.id) : null, duplicated: !!stored.duplicated },
    })
    const cmp = (stored as any).comparison
    return {
      id: row ? Number(row.id) : null,
      direction: 'out' as const,
      author: 'humano' as const,
      body: text,
      created_at: row?.created_at ?? new Date().toISOString(),
      draft_comparison: cmp ? { similarity: cmp.similarity, human_action: cmp.humanAction } : null,
    }
  }

  // ───────────── Métricas ─────────────
  /** Limites do período em America/Sao_Paulo. Data pura = dia inteiro; fim exclusivo. */
  private async bounds(from?: string, to?: string) {
    for (const v of [from, to]) if (v && isNaN(Date.parse(v))) throw new BadRequestException('Período inválido')
    const re = `'^\\d{4}-\\d{2}-\\d{2}$'`
    const { rows } = await this.pg.query(
      `SELECT
         CASE WHEN $1::text IS NULL THEN (((now() AT TIME ZONE '${TZ}')::date) - 13)::timestamp AT TIME ZONE '${TZ}'
              WHEN $1::text ~ ${re} THEN ($1::text)::date::timestamp AT TIME ZONE '${TZ}'
              ELSE ($1::text)::timestamptz END AS s,
         CASE WHEN $2::text IS NULL THEN (((now() AT TIME ZONE '${TZ}')::date) + 1)::timestamp AT TIME ZONE '${TZ}'
              WHEN $2::text ~ ${re} THEN (($2::text)::date + 1)::timestamp AT TIME ZONE '${TZ}'
              ELSE ($2::text)::timestamptz END AS e`,
      [from ?? null, to ?? null],
    )
    const { s, e } = rows[0] as { s: Date; e: Date }
    if (!(+e > +s)) throw new BadRequestException('Período inválido: o início deve vir antes do fim')
    if ((+e - +s) / 86_400_000 > MAX_RANGE_DAYS + 1) throw new BadRequestException(`Período máximo de ${MAX_RANGE_DAYS} dias`)
    return { s, e }
  }

  async stats(from?: string, to?: string) {
    const { s, e } = await this.bounds(from, to)
    const p = [this.tenant, s.toISOString(), e.toISOString()]
    // Todo parâmetro de tempo é lido como timestamptz (nunca ::date misturado com timestamp).
    const T = `$2::timestamptz`
    const E = `$3::timestamptz`
    const msgs = `
      FROM horizon_agent.messages m
      JOIN horizon_agent.conversations c ON c.id = m.conversation_id
      JOIN horizon_agent.leads l ON l.id = c.lead_id AND l.tenant = $1`

    const q = (sql: string) => this.pg.query(sql, p)
    const [daily, counts, firstResp, turnResp, drafts, stages, hours] = await Promise.all([
      q(`WITH days AS (
           SELECT d::date AS d FROM generate_series(($2::timestamptz AT TIME ZONE '${TZ}')::date, (($3::timestamptz - interval '1 millisecond') AT TIME ZONE '${TZ}')::date, interval '1 day') d
         ), mm AS (
           SELECT (m.created_at AT TIME ZONE '${TZ}')::date AS d, m.author, m.direction ${msgs}
           WHERE m.created_at >= ${T} AND m.created_at < ${E}
         )
         SELECT to_char(days.d, 'YYYY-MM-DD') AS dia,
                (count(mm.d) FILTER (WHERE mm.author = 'lead' AND mm.direction = 'in'))::int AS leads_in,
                (count(mm.d) FILTER (WHERE mm.author = 'humano' AND mm.direction = 'out'))::int AS humano_out,
                (count(mm.d) FILTER (WHERE mm.author = 'agente' AND mm.direction = 'out'))::int AS agente_out
         FROM days LEFT JOIN mm ON mm.d = days.d GROUP BY days.d ORDER BY days.d`),
      q(`WITH per AS (
           SELECT c.id,
                  max(m.created_at) FILTER (WHERE m.direction = 'in') AS last_in,
                  max(m.created_at) FILTER (WHERE m.direction = 'out') AS last_out,
                  bool_or(m.created_at >= ${T} AND m.created_at < ${E}) AS active,
                  bool_or(m.direction = 'in' AND m.created_at >= ${T} AND m.created_at < ${E}) AS in_period_in,
                  min(m.created_at) FILTER (WHERE m.direction = 'in' AND m.created_at >= ${T} AND m.created_at < ${E}) AS in_period_first_in,
                  bool_or(m.direction = 'out' AND m.created_at >= ${T} AND m.created_at < ${E}) AS in_period_out,
                  min(m.created_at) FILTER (WHERE m.direction = 'out' AND m.created_at >= ${T} AND m.created_at < ${E}) AS in_period_first_out
           ${msgs} GROUP BY c.id
         )
         SELECT
           (count(*) FILTER (WHERE active))::int AS ativas,
           (SELECT count(*)::int FROM horizon_agent.conversations c2 JOIN horizon_agent.leads l2 ON l2.id = c2.lead_id AND l2.tenant = $1
              WHERE c2.created_at >= ${T} AND c2.created_at < ${E}) AS novas,
           (count(*) FILTER (WHERE in_period_in AND last_out > in_period_first_in))::int AS lead_msgs_answered,
           (count(*) FILTER (WHERE in_period_in))::int AS lead_msgs_convs,
           (count(*) FILTER (WHERE in_period_out AND last_in > in_period_first_out))::int AS contacted_replied,
           (count(*) FILTER (WHERE in_period_out))::int AS contacted
         FROM per`),
      // 1ª resposta humana: 1ª mensagem do lead no período, sem resposta humana anterior, até a primeira resposta humana
      q(`WITH firsts AS (
           SELECT c.id, min(m.created_at) AS first_in ${msgs}
           WHERE m.direction = 'in' AND m.created_at >= ${T} AND m.created_at < ${E} GROUP BY c.id
         ), t AS (
           SELECT extract(epoch FROM (r.at - f.first_in))::float AS secs FROM firsts f
           JOIN LATERAL (SELECT min(h.created_at) AS at FROM horizon_agent.messages h
                         WHERE h.conversation_id = f.id AND h.author = 'humano' AND h.created_at > f.first_in) r ON r.at IS NOT NULL
           WHERE NOT EXISTS (SELECT 1 FROM horizon_agent.messages h2 WHERE h2.conversation_id = f.id AND h2.author = 'humano' AND h2.created_at <= f.first_in)
         )
         SELECT count(*)::int AS n, percentile_cont(0.5) WITHIN GROUP (ORDER BY secs)::float AS p50,
                percentile_cont(0.9) WITHIN GROUP (ORDER BY secs)::float AS p90, avg(secs)::float AS media FROM t`),
      // por "turno": 1ª mensagem do lead após uma saída (ou início) até a próxima resposta humana
      q(`WITH ord AS (
           SELECT m.id, m.conversation_id, m.author, m.created_at,
                  lag(m.author) OVER (PARTITION BY m.conversation_id ORDER BY m.created_at, m.id) AS prev
           ${msgs}
         ), turns AS (
           SELECT o.* FROM ord o WHERE o.author = 'lead' AND (o.prev IS NULL OR o.prev <> 'lead')
             AND o.created_at >= ${T} AND o.created_at < ${E}
         ), t AS (
           SELECT extract(epoch FROM (r.at - u.created_at))::float AS secs FROM turns u
           JOIN LATERAL (SELECT min(h.created_at) AS at FROM horizon_agent.messages h
                         WHERE h.conversation_id = u.conversation_id AND h.author = 'humano' AND (h.created_at, h.id) > (u.created_at, u.id)) r ON r.at IS NOT NULL
         )
         SELECT count(*)::int AS n, percentile_cont(0.5) WITHIN GROUP (ORDER BY secs)::float AS p50,
                percentile_cont(0.9) WITHIN GROUP (ORDER BY secs)::float AS p90 FROM t`),
      q(`SELECT count(*)::int AS total,
                (count(*) FILTER (WHERE d.human_action IS NOT NULL))::int AS comparados,
                (count(*) FILTER (WHERE d.human_action = 'igual'))::int AS igual,
                (count(*) FILTER (WHERE d.human_action = 'editou'))::int AS editou,
                (count(*) FILTER (WHERE d.human_action = 'diferente'))::int AS diferente,
                (count(*) FILTER (WHERE d.human_action = 'ignorou'))::int AS ignorou
         FROM horizon_agent.agent_drafts d
         JOIN horizon_agent.conversations c ON c.id = d.conversation_id
         JOIN horizon_agent.leads l ON l.id = c.lead_id AND l.tenant = $1
         WHERE d.created_at >= ${T} AND d.created_at < ${E}`),
      q(`SELECT l.stage, count(DISTINCT c.id)::int AS conversas ${msgs}
         WHERE m.created_at >= ${T} AND m.created_at < ${E} GROUP BY l.stage ORDER BY conversas DESC, l.stage`),
      q(`WITH h AS (SELECT generate_series(0, 23) AS hora),
              mm AS (SELECT extract(hour FROM m.created_at AT TIME ZONE '${TZ}')::int AS hora ${msgs}
                     WHERE m.created_at >= ${T} AND m.created_at < ${E})
         SELECT h.hora, count(mm.hora)::int AS mensagens FROM h LEFT JOIN mm ON mm.hora = h.hora GROUP BY h.hora ORDER BY h.hora`),
    ])

    const c = counts.rows[0]
    const dr = drafts.rows[0]
    const rate = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 1000 : null)
    const fr = firstResp.rows[0]
    const tr = turnResp.rows[0]
    const sec = (v: unknown) => (v === null || v === undefined ? null : Math.round(Number(v)))
    return {
      periodo: { from: s.toISOString(), to: new Date(+e - 1).toISOString(), timezone: TZ },
      mensagens: daily.rows,
      conversas_ativas: c.ativas,
      conversas_novas: c.novas,
      /** Dos leads contatados (saída no período), quantos responderam depois. */
      taxa_resposta_lead: rate(c.contacted_replied, c.contacted),
      /** Das conversas com mensagem do lead no período, quantas receberam resposta depois. */
      taxa_resposta_equipe: rate(c.lead_msgs_answered, c.lead_msgs_convs),
      tempo_primeira_resposta_humano_seg: { p50: sec(fr.p50), p90: sec(fr.p90), media: sec(fr.media), amostra: fr.n },
      tempo_resposta_humano_seg: { p50: sec(tr.p50), p90: sec(tr.p90), amostra: tr.n },
      rascunhos: {
        total: dr.total, comparados: dr.comparados, igual: dr.igual, editou: dr.editou,
        diferente: dr.diferente, ignorou: dr.ignorou, usable_rate: rate(dr.igual + dr.editou, dr.comparados),
      },
      por_etapa: stages.rows,
      horarios_pico: hours.rows,
    }
  }
}
