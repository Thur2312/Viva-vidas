import {
  BadGatewayException, Inject, Injectable, Logger, NotFoundException, OnModuleInit, Optional, ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common'
import { randomUUID } from 'crypto'
import { Db, PgService } from '../pilot/pg.service'
import { AuditService, RequestCtx, SYSTEM_CTX } from '../pilot/compliance/audit.service'
import { ConsentService } from '../pilot/compliance/consent.service'
import { CryptoService } from '../pilot/compliance/crypto.service'
import { maskPhone } from '../pilot/compliance/phone'
import { flagSensitive } from '../pilot/compliance/redaction'
import { registerSubjectHook, SubjectDataHook } from '../pilot/compliance/subject-hooks'
import { ParsedRecording, ParsedStatus, ProviderNotConfiguredError, TelephonyAdapter } from './telephony/telephony.types'
import { SttProvider } from './providers/stt'
import { TtsProvider } from './providers/tts'
import { DNC_CHECKER, DncChecker, STT, TELEPHONY, TTS } from './voice.tokens'
import { VoiceSettingsService } from './voice-settings.service'
import { evaluateGates, GateFailure, isTerminal, nextStatus } from './voice-gates'
import { missingOf, toE164, voiceEnv } from './voice.config'
import { CALL_STATUSES, CallStatus, TranscriptSegment } from './voice.types'

const DAY = 86_400_000
const ACTIVE_WINDOW_MS = 15 * 60_000

/** Estados de origem que ainda aceitam a transição para `incoming` (SQL atômico, sem corrida entre webhooks). */
export function statusesBefore(incoming: CallStatus): CallStatus[] {
  return CALL_STATUSES.filter((s) => !isTerminal(s) && nextStatus(s, incoming).apply)
}

@Injectable()
export class VoiceService implements OnModuleInit {
  private readonly log = new Logger(VoiceService.name)

  constructor(
    @Optional() @Inject(PgService) private readonly pg: PgService,
    @Inject(TELEPHONY) private readonly telephony: TelephonyAdapter,
    @Inject(TTS) private readonly tts: TtsProvider,
    @Inject(STT) private readonly stt: SttProvider,
    @Optional() @Inject(DNC_CHECKER) private readonly dnc: DncChecker | null,
    private readonly settings: VoiceSettingsService,
    private readonly consents: ConsentService,
    private readonly audit: AuditService,
    private readonly crypto: CryptoService,
  ) {}

  onModuleInit() {
    registerSubjectHook(this.subjectHook())
  }

  // ───────────── Status honesto ─────────────
  async status(db: Db = this.pg) {
    const s = await this.settings.get(db)
    const tel = this.telephony.status()
    const base = voiceEnv.webhookBase()
    const telMissing = [...tel.missing, ...missingOf(['VOICE_WEBHOOK_BASE_URL', 'VOICE_OPERATOR_PHONE'])]
    const dncConfigured = !!this.dnc?.isConfigured()
    const ready = tel.ready && telMissing.length === tel.missing.length // tudo que a ligação precisa está presente
    return {
      telephony: { provider: tel.provider, configured: tel.configured, ready, missing: telMissing },
      tts: this.tts.status(),
      stt: this.stt.status(),
      recording: {
        announcementConfigured: s.announcementConfigured,
        announcementVersion: s.announcementVersion,
        retentionDays: voiceEnv.recordingRetentionDays(),
        retentionPendingClientConfirmation: !process.env.VOICE_RECORDING_RETENTION_DAYS,
      },
      dnc: { enabled: s.dncEnabled, configured: dncConfigured, blocking: s.dncEnabled && !dncConfigured },
      callWindow: { ...s.callWindow, source: s.callWindowSource },
      webhookUrl: base ? `${base}/voice/webhooks/${tel.provider === 'disabled' ? 'twilio' : tel.provider}` : null,
      canPlaceCalls: ready && s.announcementConfigured && (!s.dncEnabled || dncConfigured),
    }
  }

  // ───────────── Ligar ─────────────
  private async refuse(ctx: RequestCtx, code: string, leadId: string | null, db: Db) {
    await this.audit.log({ ...ctx, action: 'voice.call.refused', entity: 'lead', entityId: leadId, details: { code, provider: this.telephony.id } }, db).catch(() => undefined)
  }

  async placeCall(leadId: string, ctx: RequestCtx, db: Db = this.pg, now = new Date()) {
    // 1) provedor e infraestrutura: 503 se faltar algo
    const tel = this.telephony.status()
    const missing = [...tel.missing, ...missingOf(['VOICE_WEBHOOK_BASE_URL', 'VOICE_OPERATOR_PHONE'])]
    if (!tel.ready || missing.length) {
      await this.refuse(ctx, 'provedor_nao_configurado', leadId, db)
      throw new ServiceUnavailableException({ code: 'provedor_nao_configurado', message: 'A telefonia ainda não está configurada.', missing })
    }
    const operatorPhone = toE164(voiceEnv.operatorPhone())
    if (!operatorPhone) {
      await this.refuse(ctx, 'telefone_operador_invalido', leadId, db)
      throw new ServiceUnavailableException({ code: 'telefone_operador_invalido', message: 'VOICE_OPERATOR_PHONE inválido.', missing: ['VOICE_OPERATOR_PHONE'] })
    }

    // 2) portões de conformidade (todos falham fechado)
    const lead = (await db.query(`SELECT id, phone, opt_out, anonymized_at FROM horizon_agent.leads WHERE id = $1 AND tenant = $2`, [leadId, voiceEnv.tenant()])).rows[0] ?? null
    const s = await this.settings.get(db)
    const phoneE164 = lead && !String(lead.phone).startsWith('anon:') ? toE164(lead.phone) : null
    let dnc: { configured: boolean; blocked?: boolean } | null = null
    const canContact = lead ? await this.consents.canContact(lead, db) : null
    const hasConsent = lead ? await this.consents.hasActive(lead.id, 'atendimento', db) : false
    // DNC só é consultado se todo o resto já passou (evita consulta externa desnecessária com o número).
    let gate: GateFailure | null = evaluateGates({
      lead, canContact, hasAtendimentoConsent: hasConsent, announcementText: s.announcementText, window: s.callWindow, now,
      dncEnabled: false, dnc: null, phoneE164,
    })
    if (!gate && s.dncEnabled) {
      if (!this.dnc?.isConfigured()) dnc = { configured: false }
      else {
        try { dnc = { configured: true, blocked: await this.dnc.isBlocked(phoneE164!) } } catch { dnc = { configured: true, blocked: true } } // erro = bloqueia
      }
      gate = evaluateGates({
        lead, canContact, hasAtendimentoConsent: hasConsent, announcementText: s.announcementText, window: s.callWindow, now,
        dncEnabled: true, dnc, phoneE164,
      })
    }
    if (gate) {
      await this.refuse(ctx, gate.code, leadId, db)
      throw new UnprocessableEntityException({ code: gate.code, message: gate.message })
    }

    // 3) não duplicar ligação em andamento para o mesmo lead
    const active = await db.query(
      `SELECT 1 FROM horizon_agent.voice_calls WHERE lead_id = $1 AND status IN ('queued','ringing','in_progress') AND requested_at > $2 LIMIT 1`,
      [leadId, new Date(now.getTime() - ACTIVE_WINDOW_MS)],
    )
    if (active.rowCount) {
      await this.refuse(ctx, 'ligacao_em_andamento', leadId, db)
      throw new UnprocessableEntityException({ code: 'ligacao_em_andamento', message: 'Já existe uma ligação em andamento para este lead.' })
    }

    // 4) registra e liga
    const callId = randomUUID()
    await db.query(
      `INSERT INTO horizon_agent.voice_calls (id, tenant, lead_id, direction, operator_user_id, provider, status, announcement_version)
       VALUES ($1, $2, $3, 'outbound', $4, $5, 'queued', $6)`,
      [callId, voiceEnv.tenant(), leadId, ctx.actor, this.telephony.id, s.announcementVersion],
    )
    const base = `${voiceEnv.webhookBase()}/voice/webhooks/${this.telephony.id}`
    try {
      const placed = await this.telephony.placeCall({
        callId, operatorPhone, leadPhone: phoneE164!, instructionsUrl: `${base}/bridge?callId=${callId}`, statusUrl: `${base}/status`,
      })
      await db.query(`UPDATE horizon_agent.voice_calls SET provider_call_sid = $2 WHERE id = $1`, [callId, placed.providerCallSid])
    } catch (e: any) {
      await db.query(`UPDATE horizon_agent.voice_calls SET status = 'failed', failure_reason = $2, ended_at = now() WHERE id = $1`, [callId, e instanceof ProviderNotConfiguredError ? 'provedor_nao_configurado' : 'erro_do_provedor'])
      await this.audit.log({ ...ctx, action: 'voice.call.failed', entity: 'voice_call', entityId: callId, details: { provider: this.telephony.id, reason: 'erro_do_provedor' } }, db)
      if (e instanceof ProviderNotConfiguredError) throw new ServiceUnavailableException({ code: 'provedor_nao_configurado', message: 'A telefonia ainda não está configurada.', missing: e.missing })
      throw new BadGatewayException({ code: 'erro_do_provedor', message: 'O provedor de telefonia recusou ou não respondeu. Nada foi cobrado do lead.' })
    }
    await this.audit.log({ ...ctx, action: 'voice.call.place', entity: 'voice_call', entityId: callId, details: { provider: this.telephony.id, leadId, announcementVersion: s.announcementVersion } }, db)
    return { id: callId, status: 'queued' as CallStatus }
  }

  // ───────────── Consulta ─────────────
  async list(q: { page?: number; pageSize?: number; leadId?: string; status?: string; from?: string; to?: string }, db: Db = this.pg) {
    const page = Math.max(1, q.page ?? 1)
    const pageSize = Math.min(100, Math.max(1, q.pageSize ?? 20))
    const params: any[] = [voiceEnv.tenant()]
    let where = 'c.tenant = $1'
    if (q.leadId) { params.push(q.leadId); where += ` AND c.lead_id = $${params.length}` }
    if (q.status && (CALL_STATUSES as readonly string[]).includes(q.status)) { params.push(q.status); where += ` AND c.status = $${params.length}` }
    if (q.from && !Number.isNaN(Date.parse(q.from))) { params.push(new Date(q.from)); where += ` AND c.requested_at >= $${params.length}` }
    if (q.to && !Number.isNaN(Date.parse(q.to))) { params.push(new Date(q.to)); where += ` AND c.requested_at <= $${params.length}` }
    const total = Number((await db.query(`SELECT count(*)::int n FROM horizon_agent.voice_calls c WHERE ${where}`, params)).rows[0]?.n ?? 0)
    const rows = (
      await db.query(
        `SELECT c.id, c.lead_id, l.name AS lead_name, l.phone AS lead_phone, c.direction, c.status, c.failure_reason, c.requested_at,
                c.started_at, c.answered_at, c.ended_at, c.duration_sec, (c.recording_url_ref IS NOT NULL) AS has_recording,
                c.recording_consent, c.transcript_status, c.retention_until, c.cost_cents
         FROM horizon_agent.voice_calls c JOIN horizon_agent.leads l ON l.id = c.lead_id
         WHERE ${where} ORDER BY c.requested_at DESC, c.id LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, pageSize, (page - 1) * pageSize],
      )
    ).rows
    return {
      data: rows.map(({ lead_phone, ...r }: any) => ({ ...r, phone_masked: maskPhone(lead_phone) })),
      meta: { page, pageSize, totalItems: total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
    }
  }

  async get(id: string, ctx: RequestCtx, canSeeTranscript: boolean, db: Db = this.pg) {
    const row = (
      await db.query(
        `SELECT c.id, c.lead_id, l.name AS lead_name, l.phone AS lead_phone, c.direction, c.status, c.failure_reason, c.requested_at,
                c.started_at, c.answered_at, c.ended_at, c.duration_sec, (c.recording_url_ref IS NOT NULL) AS has_recording,
                c.recording_consent, c.consent_basis, c.announcement_version, c.recording_announced_at, c.recording_deleted_at,
                c.transcript_status, c.retention_until, c.cost_cents
         FROM horizon_agent.voice_calls c JOIN horizon_agent.leads l ON l.id = c.lead_id WHERE c.id = $1 AND c.tenant = $2`,
        [id, voiceEnv.tenant()],
      )
    ).rows[0]
    if (!row) throw new NotFoundException('Ligação não encontrada')
    const events = (await db.query(`SELECT kind, status, at FROM horizon_agent.voice_call_events WHERE call_id = $1 ORDER BY at, id`, [id])).rows
    const { lead_phone, ...rest } = row
    let transcript: { segments: TranscriptSegment[]; language: string | null } | null = null
    if (canSeeTranscript && row.transcript_status === 'done') {
      const t = (await db.query(`SELECT segments_enc, language FROM horizon_agent.voice_transcripts WHERE call_id = $1`, [id])).rows[0]
      if (t) {
        transcript = { segments: JSON.parse(this.crypto.decrypt(t.segments_enc)), language: t.language }
        await this.audit.log({ ...ctx, action: 'voice.transcript.read', entity: 'voice_call', entityId: id, details: {} }, db)
      }
    }
    return { ...rest, phone_masked: maskPhone(lead_phone), events, transcript, transcript_restricted: !canSeeTranscript && row.transcript_status === 'done' }
  }

  // ───────────── Webhooks ─────────────
  private async callBySid(sid: string, db: Db) {
    return (await db.query(`SELECT * FROM horizon_agent.voice_calls WHERE provider = $1 AND provider_call_sid = $2`, [this.telephony.id, sid])).rows[0] ?? null
  }

  /** Idempotente: o mesmo evento (sid + status + sequência) só é aplicado uma vez; transições só avançam. */
  async handleStatus(p: ParsedStatus, db: Db = this.pg): Promise<{ applied: boolean; known: boolean }> {
    const call = await this.callBySid(p.providerCallSid, db)
    if (!call) return { applied: false, known: false }
    const ins = await db.query(
      `INSERT INTO horizon_agent.voice_call_events (call_id, kind, status, event_key) VALUES ($1, 'status', $2, $3) ON CONFLICT (call_id, event_key) DO NOTHING`,
      [call.id, p.status, `status:${p.eventKey}`],
    )
    if (!ins.rowCount) return { applied: false, known: true }
    const terminal = isTerminal(p.status)
    const r = await db.query(
      `UPDATE horizon_agent.voice_calls SET
         status = $2,
         started_at = CASE WHEN $2 = 'in_progress' THEN coalesce(started_at, now()) ELSE started_at END,
         ended_at = CASE WHEN $3::boolean THEN coalesce(ended_at, now()) ELSE ended_at END,
         duration_sec = CASE WHEN $3::boolean THEN coalesce($4::int, duration_sec) ELSE duration_sec END
       WHERE id = $1 AND status = ANY($5::text[])`,
      [call.id, p.status, terminal, p.durationSec, statusesBefore(p.status)],
    )
    return { applied: !!r.rowCount, known: true }
  }

  /** Quando o provedor pede as instruções da perna do operador: aviso -> ponte -> gravação (só com aviso configurado). */
  async bridgeInstructions(callId: string, db: Db = this.pg): Promise<string> {
    const row = (
      await db.query(
        `SELECT c.status, l.phone, l.opt_out, l.anonymized_at FROM horizon_agent.voice_calls c JOIN horizon_agent.leads l ON l.id = c.lead_id WHERE c.id = $1 AND c.tenant = $2`,
        [callId, voiceEnv.tenant()],
      )
    ).rows[0]
    const phone = row && !row.opt_out && !row.anonymized_at ? toE164(row.phone) : null
    const s = await this.settings.get(db)
    if (!row || isTerminal(row.status) || !phone || !s.announcementConfigured) return this.telephony.buildHangupInstructions()
    const base = `${voiceEnv.webhookBase()}/voice/webhooks/${this.telephony.id}`
    return this.telephony.buildBridgeInstructions({
      leadPhone: phone, callerId: this.telephony.callerId(), recordingCallbackUrl: `${base}/recording`, announceUrl: `${base}/announce?callId=${callId}`, record: true,
    })
  }

  /** Quando o LEAD atende: toca o aviso e sinaliza (no banco) que ele foi entregue. Sem aviso => desliga a perna. */
  async announceInstructions(callId: string, db: Db = this.pg): Promise<string> {
    const s = await this.settings.get(db)
    if (!s.announcementConfigured || !s.announcementText) return this.telephony.buildHangupInstructions()
    const r = await db.query(
      `UPDATE horizon_agent.voice_calls SET
         recording_announced_at = coalesce(recording_announced_at, now()), answered_at = coalesce(answered_at, now()),
         recording_consent = true, consent_basis = $3, announcement_version = $4
       WHERE id = $1 AND tenant = $2 AND status NOT IN ('completed','busy','no_answer','failed','canceled')`,
      [callId, voiceEnv.tenant(), `aviso_previo:${s.announcementVersion}`, s.announcementVersion],
    )
    if (!r.rowCount) return this.telephony.buildHangupInstructions()
    await db.query(
      `INSERT INTO horizon_agent.voice_call_events (call_id, kind, status, event_key) VALUES ($1, 'announcement', NULL, 'announcement') ON CONFLICT (call_id, event_key) DO NOTHING`,
      [callId],
    )
    return this.telephony.buildAnnouncementInstructions(s.announcementText)
  }

  /**
   * Gravação pronta. Só guarda a referência se o aviso foi entregue (recording_announced_at). Caso contrário a
   * gravação é descartada no provedor e nada é retido. Referência vai criptografada; nunca URL pública.
   */
  async handleRecording(p: ParsedRecording, db: Db = this.pg): Promise<{ stored: boolean; callId: string | null; transcribe: boolean }> {
    const call = await this.callBySid(p.providerCallSid, db)
    if (!call) return { stored: false, callId: null, transcribe: false }
    const ins = await db.query(
      `INSERT INTO horizon_agent.voice_call_events (call_id, kind, status, event_key) VALUES ($1, 'recording', $2, $3) ON CONFLICT (call_id, event_key) DO NOTHING`,
      [call.id, p.status, p.eventKey],
    )
    if (!ins.rowCount) return { stored: false, callId: call.id, transcribe: false } // reenvio
    if (p.status !== 'completed') return { stored: false, callId: call.id, transcribe: false }

    if (!call.recording_announced_at || !call.recording_consent) {
      await this.discardRemote(p.recordingRef)
      await this.audit.log({ action: 'voice.recording.discarded', actor: SYSTEM_CTX.actor, entity: 'voice_call', entityId: call.id, details: { reason: 'sem_aviso_de_gravacao' } }, db)
      return { stored: false, callId: call.id, transcribe: false }
    }
    const sttReady = this.stt.status().ready
    const until = new Date(Date.now() + voiceEnv.recordingRetentionDays() * DAY)
    await db.query(
      `UPDATE horizon_agent.voice_calls SET recording_url_ref = $2, retention_until = $3, recording_deleted_at = NULL,
         duration_sec = coalesce(duration_sec, $4::int), transcript_status = $5 WHERE id = $1`,
      [call.id, this.crypto.encrypt(p.recordingRef), until, p.durationSec, sttReady ? 'pending' : 'disabled'],
    )
    await this.audit.log({ action: 'voice.recording.stored', actor: SYSTEM_CTX.actor, entity: 'voice_call', entityId: call.id, details: { retentionDays: voiceEnv.recordingRetentionDays() } }, db)
    return { stored: true, callId: call.id, transcribe: sttReady }
  }

  private async discardRemote(ref: string) {
    try { await this.telephony.deleteRecording(ref) } catch { this.log.error('Falha ao descartar gravação no provedor (apagar manualmente)') }
  }

  /** Baixa o áudio de forma transitória, transcreve e guarda os segmentos criptografados. Nunca loga conteúdo. */
  async transcribe(callId: string, db: Db = this.pg): Promise<'done' | 'failed' | 'skipped'> {
    const call = (await db.query(`SELECT id, recording_url_ref, transcript_status FROM horizon_agent.voice_calls WHERE id = $1`, [callId])).rows[0]
    if (!call?.recording_url_ref || call.transcript_status === 'done') return 'skipped'
    if (!this.stt.status().ready) {
      await db.query(`UPDATE horizon_agent.voice_calls SET transcript_status = 'disabled' WHERE id = $1`, [callId])
      return 'skipped'
    }
    try {
      const { audio, mime } = await this.telephony.fetchRecordingAudio(this.crypto.decrypt(call.recording_url_ref))
      const out = await this.stt.transcribe(audio, { mime, language: 'pt' })
      const flag = flagSensitive(out.segments.map((s) => s.text).join(' '))
      await db.query(
        `INSERT INTO horizon_agent.voice_transcripts (call_id, segments_enc, language, provider, contains_sensitive) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (call_id) DO UPDATE SET segments_enc = excluded.segments_enc, language = excluded.language, provider = excluded.provider, contains_sensitive = excluded.contains_sensitive`,
        [callId, this.crypto.encrypt(JSON.stringify(out.segments)), out.language, this.stt.id, flag.containsSensitive],
      )
      await db.query(`UPDATE horizon_agent.voice_calls SET transcript_status = 'done' WHERE id = $1`, [callId])
      await this.audit.log({ action: 'voice.transcript.created', actor: SYSTEM_CTX.actor, entity: 'voice_call', entityId: callId, details: { provider: this.stt.id, segments: out.segments.length } }, db)
      return 'done'
    } catch (e: any) {
      this.log.error(`Transcrição falhou (${e?.constructor?.name ?? 'erro'})`) // sem mensagem do provedor nem conteúdo
      await db.query(`UPDATE horizon_agent.voice_calls SET transcript_status = 'failed' WHERE id = $1`, [callId])
      return 'failed'
    }
  }

  // ───────────── LGPD: ganchos de titular e retenção ─────────────
  /** Apaga a gravação no provedor e zera a referência. Lança se não conseguir (fail closed). */
  private async deleteRecordings(rows: { id: string; recording_url_ref: string }[], db: Db) {
    let deleted = 0
    for (const r of rows) {
      await this.telephony.deleteRecording(this.crypto.decrypt(r.recording_url_ref))
      await db.query(`UPDATE horizon_agent.voice_calls SET recording_url_ref = NULL, recording_deleted_at = now() WHERE id = $1`, [r.id])
      deleted++
    }
    return deleted
  }

  subjectHook(): SubjectDataHook {
    const withRefs = async (leadId: string, db: Db) =>
      (await db.query(`SELECT id, recording_url_ref FROM horizon_agent.voice_calls WHERE lead_id = $1 AND recording_url_ref IS NOT NULL`, [leadId])).rows
    return {
      name: 'voice',
      exportLead: async (leadId, db) => {
        const calls = (
          await db.query(
            `SELECT id, direction, status, requested_at, started_at, answered_at, ended_at, duration_sec, (recording_url_ref IS NOT NULL) AS has_recording,
                    recording_consent, consent_basis, announcement_version, transcript_status, retention_until
             FROM horizon_agent.voice_calls WHERE lead_id = $1 ORDER BY requested_at`,
            [leadId],
          )
        ).rows
        const transcripts = (
          await db.query(
            `SELECT t.call_id, t.segments_enc, t.language, t.created_at FROM horizon_agent.voice_transcripts t JOIN horizon_agent.voice_calls c ON c.id = t.call_id WHERE c.lead_id = $1`,
            [leadId],
          )
        ).rows.map((t: any) => ({ call_id: t.call_id, language: t.language, created_at: t.created_at, segments: JSON.parse(this.crypto.decrypt(t.segments_enc)) }))
        return { calls, transcripts }
      },
      anonymizeLead: async (leadId, _ctx, db) => {
        const rows = await withRefs(leadId, db)
        const recordings = await this.deleteRecordings(rows, db)
        const transcripts = (await db.query(`DELETE FROM horizon_agent.voice_transcripts WHERE call_id IN (SELECT id FROM horizon_agent.voice_calls WHERE lead_id = $1)`, [leadId])).rowCount ?? 0
        await db.query(`UPDATE horizon_agent.voice_calls SET transcript_status = 'none', retention_until = NULL WHERE lead_id = $1 AND transcript_status <> 'none'`, [leadId])
        return { voiceRecordings: recordings, voiceTranscripts: transcripts }
      },
      eraseLead: async (leadId, _ctx, db) => ({ voiceRecordings: await this.deleteRecordings(await withRefs(leadId, db), db) }), // linhas caem por cascata
      purgeExpired: async (now, _ctx, db) => {
        const exp = (
          await db.query(
            `SELECT id, recording_url_ref FROM horizon_agent.voice_calls
             WHERE tenant = $1 AND recording_url_ref IS NOT NULL AND retention_until < $2 ORDER BY retention_until LIMIT 200`,
            [voiceEnv.tenant(), now],
          )
        ).rows
        let recordings = 0, failed = 0
        for (const r of exp) {
          try { recordings += await this.deleteRecordings([r], db) } catch { failed++ } // segue; fica para a próxima rodada
        }
        const transcripts = (
          await db.query(
            `DELETE FROM horizon_agent.voice_transcripts t USING horizon_agent.voice_calls c WHERE t.call_id = c.id AND c.tenant = $1 AND t.created_at < $2`,
            [voiceEnv.tenant(), new Date(now.getTime() - voiceEnv.transcriptRetentionDays() * DAY)],
          )
        ).rowCount ?? 0
        if (transcripts) {
          await db.query(`UPDATE horizon_agent.voice_calls c SET transcript_status = 'none' WHERE tenant = $1 AND transcript_status = 'done' AND NOT EXISTS (SELECT 1 FROM horizon_agent.voice_transcripts t WHERE t.call_id = c.id)`, [voiceEnv.tenant()])
        }
        return { voiceRecordings: recordings, voiceRecordingsFailed: failed, voiceTranscripts: transcripts }
      },
    }
  }
}

