import { randomBytes } from 'crypto'
import { Client } from 'pg'
import { AuditService } from '../pilot/compliance/audit.service'
import { ConsentService } from '../pilot/compliance/consent.service'
import { CryptoService } from '../pilot/compliance/crypto.service'
import { DataSubjectService } from '../pilot/compliance/data-subject.service'
import { RetentionService } from '../pilot/compliance/retention.service'
import { clearSubjectHooks } from '../pilot/compliance/subject-hooks'
import { TelephonyAdapter } from './telephony/telephony.types'
import { TwilioTelephony } from './telephony/twilio.adapter'
import { DisabledStt, SttProvider } from './providers/stt'
import { DisabledTts } from './providers/tts'
import { VoiceService } from './voice.service'
import { VoiceSettingsService } from './voice-settings.service'

// Banco real, SEMPRE dentro de uma transação com ROLLBACK, tenant `teste_rollback`. Sem PILOT_TEST_DATABASE_URL: ignorada.
// Nenhum provedor externo é chamado: telefonia e STT são dublês.
const url = process.env.PILOT_TEST_DATABASE_URL
const d = url ? describe : describe.skip

const SID = 'CA' + 'a'.repeat(32)
const REC = 'twilio:RE' + 'd'.repeat(32)
const REC_PARAMS = { providerCallSid: SID, recordingRef: REC, status: 'completed' as const, durationSec: 30, eventKey: 'rec:x:completed' }

