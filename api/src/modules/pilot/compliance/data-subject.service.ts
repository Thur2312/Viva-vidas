import { BadRequestException, ConflictException, Injectable, NotFoundException, Optional } from '@nestjs/common'
import { randomUUID } from 'crypto'
import { Db, PgService } from '../pg.service'
import { AuditService, RequestCtx, SYSTEM_CTX } from './audit.service'
import { ConsentService, Purpose } from './consent.service'
import { CryptoService } from './crypto.service'
import { normalizePhone } from './phone'
import { subjectHooks } from './subject-hooks'

export type DsrType = 'acesso' | 'correcao' | 'anonimizacao' | 'eliminacao' | 'revogacao_consentimento'

/**
 * Direitos do titular (LGPD art. 18). Cada operação registra um pedido em `data_subject_requests`
 * (prazo de 15 dias em `due_at`) e uma linha em `audit_log` sem dado pessoal.
 *
 * Atomicidade: o PgService usa um pool (sem transação por request). As operações são ordenadas
 * para cortar primeiro o vínculo com a pessoa (nome/telefone) e depois apagar o conteúdo, e são
 * idempotentes: se uma execução cair no meio, repetir o pedido conclui o trabalho. O pedido fica
 * `em_andamento` até o fim.
 */
@Injectable()
export class DataSubjectService {
  readonly tenant = process.env.PILOT_TENANT || 'alberto'

  constructor(
    @Optional() private readonly pg: PgService,
    @Optional() private readonly crypto: CryptoService,
    @Optional() private readonly consents: ConsentService,
    @Optional() private readonly audit: AuditService,
  ) {
    this.crypto ??= new CryptoService()
    this.audit ??= new AuditService(pg)
    this.consents ??= new ConsentService(pg, this.audit)
  }

  private async getLeadRow(leadId: string, db: Db) {
    const lead = (await db.query(`SELECT * FROM horizon_agent.leads WHERE id = $1 AND tenant = $2`, [leadId, this.tenant])).rows[0]
    if (!lead) throw new NotFoundException('Lead não encontrado')
    return lead
  }

  // ───────────── Pedidos ─────────────
  async openRequest(leadId: string, type: DsrType, ctx: RequestCtx, notes: string | null = null, db: Db = this.pg) {
    const r = await db.query(
      `INSERT INTO horizon_agent.data_subject_requests (lead_id, type, status, requested_by, notes)
       VALUES ($1, $2, 'em_andamento', $3, $4) RETURNING *`,
      [leadId, type, ctx.actor, notes],
    )
    return r.rows[0]
  }

  async closeRequest(id: number, status: 'concluido' | 'negado', notes: string | null = null, db: Db = this.pg) {
    await db.query(
      `UPDATE horizon_agent.data_subject_requests SET status = $2, completed_at = now(), notes = coalesce($3, notes) WHERE id = $1`,
      [id, status, notes],
    )
  }

  async listRequests(opts: { status?: string; limit?: number } = {}, db: Db = this.pg) {
    const params: any[] = []
    let where = ''
    if (opts.status) { params.push(opts.status); where = `WHERE status = $1` }
    params.push(Math.min(200, Math.max(1, opts.limit ?? 50)))
    const { rows } = await db.query(
      `SELECT id, lead_id, type, status, requested_by, requested_at, due_at, completed_at, notes,
              (status IN ('aberto','em_andamento') AND due_at < now()) AS overdue
       FROM horizon_agent.data_subject_requests ${where} ORDER BY requested_at DESC LIMIT $${params.length}`,
      params,
    )
    return rows
  }

