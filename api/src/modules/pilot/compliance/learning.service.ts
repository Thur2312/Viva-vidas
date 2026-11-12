import { Injectable, Optional } from '@nestjs/common'
import { Db, PgService } from '../pg.service'
import { ConsentService } from './consent.service'
import { CryptoService } from './crypto.service'
import { flagSensitive, redactPii } from './redaction'
import { AuditService } from './audit.service'

/**
 * Aprendizado em modo sombra: transforma a resposta real do colaborador em candidato a exemplo.
 * Regras: só com consentimento ativo `aprendizado_agente` e sem opt-out; o texto passa por redação
 * ANTES de ser gravado (`pii_redacted = true` só depois disso); o exemplo nasce sempre `approved = false`
 * (aprovação é humana) e conteúdo de saúde fica marcado em `contains_sensitive`.
 */
@Injectable()
export class LearningService {
  constructor(
    @Optional() private readonly pg: PgService,
    @Optional() private readonly consents: ConsentService,
    @Optional() private readonly crypto: CryptoService,
  ) {
    this.crypto ??= new CryptoService()
    this.consents ??= new ConsentService(pg, new AuditService(pg))
  }

  async capture(
    lead: { id: string; name?: string | null; phone?: string | null; stage?: string; opt_out?: boolean; anonymized_at?: any },
    conversationId: string,
    humanMessageId: number,
    humanBody: string,
    db: Db = this.pg,
  ): Promise<{ created: boolean; reason?: string; id?: number }> {
    if (!(await this.consents.canLearn(lead, db))) return { created: false, reason: 'sem_consentimento_ou_opt_out' }

    const prev = (
      await db.query(
        `SELECT body FROM horizon_agent.messages
         WHERE conversation_id = $1 AND author = 'lead' AND id < $2 ORDER BY id DESC LIMIT 1`,
        [conversationId, humanMessageId],
      )
    ).rows[0]
    if (!prev) return { created: false, reason: 'sem_mensagem_do_lead' }

    const leadMsg = this.crypto.decrypt(prev.body)
    const sensitive = flagSensitive(leadMsg).containsSensitive || flagSensitive(humanBody).containsSensitive
    const who = { leadNames: lead.name ? [lead.name] : [], phones: lead.phone ? [lead.phone] : [] }
    const lm = redactPii(leadMsg, who).text
    const hr = redactPii(humanBody, who).text
    if (!lm.trim() || !hr.trim()) return { created: false, reason: 'vazio_apos_redacao' }

    const r = await db.query(
      `INSERT INTO horizon_agent.learned_examples
         (situation, lead_message, human_reply, approved, pii_redacted, contains_sensitive, source_message_id, source_lead_id)
       VALUES ($1, $2, $3, false, true, $4, $5, $6) RETURNING id`,
      [`Etapa do lead: ${lead.stage ?? 'desconhecida'}`, lm, hr, sensitive, humanMessageId, lead.id],
    )
    return { created: true, id: Number(r.rows[0].id) }
  }
}
