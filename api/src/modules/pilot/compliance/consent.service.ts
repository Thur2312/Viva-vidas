import { BadRequestException, Injectable, Optional } from '@nestjs/common'
import { Db, PgService } from '../pg.service'
import { AuditService, RequestCtx, SYSTEM_CTX } from './audit.service'

export const PURPOSES = ['atendimento', 'qualificacao', 'aprendizado_agente', 'marketing'] as const
export type Purpose = (typeof PURPOSES)[number]
export const LEGAL_BASES = ['consentimento', 'procedimentos_preliminares', 'execucao_contrato', 'legitimo_interesse', 'obrigacao_legal'] as const
export type LegalBasis = (typeof LEGAL_BASES)[number]

/** Finalidades que exigem registro explícito: base `consentimento`, versão do texto e origem. */
export const EXPLICIT_PURPOSES: Purpose[] = ['marketing', 'aprendizado_agente']

/** Tipos de evidência aceitos para consentimento explícito (a referência é obrigatória e auditável). */
export const CONSENT_SOURCE_TYPES = [
  'whatsapp_optin', 'formulario_com_aviso', 'anuncio_click_to_whatsapp', 'ligacao_gravada', 'presencial_assinado', 'cadastro_site',
] as const
const CONSENT_SOURCE_RE = new RegExp('^(' + CONSENT_SOURCE_TYPES.join('|') + '):[^\\s].{2,199}$')

export interface GrantInput {
  purpose: Purpose
  legalBasis?: LegalBasis
  textVersion?: string
  source?: string
}

export interface ContactDecision { allowed: boolean; reason: 'ok' | 'opt_out' | 'anonimizado' | 'marketing_revogado' }

@Injectable()
export class ConsentService {
  constructor(@Optional() private readonly pg: PgService, @Optional() private readonly audit: AuditService) {}

  /** Valida e normaliza. Marketing e aprendizado exigem consentimento explícito, com versão do texto. */
  static normalize(i: GrantInput): GrantInput & { legalBasis: LegalBasis } {
    if (!PURPOSES.includes(i.purpose)) throw new BadRequestException(`Finalidade inválida: ${i.purpose}`)
    const basis = i.legalBasis ?? (EXPLICIT_PURPOSES.includes(i.purpose) ? 'consentimento' : 'procedimentos_preliminares')
    if (!LEGAL_BASES.includes(basis)) throw new BadRequestException(`Base legal inválida: ${basis}`)
    if (EXPLICIT_PURPOSES.includes(i.purpose)) {
      if (basis !== 'consentimento') throw new BadRequestException(`${i.purpose} exige base legal "consentimento"`)
      if (!i.textVersion) throw new BadRequestException(`${i.purpose} exige textVersion (versão do texto apresentado ao titular)`)
      if (!i.source) throw new BadRequestException(`${i.purpose} exige source (origem do consentimento)`)
      // Texto livre não é evidência: a origem precisa ter um tipo conhecido e uma referência rastreável
      // (id do formulário, do anúncio, da gravação, do documento...), no formato `tipo:referencia`.
      if (!CONSENT_SOURCE_RE.test(i.source)) {
        throw new BadRequestException(
          `${i.purpose} exige source no formato "tipo:referencia" com tipo em: ${CONSENT_SOURCE_TYPES.join(', ')}`,
        )
      }
    }
    return { ...i, legalBasis: basis }
  }

  /** Idempotente: se já existe consentimento ativo para a finalidade, devolve-o sem duplicar. */
  async grant(leadId: string, input: GrantInput, ctx: RequestCtx = SYSTEM_CTX, db: Db = this.pg) {
    const c = ConsentService.normalize(input)
    const ins = await db.query(
      `INSERT INTO horizon_agent.consents (lead_id, purpose, legal_basis, text_version, source)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (lead_id, purpose) WHERE revoked_at IS NULL DO NOTHING
       RETURNING *`,
      [leadId, c.purpose, c.legalBasis, c.textVersion ?? null, c.source ?? null],
    )
    if (!ins.rowCount) {
      const cur = await db.query(`SELECT * FROM horizon_agent.consents WHERE lead_id = $1 AND purpose = $2 AND revoked_at IS NULL`, [leadId, c.purpose])
      return { ...cur.rows[0], created: false }
    }
    await this.audit?.log(
      { ...ctx, action: 'consent.grant', entity: 'lead', entityId: leadId, details: { purpose: c.purpose, legalBasis: c.legalBasis, textVersion: c.textVersion, source: c.source } },
      db,
    )
    return { ...ins.rows[0], created: true }
  }