  // ───────────── Acesso / portabilidade ─────────────
  async exportLead(leadId: string, ctx: RequestCtx, db: Db = this.pg) {
    const lead = await this.getLeadRow(leadId, db)
    const req = await this.openRequest(leadId, 'acesso', ctx, null, db)
    const q = async (sql: string) => (await db.query(sql, [leadId])).rows

    const events = await q(`SELECT type, actor, value, payload, occurred_at FROM horizon_agent.lead_events WHERE lead_id = $1 ORDER BY occurred_at`)
    const conversations = await q(`SELECT id, channel, mode, external_ref, summary, created_at FROM horizon_agent.conversations WHERE lead_id = $1 ORDER BY created_at`)
    const messages = (
      await q(
        `SELECT m.id, m.conversation_id, m.direction, m.author, m.body, m.created_at FROM horizon_agent.messages m
         JOIN horizon_agent.conversations c ON c.id = m.conversation_id WHERE c.lead_id = $1 ORDER BY m.created_at`,
      )
    ).map((m) => ({ ...m, body: this.crypto.decrypt(m.body) }))
    const drafts = (
      await q(
        `SELECT d.id, d.conversation_id, d.draft_body, d.model, d.stage_guess, d.qualified_guess, d.next_action_guess, d.reasoning,
                d.similarity, d.human_action, d.created_at
         FROM horizon_agent.agent_drafts d JOIN horizon_agent.conversations c ON c.id = d.conversation_id
         WHERE c.lead_id = $1 ORDER BY d.created_at`,
      )
    ).map((d) => ({ ...d, draft_body: this.crypto.decrypt(d.draft_body) }))
    const reviews = await q(`SELECT agent_stage, human_stage, agent_qualified, human_qualified, reviewed_at FROM horizon_agent.qualification_reviews WHERE lead_id = $1 ORDER BY reviewed_at`)
    const learned = await q(
      `SELECT id, situation, lead_message, human_reply, tags, outcome, approved, pii_redacted, contains_sensitive, created_at
       FROM horizon_agent.learned_examples
       WHERE source_lead_id = $1
          OR source_message_id IN (SELECT m.id FROM horizon_agent.messages m JOIN horizon_agent.conversations c ON c.id = m.conversation_id WHERE c.lead_id = $1)
       ORDER BY created_at`,
    )
    const consents = await this.consents.list(leadId, db)
    const requests = await q(`SELECT id, type, status, requested_at, due_at, completed_at FROM horizon_agent.data_subject_requests WHERE lead_id = $1 ORDER BY requested_at`)

    // Módulos externos (ex.: voz) entregam o que guardam do titular. Falha aqui NÃO é engolida.
    const extensions: Record<string, unknown> = {}
    for (const h of subjectHooks()) if (h.exportLead) extensions[h.name] = await h.exportLead(leadId, db)

    await this.closeRequest(req.id, 'concluido', null, db)
    await this.audit.log(
      {
        ...ctx, action: 'lead.export', entity: 'lead', entityId: leadId,
        details: { requestId: Number(req.id), messages: messages.length, drafts: drafts.length, learnedExamples: learned.length },
      },
      db,
    )
    return {
      generatedAt: new Date().toISOString(),
      requestId: Number(req.id),
      lead, // telefone completo: só no detalhe do lead e aqui
      events, conversations, messages, drafts,
      qualificationReviews: reviews,
      learnedExamples: learned,
      consents, requests,
      extensions,
    }
  }