d('Voz (banco real, com rollback)', () => {
  let client: Client
  let voice: VoiceService
  let settings: VoiceSettingsService
  let audit: AuditService
  let consents: ConsentService
  let crypto: CryptoService
  let subjects: DataSubjectService
  let deleted: string[]
  let deleteFails = false
  let sttOn = true
  const saved = { ...process.env }
  const db = () => client as any

  const telephony = (): TelephonyAdapter => {
    const real = new TwilioTelephony(async () => ({ ok: true, status: 201, json: async () => ({ sid: SID, status: 'queued' }) }))
    return Object.assign(Object.create(real), {
      deleteRecording: async (ref: string) => { if (deleteFails) throw new Error('falha'); deleted.push(ref) },
      fetchRecordingAudio: async () => ({ audio: Buffer.from('audio'), mime: 'audio/mpeg' }),
    })
  }
  const stt: SttProvider = {
    id: 'fake',
    status: () => ({ provider: 'fake', configured: sttOn, ready: sttOn, missing: [] }),
    transcribe: async () => ({ language: 'pt', segments: [{ start: 0, end: 2, speaker: 'a', text: 'Tenho um plano e uso medicação de diabetes.' }, { start: 2, end: 3, speaker: 'b', text: 'Entendi.' }] }),
  }

  beforeAll(async () => {
    Object.assign(process.env, {
      PILOT_TENANT: 'teste_rollback', PILOT_DATA_KEY: randomBytes(32).toString('base64'), PILOT_DATA_KEY_VERSION: '1',
      TWILIO_ACCOUNT_SID: 'AC' + 'b'.repeat(32), TWILIO_AUTH_TOKEN: 'tok', TWILIO_VOICE_NUMBER: '+5511999990000',
      VOICE_WEBHOOK_BASE_URL: 'https://voz.exemplo.test', VOICE_OPERATOR_PHONE: '+5583988887777',
    })
    delete process.env.VOICE_RECORDING_RETENTION_DAYS
    delete process.env.VOICE_DNC_ENABLED
    client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
    await client.connect()
  })
  afterAll(async () => { await client.end(); clearSubjectHooks(); process.env = { ...saved } })

  beforeEach(async () => {
    await client.query('BEGIN')
    deleted = []; deleteFails = false; sttOn = true
    crypto = new CryptoService()
    audit = new AuditService(client as any)
    consents = new ConsentService(client as any, audit)
    settings = new VoiceSettingsService(client as any, audit)
    voice = new VoiceService(client as any, telephony(), new DisabledTts(), stt, null, settings, consents, audit, crypto)
    voice.onModuleInit() // registra o gancho de titular/retenção
    subjects = new DataSubjectService(client as any, crypto, consents, audit)
    await settings.put({ announcementText: 'Esta ligação pode ser gravada para fins de atendimento.', callWindow: { days: [0, 1, 2, 3, 4, 5, 6], start: '00:00', end: '23:59', tz: 'America/Sao_Paulo' } }, { actor: 'teste' }, db())
  })
  afterEach(async () => { await client.query('ROLLBACK'); clearSubjectHooks() })

  async function lead(opts: { phone?: string; optOut?: boolean; consent?: boolean } = {}) {
    const r = await client.query(
      `INSERT INTO horizon_agent.leads (tenant, phone, name, opt_out) VALUES ('teste_rollback', $1, 'Lead Voz', $2) RETURNING id`,
      [opts.phone ?? '5583999990001', !!opts.optOut],
    )
    if (opts.consent !== false) await consents.grant(r.rows[0].id, { purpose: 'atendimento' }, { actor: 'teste' }, db())
    return r.rows[0].id as string
  }
  const callRow = async (id: string) => (await client.query('SELECT * FROM horizon_agent.voice_calls WHERE id = $1', [id])).rows[0]
  const auditActions = async () => (await client.query(`SELECT action, details::text d FROM horizon_agent.audit_log WHERE action LIKE 'voice.%' ORDER BY id`)).rows

  it('as tabelas existem com RLS ligado e SEM policies', async () => {
    const t = ['voice_calls', 'voice_call_events', 'voice_transcripts', 'voice_settings']
    const rls = await client.query(`SELECT relname, relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'horizon_agent' AND relname = ANY($1)`, [t])
    expect(rls.rows).toHaveLength(4)
    for (const r of rls.rows) expect(r.relrowsecurity).toBe(true)
    const pol = await client.query(`SELECT count(*)::int n FROM pg_policies WHERE schemaname = 'horizon_agent' AND tablename = ANY($1)`, [t])
    expect(pol.rows[0].n).toBe(0)
  })

  it('placeCall: portões reais passam, registra a ligação (operador primeiro) e audita sem dado pessoal', async () => {
    const id = await lead()
    const r = await voice.placeCall(id, { actor: 'user-1' }, db())
    const row = await callRow(r.id)
    expect(row).toMatchObject({ status: 'queued', provider: 'twilio', provider_call_sid: SID, operator_user_id: 'user-1', direction: 'outbound', recording_consent: false })
    expect(row.announcement_version).toMatch(/^v[0-9a-f]{8}$/)
    const acts = await auditActions()
    expect(acts.map((a) => a.action)).toContain('voice.call.place')
    expect(JSON.stringify(acts)).not.toMatch(/5583999990001|Lead Voz/)
  })

  it('recusas reais: sem consentimento, opt-out, aviso removido, duplicada em andamento; tudo auditado', async () => {
    const semConsent = await lead({ consent: false, phone: '5583999990002' })
    await expect(voice.placeCall(semConsent, { actor: 'u' }, db())).rejects.toMatchObject({ response: { code: 'sem_consentimento_atendimento' } })
    const opt = await lead({ optOut: true, phone: '5583999990003' })
    await expect(voice.placeCall(opt, { actor: 'u' }, db())).rejects.toMatchObject({ response: { code: 'contato_bloqueado' } })
    const ok = await lead({ phone: '5583999990004' })
    await voice.placeCall(ok, { actor: 'u' }, db())
    await expect(voice.placeCall(ok, { actor: 'u' }, db())).rejects.toMatchObject({ response: { code: 'ligacao_em_andamento' } })
    await settings.put({ announcementText: null }, { actor: 'u' }, db())
    const ok2 = await lead({ phone: '5583999990005' })
    await expect(voice.placeCall(ok2, { actor: 'u' }, db())).rejects.toMatchObject({ response: { code: 'aviso_gravacao_ausente' } })
    const refused = (await auditActions()).filter((a) => a.action === 'voice.call.refused').map((a) => JSON.parse(a.d).code)
    expect(refused).toEqual(['sem_consentimento_atendimento', 'contato_bloqueado', 'ligacao_em_andamento', 'aviso_gravacao_ausente'])
  })

  it('configurações: aviso gera versão por conteúdo; DNC do painel OU do ambiente liga; janela inválida é recusada', async () => {
    const a = await settings.get(db())
    await settings.put({ announcementText: 'Outro texto.' }, { actor: 'u' }, db())
    const b = await settings.get(db())
    expect(b.announcementVersion).not.toBe(a.announcementVersion)
    expect(b.dncEnabled).toBe(false)
    await settings.put({ dncEnabled: true }, { actor: 'u' }, db())
    expect((await settings.get(db())).dncEnabled).toBe(true)
    await expect(settings.put({ callWindow: { days: [1], start: '10:00', end: '09:00', tz: 'America/Sao_Paulo' } }, { actor: 'u' }, db())).rejects.toThrow()
    // DNC ligado e nenhum verificador: a ligação é recusada
    const id = await lead({ phone: '5583999990006' })
    await expect(voice.placeCall(id, { actor: 'u' }, db())).rejects.toMatchObject({ response: { code: 'dnc_sem_verificador' } })
  })

  it('webhooks de status: avança, é idempotente, ignora atraso e congela o terminal', async () => {
    const id = await lead()
    const { id: callId } = await voice.placeCall(id, { actor: 'u' }, db())
    const ev = (status: any, key: string, dur: number | null = null) => voice.handleStatus({ providerCallSid: SID, status, durationSec: dur, eventKey: key }, db())

    expect(await ev('ringing', 'ringing:1')).toEqual({ applied: true, known: true })
    expect(await ev('ringing', 'ringing:1')).toEqual({ applied: false, known: true }) // reenvio
    expect(await ev('in_progress', 'in_progress:2')).toMatchObject({ applied: true })
    expect((await callRow(callId)).started_at).not.toBeNull()
    expect(await ev('ringing', 'ringing:9')).toMatchObject({ applied: false }) // chegou atrasado
    expect((await callRow(callId)).status).toBe('in_progress')
    expect(await ev('completed', 'completed:3', 42)).toMatchObject({ applied: true })
    let row = await callRow(callId)
    expect(row).toMatchObject({ status: 'completed', duration_sec: 42 })
    expect(row.ended_at).not.toBeNull()
    expect(await ev('failed', 'failed:4')).toMatchObject({ applied: false }) // terminal é final
    row = await callRow(callId)
    expect(row.status).toBe('completed')
    const n = await client.query(`SELECT count(*)::int n FROM horizon_agent.voice_call_events WHERE call_id = $1 AND kind = 'status'`, [callId])
    expect(n.rows[0].n).toBe(5) // 1 por evento distinto (inclusive os ignorados), nenhum duplicado
    expect(await voice.handleStatus({ providerCallSid: 'CA' + 'z'.repeat(32), status: 'completed', durationSec: 1, eventKey: 'x' }, db())).toEqual({ applied: false, known: false })
  })

  it('aviso entregue -> gravação guardada só como referência CRIPTOGRAFADA, com retenção de 365 dias', async () => {
    const id = await lead()
    const { id: callId } = await voice.placeCall(id, { actor: 'u' }, db())
    const xml = await voice.announceInstructions(callId, db())
    expect(xml).toContain('<Say language="pt-BR">')
    let row = await callRow(callId)
    expect(row).toMatchObject({ recording_consent: true })
    expect(row.recording_announced_at).not.toBeNull()
    expect(row.answered_at).not.toBeNull()
    expect(row.consent_basis).toMatch(/^aviso_previo:v/)

    const out = await voice.handleRecording(REC_PARAMS, db())
    expect(out).toMatchObject({ stored: true, transcribe: true, callId })
    row = await callRow(callId)
    expect(row.recording_url_ref).toMatch(/^enc:v1:/)
    expect(row.recording_url_ref).not.toContain('RE' + 'd'.repeat(10))
    expect(crypto.decrypt(row.recording_url_ref)).toBe(REC)
    const days = (new Date(row.retention_until).getTime() - Date.now()) / 86_400_000
    expect(days).toBeGreaterThan(364.9); expect(days).toBeLessThan(365.1)
    // reenvio do mesmo webhook: nada muda
    expect(await voice.handleRecording(REC_PARAMS, db())).toMatchObject({ stored: false })
    expect(deleted).toEqual([])
  })

  it('gravação SEM aviso entregue é descartada no provedor e nada é retido', async () => {
    const id = await lead()
    const { id: callId } = await voice.placeCall(id, { actor: 'u' }, db())
    const out = await voice.handleRecording(REC_PARAMS, db())
    expect(out).toMatchObject({ stored: false, transcribe: false })
    expect(deleted).toEqual([REC])
    const row = await callRow(callId)
    expect(row.recording_url_ref).toBeNull()
    expect((await auditActions()).map((a) => a.action)).toContain('voice.recording.discarded')
  })

  it('STT desativado: transcript_status = disabled; ativado: transcrição criptografada e lida só com permissão', async () => {
    sttOn = false
    const id = await lead()
    const { id: callId } = await voice.placeCall(id, { actor: 'u' }, db())
    await voice.announceInstructions(callId, db())
    await voice.handleRecording(REC_PARAMS, db())
    expect((await callRow(callId)).transcript_status).toBe('disabled')
    expect(await voice.transcribe(callId, db())).toBe('skipped')

    sttOn = true
    await client.query(`UPDATE horizon_agent.voice_calls SET transcript_status = 'pending' WHERE id = $1`, [callId])
    expect(await voice.transcribe(callId, db())).toBe('done')
    const t = (await client.query('SELECT * FROM horizon_agent.voice_transcripts WHERE call_id = $1', [callId])).rows[0]
    expect(t.segments_enc).toMatch(/^enc:v1:/)
    expect(t.segments_enc).not.toContain('diabetes')
    expect(t.contains_sensitive).toBe(true) // saúde (art. 11)

    const viewer = await voice.get(callId, { actor: 'v' }, false, db())
    expect(viewer.transcript).toBeNull()
    expect(viewer.transcript_restricted).toBe(true)
    expect(viewer.has_recording).toBe(true)
    expect(JSON.stringify(viewer)).not.toContain('enc:v1')
    expect(JSON.stringify(viewer)).not.toContain('5583999990001')
    const mgr = await voice.get(callId, { actor: 'm' }, true, db())
    expect(mgr.transcript?.segments).toHaveLength(2)
    expect((await auditActions()).filter((a) => a.action === 'voice.transcript.read')).toHaveLength(1)
    const list = await voice.list({ leadId: id }, db())
    expect(list.data[0]).toMatchObject({ phone_masked: expect.stringMatching(/\*\*\*\*-0001$/), has_recording: true })
    expect(list.data[0]).not.toHaveProperty('recording_url_ref')
    expect(list.meta.totalItems).toBe(1)
  })

  it('falha do STT marca a ligação como failed (sem vazar o erro)', async () => {
    const id = await lead()
    const { id: callId } = await voice.placeCall(id, { actor: 'u' }, db())
    await voice.announceInstructions(callId, db())
    await voice.handleRecording(REC_PARAMS, db())
    const broken = new VoiceService(client as any, telephony(), new DisabledTts(), new DisabledStt(), null, settings, consents, audit, crypto)
    sttOn = true
    ;(broken as any).stt = { ...stt, transcribe: async () => { throw new Error('texto sensivel do provedor') } }
    expect(await broken.transcribe(callId, db())).toBe('failed')
    expect((await callRow(callId)).transcript_status).toBe('failed')
  })

  async function leadWithRecordedCall() {
    const id = await lead({ phone: '5583999990009' })
    const { id: callId } = await voice.placeCall(id, { actor: 'u' }, db())
    await voice.announceInstructions(callId, db())
    await voice.handleRecording(REC_PARAMS, db())
    await voice.transcribe(callId, db())
    return { id, callId }
  }

  it('titular: exportação inclui os dados de voz (sem ref de gravação)', async () => {
    const { id } = await leadWithRecordedCall()
    const exp = await subjects.exportLead(id, { actor: 'dpo' }, db())
    const v = exp.extensions.voice as any
    expect(v.calls).toHaveLength(1)
    expect(v.calls[0]).toMatchObject({ has_recording: true, recording_consent: true })
    expect(v.transcripts[0].segments[0].text).toContain('diabetes')
    expect(JSON.stringify(v)).not.toMatch(/enc:v1|RE(d){10}/)
  })

  it('titular: anonimização apaga gravação (no provedor) e transcrição; mantém só metadados', async () => {
    const { id, callId } = await leadWithRecordedCall()
    const r = await subjects.anonymizeLead(id, { actor: 'dpo' }, {}, db())
    expect(r.anonymized).toBe(true)
    expect(deleted).toEqual([REC])
    const row = await callRow(callId)
    expect(row.recording_url_ref).toBeNull()
    expect(row.recording_deleted_at).not.toBeNull()
    expect(row.transcript_status).toBe('none')
    expect((await client.query('SELECT count(*)::int n FROM horizon_agent.voice_transcripts WHERE call_id = $1', [callId])).rows[0].n).toBe(0)
    const a = (await client.query(`SELECT details FROM horizon_agent.audit_log WHERE action = 'lead.anonymize' ORDER BY id DESC LIMIT 1`)).rows[0]
    expect(a.details).toMatchObject({ voiceRecordings: 1, voiceTranscripts: 1 })
    // e o lead anonimizado não pode mais ser chamado
    await expect(voice.placeCall(id, { actor: 'u' }, db())).rejects.toMatchObject({ response: { code: 'lead_anonimizado' } })
  })

  it('titular: eliminação apaga a gravação remota ANTES e as linhas caem por cascata', async () => {
    const { id, callId } = await leadWithRecordedCall()
    const r = await subjects.eraseLead(id, { actor: 'dpo' }, db())
    expect(r.erased).toBe(true)
    expect(deleted).toEqual([REC])
    expect(await callRow(callId)).toBeUndefined()
    expect((await client.query('SELECT count(*)::int n FROM horizon_agent.voice_call_events WHERE call_id = $1', [callId])).rows[0].n).toBe(0)
    expect((await client.query('SELECT count(*)::int n FROM horizon_agent.voice_transcripts WHERE call_id = $1', [callId])).rows[0].n).toBe(0)
  })

  it('titular: se a gravação não puder ser apagada no provedor, a eliminação FALHA e o lead permanece', async () => {
    const { id } = await leadWithRecordedCall()
    deleteFails = true
    await client.query('SAVEPOINT s1')
    await expect(subjects.eraseLead(id, { actor: 'dpo' }, db())).rejects.toThrow()
    await client.query('ROLLBACK TO SAVEPOINT s1')
    expect((await client.query('SELECT count(*)::int n FROM horizon_agent.leads WHERE id = $1', [id])).rows[0].n).toBe(1)
  })

  it('retenção: gravação vencida é apagada no provedor e a referência zerada; transcrição antiga cai; rotina idempotente', async () => {
    const a = await leadWithRecordedCall()
    // força a ligação A a vencer e a transcrição dela a ficar velha
    await client.query(`UPDATE horizon_agent.voice_calls SET retention_until = now() - interval '1 day' WHERE id = $1`, [a.callId])
    await client.query(`UPDATE horizon_agent.voice_transcripts SET created_at = now() - interval '400 days' WHERE call_id = $1`, [a.callId])
    const retention = new RetentionService(client as any, subjects, audit)
    const res = await retention.run({ db: db() })
    expect(res.extensions).toMatchObject({ voiceRecordings: 1, voiceTranscripts: 1 })
    expect(deleted).toContain(REC)
    const row = await callRow(a.callId)
    expect(row.recording_url_ref).toBeNull()
    expect(row.transcript_status).toBe('none')
    // idempotente
    const again = await retention.run({ db: db() })
    expect(again.extensions).toMatchObject({ voiceRecordings: 0, voiceTranscripts: 0 })
  })

  it('retenção: falha do provedor não derruba a rotina e mantém a referência para a próxima rodada', async () => {
    const a = await leadWithRecordedCall()
    await client.query(`UPDATE horizon_agent.voice_calls SET retention_until = now() - interval '1 day' WHERE id = $1`, [a.callId])
    deleteFails = true
    const res = await new RetentionService(client as any, subjects, audit).run({ db: db() })
    expect(res.extensions).toMatchObject({ voiceRecordings: 0, voiceRecordingsFailed: 1 })
    expect((await callRow(a.callId)).recording_url_ref).toMatch(/^enc:v1:/)
  })
})