  async revoke(leadId: string, purpose: Purpose, reason = 'solicitacao_titular', ctx: RequestCtx = SYSTEM_CTX, db: Db = this.pg) {
    if (!PURPOSES.includes(purpose)) throw new BadRequestException(`Finalidade inválida: ${purpose}`)
    const r = await db.query(
      `UPDATE horizon_agent.consents SET revoked_at = now(), revoke_reason = $3
       WHERE lead_id = $1 AND purpose = $2 AND revoked_at IS NULL`,
      [leadId, purpose, reason],
    )
    if (r.rowCount) await this.audit?.log({ ...ctx, action: 'consent.revoke', entity: 'lead', entityId: leadId, details: { purpose, reason } }, db)
    return { revoked: r.rowCount ?? 0 }
  }

  async revokeAll(leadId: string, reason: string, ctx: RequestCtx = SYSTEM_CTX, db: Db = this.pg) {
    const r = await db.query(
      `UPDATE horizon_agent.consents SET revoked_at = now(), revoke_reason = $2 WHERE lead_id = $1 AND revoked_at IS NULL RETURNING purpose`,
      [leadId, reason],
    )
    if (r.rowCount) {
      await this.audit?.log({ ...ctx, action: 'consent.revoke_all', entity: 'lead', entityId: leadId, details: { purposes: r.rows.map((x: any) => x.purpose), reason } }, db)
    }
    return { revoked: r.rowCount ?? 0 }
  }

  async list(leadId: string, db: Db = this.pg) {
    return (await db.query(`SELECT * FROM horizon_agent.consents WHERE lead_id = $1 ORDER BY granted_at, id`, [leadId])).rows
  }

  async hasActive(leadId: string, purpose: Purpose, db: Db = this.pg) {
    const r = await db.query(`SELECT 1 FROM horizon_agent.consents WHERE lead_id = $1 AND purpose = $2 AND revoked_at IS NULL LIMIT 1`, [leadId, purpose])
    return !!r.rowCount
  }

  /**
   * can_contact: falso se houver opt-out, se o lead foi anonimizado, ou se o marketing foi revogado
   * (existe registro de marketing revogado e nenhum ativo). Marketing nunca concedido não bloqueia
   * o atendimento reativo; envio ativo de campanha deve checar também `hasActive(lead, 'marketing')`.
   */
  async canContact(lead: { id: string; opt_out?: boolean; anonymized_at?: any }, db: Db = this.pg): Promise<ContactDecision> {
    if (lead.opt_out) return { allowed: false, reason: 'opt_out' }
    if (lead.anonymized_at) return { allowed: false, reason: 'anonimizado' }
    const r = await db.query(
      `SELECT bool_or(revoked_at IS NULL) AS active, count(*)::int AS n FROM horizon_agent.consents WHERE lead_id = $1 AND purpose = 'marketing'`,
      [lead.id],
    )
    const row = r.rows[0]
    if (row && row.n > 0 && !row.active) return { allowed: false, reason: 'marketing_revogado' }
    return { allowed: true, reason: 'ok' }
  }

  /** Aprendizado do agente exige consentimento ativo explícito e ausência de opt-out. */
  async canLearn(lead: { id: string; opt_out?: boolean; anonymized_at?: any }, db: Db = this.pg) {
    if (lead.opt_out || lead.anonymized_at) return false
    return this.hasActive(lead.id, 'aprendizado_agente', db)
  }
}