  // ───────────── Correção ─────────────
  async correct(leadId: string, patch: { name?: string; phone?: string; qualification?: Record<string, unknown> }, ctx: RequestCtx, db: Db = this.pg) {
    const lead = await this.getLeadRow(leadId, db)
    if (lead.anonymized_at) throw new BadRequestException('Lead anonimizado não pode ser corrigido')
    const fields = Object.keys(patch).filter((k) => (patch as any)[k] !== undefined)
    if (!fields.length) throw new BadRequestException('Nada para corrigir')
    const phone = patch.phone !== undefined ? normalizePhone(patch.phone) : null
    const req = await this.openRequest(leadId, 'correcao', ctx, `campos: ${fields.join(', ')}`, db)
    if (phone) {
      const dup = await db.query(`SELECT 1 FROM horizon_agent.leads WHERE tenant = $1 AND phone = $2 AND id <> $3 LIMIT 1`, [this.tenant, phone, leadId])
      if (dup.rowCount) {
        await this.closeRequest(req.id, 'negado', 'telefone ja existe', db)
        throw new ConflictException('Já existe outro lead com esse telefone')
      }
    }
    try {
      const r = await db.query(
        `UPDATE horizon_agent.leads SET
           name = CASE WHEN $2::boolean THEN $3 ELSE name END,
           phone = coalesce($4, phone),
           qualification = CASE WHEN $5::jsonb IS NULL THEN qualification ELSE qualification || $5::jsonb END,
           updated_at = now()
         WHERE id = $1 RETURNING *`,
        [leadId, patch.name !== undefined, patch.name ?? null, phone, patch.qualification ? JSON.stringify(patch.qualification) : null],
      )
      await this.closeRequest(req.id, 'concluido', null, db)
      await this.audit.log({ ...ctx, action: 'lead.correct', entity: 'lead', entityId: leadId, details: { requestId: Number(req.id), fields } }, db)
      return r.rows[0]
    } catch (e: any) {
      await this.closeRequest(req.id, 'negado', e?.code === '23505' ? 'telefone ja existe' : 'erro', db)
      if (e?.code === '23505') throw new ConflictException('Já existe outro lead com esse telefone')
      throw e
    }
  }

  // ───────────── Anonimização (irreversível) ─────────────
  /**
   * Anonimiza o lead: nome nulo; telefone vira `anon:<hash salgado>` SOMENTE se havia opt-out (para
   * manter o bloqueio), senão `anon:<aleatório>`; apaga conversas, mensagens, rascunhos e exemplos
   * aprendidos derivados; zera qualificação, origem pessoal, ids externos e payload dos eventos.
   * Mantém só o que é estatística sem pessoa: tipos/valores de evento, etapa e campanha de origem.
   */
  async anonymizeLead(leadId: string, ctx: RequestCtx, opts: { request?: boolean; notes?: string } = {}, db: Db = this.pg) {
    const lead = await this.getLeadRow(leadId, db)
    const withRequest = opts.request !== false
    const req = withRequest ? await this.openRequest(leadId, 'anonimizacao', ctx, opts.notes ?? null, db) : null

    const stats = { messages: 0, drafts: 0, learnedExamples: 0, conversations: 0 }
    // 1) corta o vínculo com a pessoa primeiro
    if (!lead.anonymized_at) {
      const hash = lead.opt_out ? this.crypto.hashPhone(lead.phone) : null
      await db.query(
        `UPDATE horizon_agent.leads SET
           name = NULL, phone = $2, phone_hash = $3, qualification = '{}'::jsonb,
           source = jsonb_strip_nulls(jsonb_build_object('campaign_id', source->'campaign_id', 'campaign_name', source->'campaign_name')),
           pipedrive_ids = '{}'::jsonb, opt_in_origin = NULL, anonymized_at = now(), updated_at = now()
         WHERE id = $1`,
        [leadId, `anon:${hash ?? randomUUID()}`, hash],
      )
    }
    // 2) apaga o que foi derivado e o conteúdo (inclui dados de módulos externos, ex.: gravações de voz)
    const ext: Record<string, number> = {}
    for (const h of subjectHooks()) if (h.anonymizeLead) Object.assign(ext, await h.anonymizeLead(leadId, ctx, db))
    const ex = await db.query(
      `DELETE FROM horizon_agent.learned_examples
       WHERE source_lead_id = $1
          OR source_message_id IN (SELECT m.id FROM horizon_agent.messages m JOIN horizon_agent.conversations c ON c.id = m.conversation_id WHERE c.lead_id = $1)`,
      [leadId],
    )
    stats.learnedExamples = ex.rowCount ?? 0
    stats.drafts = (
      await db.query(`DELETE FROM horizon_agent.agent_drafts WHERE conversation_id IN (SELECT id FROM horizon_agent.conversations WHERE lead_id = $1)`, [leadId])
    ).rowCount ?? 0
    stats.messages = (
      await db.query(`DELETE FROM horizon_agent.messages WHERE conversation_id IN (SELECT id FROM horizon_agent.conversations WHERE lead_id = $1)`, [leadId])
    ).rowCount ?? 0
    stats.conversations = (await db.query(`DELETE FROM horizon_agent.conversations WHERE lead_id = $1`, [leadId])).rowCount ?? 0
    await db.query(`UPDATE horizon_agent.lead_events SET payload = '{}'::jsonb WHERE lead_id = $1 AND payload <> '{}'::jsonb`, [leadId])
    await this.consents.revokeAll(leadId, 'anonimizacao', ctx, db)

    if (req) await this.closeRequest(req.id, 'concluido', opts.notes ?? null, db)
    await this.audit.log(
      { ...ctx, action: 'lead.anonymize', entity: 'lead', entityId: leadId, details: { requestId: req ? Number(req.id) : null, optOutKept: !!lead.opt_out, ...stats, ...ext } },
      db,
    )
    return { anonymized: true, optOutBlockKept: !!lead.opt_out, ...stats }
  }

