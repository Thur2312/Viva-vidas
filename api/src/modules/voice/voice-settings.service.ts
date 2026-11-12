import { BadRequestException, Inject, Injectable, Optional } from '@nestjs/common'
import { createHash } from 'crypto'
import { Db, PgService } from '../pilot/pg.service'
import { AuditService, RequestCtx } from '../pilot/compliance/audit.service'
import { CallWindow, isValidWindow, voiceEnv } from './voice.config'

export interface EffectiveSettings {
  callWindow: CallWindow
  callWindowSource: 'painel' | 'ambiente' | 'padrao'
  dncEnabled: boolean
  dncEnabledByEnv: boolean
  dncEnabledBySetting: boolean
  announcementText: string | null
  announcementVersion: string | null
  announcementConfigured: boolean
  updatedAt: string | null
}

export interface SettingsPatch {
  callWindow?: CallWindow
  dncEnabled?: boolean
  announcementText?: string | null
}

const MAX_ANNOUNCEMENT = 600

@Injectable()
export class VoiceSettingsService {
  constructor(@Optional() @Inject(PgService) private readonly pg: PgService, @Optional() private readonly audit: AuditService) {}

  async get(db: Db = this.pg): Promise<EffectiveSettings> {
    const row = (await db.query(`SELECT * FROM horizon_agent.voice_settings WHERE tenant = $1`, [voiceEnv.tenant()])).rows[0]
    const envWin = process.env.VOICE_CALL_WINDOW?.trim()
    const stored = row?.call_window && isValidWindow(row.call_window) ? (row.call_window as CallWindow) : null
    const byEnv = voiceEnv.dncEnabled()
    const bySetting = !!row?.dnc_enabled
    const text = (row?.announcement_text ?? '').trim() || null
    return {
      callWindow: stored ?? voiceEnv.windowDefault(),
      callWindowSource: stored ? 'painel' : envWin ? 'ambiente' : 'padrao',
      // O mais restritivo vence: ligado no ambiente OU no painel => ligado.
      dncEnabled: byEnv || bySetting,
      dncEnabledByEnv: byEnv,
      dncEnabledBySetting: bySetting,
      announcementText: text,
      announcementVersion: text ? row?.announcement_version ?? null : null,
      announcementConfigured: !!text,
      updatedAt: row?.updated_at ? new Date(row.updated_at).toISOString() : null,
    }
  }

  async put(patch: SettingsPatch, ctx: RequestCtx, db: Db = this.pg): Promise<EffectiveSettings> {
    if (patch.callWindow !== undefined && !isValidWindow(patch.callWindow)) {
      throw new BadRequestException('Janela inválida: informe dias (0-6), início e fim (HH:MM, início < fim) e um fuso horário válido.')
    }
    let text: string | null | undefined = patch.announcementText
    if (typeof text === 'string') {
      text = text.trim()
      if (text.length > MAX_ANNOUNCEMENT) throw new BadRequestException(`O aviso de gravação pode ter no máximo ${MAX_ANNOUNCEMENT} caracteres.`)
      if (text.length === 0) text = null
    }
    const cur = (await db.query(`SELECT announcement_text, announcement_version FROM horizon_agent.voice_settings WHERE tenant = $1`, [voiceEnv.tenant()])).rows[0]
    const version = text === undefined ? cur?.announcement_version ?? null : text ? 'v' + createHash('sha256').update(text).digest('hex').slice(0, 8) : null
    await db.query(
      `INSERT INTO horizon_agent.voice_settings (tenant, call_window, dnc_enabled, announcement_text, announcement_version, updated_by)
       VALUES ($1, $2::jsonb, coalesce($3::boolean, false), $4::text, $5::text, $6)
       ON CONFLICT (tenant) DO UPDATE SET
         call_window = CASE WHEN $7::boolean THEN excluded.call_window ELSE horizon_agent.voice_settings.call_window END,
         dnc_enabled = CASE WHEN $3::boolean IS NULL THEN horizon_agent.voice_settings.dnc_enabled ELSE $3::boolean END,
         announcement_text = CASE WHEN $8::boolean THEN excluded.announcement_text ELSE horizon_agent.voice_settings.announcement_text END,
         announcement_version = CASE WHEN $8::boolean THEN excluded.announcement_version ELSE horizon_agent.voice_settings.announcement_version END,
         updated_by = excluded.updated_by, updated_at = now()`,
      [
        voiceEnv.tenant(), patch.callWindow ? JSON.stringify(patch.callWindow) : null, patch.dncEnabled ?? null,
        text ?? null, version, ctx.actor, patch.callWindow !== undefined, text !== undefined,
      ],
    )
    await this.audit?.log(
      {
        ...ctx, action: 'voice.settings.update', entity: 'voice_settings', entityId: voiceEnv.tenant(),
        details: {
          fields: Object.keys(patch).filter((k) => (patch as any)[k] !== undefined),
          announcementVersion: version, dncEnabled: patch.dncEnabled ?? undefined,
        },
      },
      db,
    )
    return this.get(db)
  }
}
