import { Injectable, Logger, Optional } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { Db, PgService } from '../pg.service'
import { AuditService, RequestCtx, SYSTEM_CTX } from './audit.service'
import { DataSubjectService } from './data-subject.service'
import { subjectHooks } from './subject-hooks'

const envDays = (name: string, def: number) => {
  const n = Number(process.env[name])
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : def
}

export interface RetentionConfig { messagesDays: number; draftsDays: number; leadsDays: number }
export interface RetentionResult extends RetentionConfig { drafts: number; messages: number; leadsAnonymized: number; at: string; extensions: Record<string, number> }

const DAY = 86_400_000
const LEADS_BATCH = 500

/**
 * Retenção (LGPD art. 15 e 16). Padrões: mensagens 180 dias, rascunhos 180 dias, leads inativos 730 dias
 * (anonimizados, não apagados). Leads na etapa `venda` NÃO são anonimizados automaticamente: podem ter
 * obrigação legal/contratual de guarda (art. 16, I). Prazo e base dessa guarda são decisão do controlador.
 * Idempotente: rodar de novo logo em seguida não encontra mais nada. Sempre restrito ao tenant do piloto.
 */
@Injectable()
export class RetentionService {
  private readonly log = new Logger(RetentionService.name)
  readonly tenant = process.env.PILOT_TENANT || 'alberto'

  constructor(
    @Optional() private readonly pg: PgService,
    @Optional() private readonly subjects: DataSubjectService,
    @Optional() private readonly audit: AuditService,
  ) {
    this.audit ??= new AuditService(pg)
    this.subjects ??= new DataSubjectService(pg, undefined, undefined, this.audit)
  }

  config(): RetentionConfig {
    return {
      messagesDays: envDays('PILOT_RETENTION_MESSAGES_DAYS', 180),
      draftsDays: envDays('PILOT_RETENTION_DRAFTS_DAYS', 180),
      leadsDays: envDays('PILOT_RETENTION_LEADS_DAYS', 730),
    }
  }

  // 03:30 no horário de Brasília, fora do horário de atendimento.
  @Cron('30 3 * * *', { name: 'pilot-retention', timeZone: 'America/Sao_Paulo' })
  async scheduled() {
    try {
      const r = await this.run()
      this.log.log(`Retenção: ${r.drafts} rascunhos, ${r.messages} mensagens, ${r.leadsAnonymized} leads anonimizados`)
    } catch (e: any) {
      // Só a mensagem do erro, que não carrega conteúdo de mensagem nem telefone.
      this.log.error(`Retenção falhou: ${String(e?.message ?? e).slice(0, 200)}`)
    }
  }

  async run(opts: { now?: Date; ctx?: RequestCtx; db?: Db } = {}): Promise<RetentionResult> {
    const db = opts.db ?? this.pg
    const ctx = opts.ctx ?? SYSTEM_CTX
    const now = opts.now ?? new Date()
    const cfg = this.config()
    const cut = (days: number) => new Date(now.getTime() - days * DAY)

    const drafts = (
      await db.query(
        `DELETE FROM horizon_agent.agent_drafts d USING horizon_agent.conversations c, horizon_agent.leads l
         WHERE d.conversation_id = c.id AND c.lead_id = l.id AND l.tenant = $1 AND d.created_at < $2`,
        [this.tenant, cut(cfg.draftsDays)],
      )
    ).rowCount ?? 0

    // Apagar a mensagem derruba os rascunhos que ela disparou (FK em cascata).
    const messages = (
      await db.query(
        `DELETE FROM horizon_agent.messages m USING horizon_agent.conversations c, horizon_agent.leads l
         WHERE m.conversation_id = c.id AND c.lead_id = l.id AND l.tenant = $1 AND m.created_at < $2`,
        [this.tenant, cut(cfg.messagesDays)],
      )
    ).rowCount ?? 0

    const stale = (
      await db.query(
        `SELECT l.id FROM horizon_agent.leads l
         WHERE l.tenant = $1 AND l.anonymized_at IS NULL AND l.stage <> 'venda'
           AND greatest(
                 l.updated_at,
                 coalesce((SELECT max(e.occurred_at) FROM horizon_agent.lead_events e WHERE e.lead_id = l.id), l.created_at),
                 coalesce((SELECT max(m.created_at) FROM horizon_agent.messages m JOIN horizon_agent.conversations c ON c.id = m.conversation_id WHERE c.lead_id = l.id), l.created_at)
               ) < $2
         ORDER BY l.updated_at LIMIT ${LEADS_BATCH}`,
        [this.tenant, cut(cfg.leadsDays)],
      )
    ).rows
    for (const row of stale) await this.subjects.anonymizeLead(row.id, ctx, { request: false, notes: 'retencao' }, db)

    // Módulos externos (ex.: voz: gravações e transcrições vencidas). Falha de um não derruba a retenção.
    const extensions: Record<string, number> = {}
    for (const h of subjectHooks()) {
      if (!h.purgeExpired) continue
      try { Object.assign(extensions, await h.purgeExpired(now, ctx, db)) } catch { extensions[`${h.name}Erro`] = 1 }
    }

    const result: RetentionResult = { ...cfg, drafts, messages, leadsAnonymized: stale.length, at: now.toISOString(), extensions }
    await this.audit.log(
      { ...ctx, action: 'retention.purge', entity: 'retention', details: { ...cfg, drafts, messages, leadsAnonymized: stale.length, ...extensions } },
      db,
    )
    return result
  }
}