  // ───────────── Eliminação ─────────────
  /**
   * Apaga o lead e tudo que depende dele (FK em cascata). Exceção: lead com opt-out é anonimizado
   * em vez de apagado, porque o bloqueio de contato precisa sobreviver (legítimo para cumprir o pedido).
   */
  async eraseLead(leadId: string, ctx: RequestCtx, db: Db = this.pg) {
    const lead = await this.getLeadRow(leadId, db)
    if (lead.opt_out) {
      const r = await this.anonymizeLead(leadId, ctx, { request: false }, db)
      const req = await this.openRequest(leadId, 'eliminacao', ctx, 'opt-out: anonimizado para manter o bloqueio de contato', db)
      await this.closeRequest(req.id, 'concluido', null, db)
      return { erased: false, ...r }
    }
    const req = await this.openRequest(leadId, 'eliminacao', ctx, null, db)
    // o que vive fora do banco (gravações no provedor) precisa ser apagado ANTES das linhas caírem por cascata
    const ext: Record<string, number> = {}
    for (const h of subjectHooks()) if (h.eraseLead) Object.assign(ext, await h.eraseLead(leadId, ctx, db))
    // exemplos derivados sem source_lead_id (linhas antigas) não são alcançados pela cascata
    await db.query(
      `DELETE FROM horizon_agent.learned_examples
       WHERE source_lead_id = $1
          OR source_message_id IN (SELECT m.id FROM horizon_agent.messages m JOIN horizon_agent.conversations c ON c.id = m.conversation_id WHERE c.lead_id = $1)`,
      [leadId],
    )
    await this.audit.log({ ...ctx, action: 'lead.erase', entity: 'lead', entityId: leadId, details: { requestId: Number(req.id), ...ext } }, db)
    await db.query(`DELETE FROM horizon_agent.leads WHERE id = $1`, [leadId])
    await this.closeRequest(req.id, 'concluido', null, db)
    return { erased: true }
  }

  // ───────────── Revogação de consentimento ─────────────
  async revokeConsent(leadId: string, purpose: Purpose, ctx: RequestCtx, db: Db = this.pg) {
    await this.getLeadRow(leadId, db)
    const req = await this.openRequest(leadId, 'revogacao_consentimento', ctx, `finalidade: ${purpose}`, db)
    const r = await this.consents.revoke(leadId, purpose, 'solicitacao_titular', ctx, db)
    await this.closeRequest(req.id, 'concluido', r.revoked ? null : 'sem consentimento ativo', db)
    return r
  }
}

export { SYSTEM_CTX }
