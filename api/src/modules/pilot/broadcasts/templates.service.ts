import { BadRequestException, Injectable } from '@nestjs/common'
import { ChatGatewayService, TemplateInfo } from '../../chat-gateway/chat-gateway.service'
import { PgService } from '../pg.service'
import { AuditService, RequestCtx } from '../compliance/audit.service'
import { CreateTemplateDto } from './broadcasts.dto'
import { DRAFT_TEMPLATES, TemplateButton, assertValidTemplate } from './template-rules'

export const SYNC_MIN_INTERVAL_MS = 60_000
export const FRESH_MS = 10 * 60_000
export const STALE_FAIL_CLOSED_MS = 60 * 60_000

export interface CachedTemplate {
  name: string; language: string; category: string | null; status: string; rejected_reason: string | null
  body_text: string | null; footer_text: string | null; buttons: TemplateButton[]; synced_at: string | Date
}

type ChatTemplate = TemplateInfo & { body_text?: string | null; footer_text?: string | null; buttons?: TemplateButton[] }

@Injectable()
export class TemplatesService {
  private lastSyncAttempt = 0

  constructor(private readonly pg: PgService, private readonly gateway: ChatGatewayService, private readonly audit: AuditService) {}

  chatState() {
    const s = this.gateway.status()
    return { configured: s.configured, missing: s.missing }
  }

  async cached(): Promise<CachedTemplate[]> {
    return (await this.pg.query(`SELECT * FROM horizon_agent.message_templates_cache ORDER BY name, language`)).rows
  }

  async get(name: string, language = 'pt_BR'): Promise<CachedTemplate | null> {
    return (await this.pg.query(`SELECT * FROM horizon_agent.message_templates_cache WHERE name = $1 AND language = $2`, [name, language])).rows[0] ?? null
  }

  /** Sincroniza com a Meta via chat. Nunca lança: devolve o motivo da falha. */
  async sync(force = false): Promise<{ ok: boolean; error?: 'chat_nao_configurado' | 'chat_indisponivel' | 'intervalo_minimo'; count?: number }> {
    if (!this.gateway.configured()) return { ok: false, error: 'chat_nao_configurado' }
    const now = Date.now()
    if (!force && now - this.lastSyncAttempt < SYNC_MIN_INTERVAL_MS) return { ok: false, error: 'intervalo_minimo' }
    this.lastSyncAttempt = now
    try {
      const list = (await this.gateway.listTemplates()) as ChatTemplate[]
      for (const t of list) {
        if (!t?.name) continue
        await this.pg.query(
          `INSERT INTO horizon_agent.message_templates_cache (name, language, category, status, rejected_reason, body_text, footer_text, buttons, synced_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, coalesce($8::jsonb, '[]'::jsonb), now())
           ON CONFLICT (name, language) DO UPDATE SET
             category = EXCLUDED.category, status = EXCLUDED.status, rejected_reason = EXCLUDED.rejected_reason,
             body_text = coalesce(EXCLUDED.body_text, horizon_agent.message_templates_cache.body_text),
             footer_text = coalesce(EXCLUDED.footer_text, horizon_agent.message_templates_cache.footer_text),
             buttons = CASE WHEN $8::jsonb IS NULL THEN horizon_agent.message_templates_cache.buttons ELSE EXCLUDED.buttons END,
             synced_at = now()`,
          [t.name, t.language || 'pt_BR', t.category ?? null, String(t.status || 'PENDING').toUpperCase(), t.rejected_reason ?? null,
            t.body_text ?? null, t.footer_text ?? null, t.buttons ? JSON.stringify(t.buttons) : null],
        )
      }
      return { ok: true, count: list.length }
    } catch {
      return { ok: false, error: 'chat_indisponivel' }
    }
  }

  /**
   * Status do template no momento do envio. Cache com mais de 10 min tenta sincronizar; se não der e o cache
   * tiver mais de 1h, devolve null (falha FECHADO: ninguém envia com status desconhecido).
   */
  async ensureFresh(name: string, language = 'pt_BR'): Promise<CachedTemplate | null> {
    let t = await this.get(name, language)
    const age = t ? Date.now() - new Date(t.synced_at).getTime() : Infinity
    if (age > FRESH_MS) {
      await this.sync(true)
      t = await this.get(name, language)
    }
    if (!t) return null
    if (Date.now() - new Date(t.synced_at).getTime() > STALE_FAIL_CLOSED_MS) return null
    return t
  }

  async list(refresh: boolean) {
    let sync: Awaited<ReturnType<TemplatesService['sync']>> | null = null
    if (refresh) sync = await this.sync(false)
    const templates = await this.cached()
    const byName = new Map(templates.map((t) => [t.name, t]))
    const drafts = DRAFT_TEMPLATES.map((d) => {
      const c = byName.get(d.name)
      return {
        ...d,
        state: c ? c.status : 'NAO_CRIADO',
        rejectedReason: c?.rejected_reason ?? null,
      }
    })
    return {
      chat: this.chatState(),
      syncedAt: templates.length ? templates.reduce((m, t) => (new Date(t.synced_at) > new Date(m) ? String(t.synced_at) : m), String(templates[0].synced_at)) : null,
      syncError: sync && !sync.ok && sync.error !== 'intervalo_minimo' ? sync.error : null,
      data: templates.map((t) => ({
        name: t.name, language: t.language, category: t.category, status: t.status, rejectedReason: t.rejected_reason,
        bodyText: t.body_text, footerText: t.footer_text, buttons: t.buttons, syncedAt: t.synced_at,
      })),
      drafts,
    }
  }

  async create(dto: CreateTemplateDto, ctx: RequestCtx) {
    assertValidTemplate(dto)
    if (!this.gateway.configured()) throw new BadRequestException('Chat não configurado: o template não pode ser enviado à Meta ainda.')
    const language = dto.language || 'pt_BR'
    await this.gateway.createTemplate({
      name: dto.name, category: dto.category, language, bodyText: dto.bodyText, bodyExamples: dto.bodyExamples,
      footerText: dto.footerText, buttons: dto.buttons,
    })
    await this.pg.query(
      `INSERT INTO horizon_agent.message_templates_cache (name, language, category, status, body_text, footer_text, buttons, synced_at)
       VALUES ($1, $2, $3, 'PENDING', $4, $5, $6::jsonb, now())
       ON CONFLICT (name, language) DO UPDATE SET category = EXCLUDED.category, status = 'PENDING', rejected_reason = NULL,
         body_text = EXCLUDED.body_text, footer_text = EXCLUDED.footer_text, buttons = EXCLUDED.buttons, synced_at = now()`,
      [dto.name, language, dto.category, dto.bodyText, dto.footerText ?? null, JSON.stringify(dto.buttons ?? [])],
    )
    await this.audit.log({ ...ctx, action: 'broadcast.template_create', entity: 'template', entityId: dto.name, details: { category: dto.category, language } })
    return { name: dto.name, language, status: 'PENDING', message: 'Enviado à Meta. Aguardando aprovação.' }
  }
}
