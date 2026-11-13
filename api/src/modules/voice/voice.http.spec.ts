import { INestApplication, ValidationPipe } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'
import { Test } from '@nestjs/testing'
import * as request from 'supertest'
import { AuthModule } from '../auth/auth.module'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { TenantGuard } from '../auth/tenant.guard'
import { RolesGuard } from '../panel-auth/roles.guard'
import { SafeExceptionFilter } from '../panel-auth/security/hardening'
import { signAccessToken } from '../panel-auth/tokens.util'
import { PgService } from '../pilot/pg.service'
import { clearSubjectHooks } from '../pilot/compliance/subject-hooks'
import { TwilioTelephony } from './telephony/twilio.adapter'
import { twilioSignature } from './telephony/twilio-signature'
import { TELEPHONY } from './voice.tokens'
import { VoiceModule } from './voice.module'

const SECRET = 'voice-http-secret-' + 'k'.repeat(32)
const BASE = 'https://voz.exemplo.test'
const TOKEN = 'token-http-0000'
const SID = 'CA' + 'a'.repeat(32)
const LEAD = '11111111-1111-4111-8111-111111111111'
const CALL = '22222222-2222-4222-8222-222222222222'

// O JwtStrategy confere o usuario no banco: o banco falso devolve um usuario ativo para cada papel.
const USERS = { viewer: '33333333-3333-4333-8333-000000000001', manager: '33333333-3333-4333-8333-000000000002', owner: '33333333-3333-4333-8333-000000000003' } as const

class FakeDb {
  queries: { sql: string; params: any[] }[] = []
  lead: any = { id: LEAD, phone: '5583999991234', opt_out: false, anonymized_at: null }
  consent = true
  settings: any = { tenant: 'alberto', call_window: { days: [0, 1, 2, 3, 4, 5, 6], start: '00:00', end: '23:59', tz: 'America/Sao_Paulo' }, dnc_enabled: false, announcement_text: 'Esta ligação pode ser gravada.', announcement_version: 'v1' }
  call: any = null
  eventInserts = 0
  seenEvents = new Set<string>()
  async query(text: string, params: any[] = []) {
    const sql = text.replace(/\s+/g, ' ').trim()
    this.queries.push({ sql, params })
    const ok = (rows: any[] = []) => ({ rows, rowCount: rows.length })
    if (/FROM horizon_agent\.panel_users WHERE id = \$1/.test(sql)) {
      const role = (Object.keys(USERS) as (keyof typeof USERS)[]).find((r) => USERS[r] === params[0])
      return ok(role ? [{ tenant: 'alberto', role, active: true, token_version: 0 }] : [])
    }
    if (/FROM horizon_agent\.voice_settings/.test(sql)) return ok(this.settings ? [this.settings] : [])
    if (/INSERT INTO horizon_agent\.voice_settings/.test(sql)) { this.settings = { ...(this.settings ?? {}), updated: true }; return ok() }
    if (/FROM horizon_agent\.leads WHERE id = \$1 AND tenant/.test(sql)) return ok(this.lead ? [this.lead] : [])
    if (/purpose = 'marketing'/.test(sql)) return ok([{ active: null, n: 0 }])
    if (/FROM horizon_agent\.consents WHERE lead_id = \$1 AND purpose = \$2/.test(sql)) return ok(this.consent ? [{ '?column?': 1 }] : [])
    if (/FROM horizon_agent\.voice_calls WHERE lead_id = \$1 AND status IN/.test(sql)) return ok()
    if (/FROM horizon_agent\.voice_calls WHERE provider = \$1 AND provider_call_sid/.test(sql)) return ok(this.call && params[1] === SID ? [this.call] : [])
    if (/INSERT INTO horizon_agent\.voice_call_events/.test(sql)) {
      const key = `${params[0]}:${params[2] ?? 'x'}`
      if (this.seenEvents.has(key)) return { rows: [], rowCount: 0 }
      this.seenEvents.add(key); this.eventInserts++
      return { rows: [], rowCount: 1 }
    }
    if (/UPDATE horizon_agent\.voice_calls SET (status = \$2|recording_announced_at)/.test(sql)) return { rows: [], rowCount: 1 }
    if (/FROM horizon_agent\.voice_calls c JOIN horizon_agent\.leads l ON l\.id = c\.lead_id WHERE c\.id = \$1 AND c\.tenant/.test(sql) && /c\.recording_consent, c\.consent_basis/.test(sql))
      return ok([{ id: CALL, lead_id: LEAD, lead_name: 'Fulano', lead_phone: '5583999991234', status: 'completed', transcript_status: 'done', has_recording: true }])
    if (/FROM horizon_agent\.voice_call_events WHERE call_id/.test(sql)) return ok([{ kind: 'status', status: 'completed', at: new Date() }])
    if (/FROM horizon_agent\.voice_transcripts WHERE call_id/.test(sql)) return ok([{ segments_enc: JSON.stringify([{ start: 0, end: 1, speaker: 's0', text: 'olá' }]), language: 'pt' }])
    if (/INSERT INTO horizon_agent\.audit_log/.test(sql)) return { rows: [], rowCount: 1 }
    if (/INSERT INTO horizon_agent\.voice_calls/.test(sql)) return { rows: [], rowCount: 1 }
    return ok()
  }
  audits() { return this.queries.filter((q) => /INSERT INTO horizon_agent\.audit_log/.test(q.sql)).map((q) => ({ actor: q.params[0], action: q.params[1], entityId: q.params[3], details: JSON.parse(q.params[5]) })) }
}

describe('Voz (HTTP, banco e provedor falsos)', () => {
  const saved = { ...process.env }
  let app: INestApplication
  let db: FakeDb
  let fetchCalls: { url: string; body: URLSearchParams }[]
  let fetchOk = true
  const http = () => request(app.getHttpServer())
  const tok = (role: 'viewer' | 'manager' | 'owner') => `Bearer ${signAccessToken({ id: USERS[role], tenant: 'alberto', role }, SECRET)}`
  const configure = () => Object.assign(process.env, {
    TWILIO_ACCOUNT_SID: 'AC' + 'b'.repeat(32), TWILIO_AUTH_TOKEN: TOKEN, TWILIO_VOICE_NUMBER: '+5511999990000',
    VOICE_WEBHOOK_BASE_URL: BASE, VOICE_OPERATOR_PHONE: '+5583988887777',
  })
  const clean = () => { for (const k of ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_VOICE_NUMBER', 'VOICE_WEBHOOK_BASE_URL', 'VOICE_OPERATOR_PHONE', 'VOICE_DNC_ENABLED']) delete process.env[k] }

  beforeAll(async () => {
    process.env.SECRETKEY = SECRET
    process.env.NODE_ENV = 'test'
    db = new FakeDb()
    const adapter = new TwilioTelephony(async (url: string, init: any) => {
      fetchCalls.push({ url, body: new URLSearchParams(init?.body ?? '') })
      return fetchOk ? { ok: true, status: 201, json: async () => ({ sid: SID, status: 'queued' }) } : { ok: false, status: 500, json: async () => ({}) }
    })
    const mod = await Test.createTestingModule({
      imports: [AuthModule, VoiceModule],
      providers: [
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: APP_GUARD, useClass: TenantGuard },
        { provide: APP_GUARD, useClass: RolesGuard },
      ],
    })
      .overrideProvider(PgService).useValue(db)
      .overrideProvider(TELEPHONY).useValue(adapter)
      .compile()
    app = mod.createNestApplication()
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))
    app.useGlobalFilters(new SafeExceptionFilter())
    await app.init()
  })
  afterAll(async () => { await app.close(); clearSubjectHooks(); process.env = { ...saved } })
  beforeEach(() => {
    clean(); fetchCalls = []; fetchOk = true
    db.queries = []; db.consent = true; db.seenEvents.clear(); db.eventInserts = 0
    db.lead = { id: LEAD, phone: '5583999991234', opt_out: false, anonymized_at: null }
    db.settings = { tenant: 'alberto', call_window: { days: [0, 1, 2, 3, 4, 5, 6], start: '00:00', end: '23:59', tz: 'America/Sao_Paulo' }, dnc_enabled: false, announcement_text: 'Esta ligação pode ser gravada.', announcement_version: 'v1' }
    db.call = { id: CALL, status: 'queued', provider_call_sid: SID, recording_announced_at: null, recording_consent: false }
  })

  describe('autenticação e papéis', () => {
    it('painel exige JWT', async () => {
      await http().get('/voice/status').expect(401)
      await http().get('/voice/calls').expect(401)
      await http().post('/voice/calls').send({ leadId: LEAD }).expect(401)
    })
    it('ligar exige manager; configurar exige owner', async () => {
      await http().post('/voice/calls').set('Authorization', tok('viewer')).send({ leadId: LEAD }).expect(403)
      await http().put('/voice/settings').set('Authorization', tok('manager')).send({ dncEnabled: true }).expect(403)
      await http().put('/voice/settings').set('Authorization', tok('viewer')).send({ dncEnabled: true }).expect(403)
    })
    it('o mesmo painel responde também em /pilot/voice (prefixo do BFF)', async () => {
      await http().get('/pilot/voice/status').set('Authorization', tok('viewer')).expect(200)
      await http().get('/pilot/voice/settings').set('Authorization', tok('viewer')).expect(200)
    })
  })

  describe('GET /voice/status', () => {
    it('sem chaves: honesto, só nomes de variáveis, nenhum valor', async () => {
      const r = await http().get('/voice/status').set('Authorization', tok('viewer')).expect(200)
      expect(r.body.telephony).toMatchObject({ provider: 'twilio', configured: false, ready: false })
      expect(r.body.telephony.missing).toEqual(expect.arrayContaining(['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_VOICE_NUMBER', 'VOICE_WEBHOOK_BASE_URL', 'VOICE_OPERATOR_PHONE']))
      expect(r.body.tts).toMatchObject({ configured: false })
      expect(r.body.stt).toMatchObject({ configured: false })
      expect(r.body.recording.announcementConfigured).toBe(true)
      expect(r.body.dnc).toMatchObject({ enabled: false, configured: false })
      expect(r.body.callWindow).toMatchObject({ start: '00:00' })
      expect(r.body.webhookUrl).toBeNull()
      expect(r.body.canPlaceCalls).toBe(false)
    })
    it('configurado: ready, webhookUrl pública e nenhuma credencial na resposta', async () => {
      configure()
      const r = await http().get('/voice/status').set('Authorization', tok('viewer')).expect(200)
      expect(r.body.telephony).toMatchObject({ configured: true, ready: true, missing: [] })
      expect(r.body.webhookUrl).toBe(`${BASE}/voice/webhooks/twilio`)
      expect(r.body.canPlaceCalls).toBe(true)
      expect(JSON.stringify(r.body)).not.toContain(TOKEN)
      expect(JSON.stringify(r.body)).not.toContain('b'.repeat(32))
    })
    it('DNC ligado sem verificador aparece como bloqueando', async () => {
      process.env.VOICE_DNC_ENABLED = 'true'
      const r = await http().get('/voice/status').set('Authorization', tok('viewer')).expect(200)
      expect(r.body.dnc).toEqual({ enabled: true, configured: false, blocking: true })
    })
  })

  describe('POST /voice/calls', () => {
    const place = (role: 'manager' | 'owner' = 'manager') => http().post('/voice/calls').set('Authorization', tok(role))

    it('corpo inválido: 400', async () => {
      await place().send({}).expect(400)
      await place().send({ leadId: 'x' }).expect(400)
    })
    it('provedor não configurado: 503 com a lista de variáveis e refusa auditada', async () => {
      const r = await place().send({ leadId: LEAD }).expect(503)
      // O filtro global de exceções esconde o corpo de 5xx; o painel lê o motivo detalhado em GET /voice/status.
      expect(fetchCalls).toHaveLength(0)
      expect(db.audits().map((a) => a.action)).toContain('voice.call.refused')
    })
    it('sem consentimento de atendimento: 422 com motivo claro, sem ligar, auditado sem dado pessoal', async () => {
      configure(); db.consent = false
      const r = await place().send({ leadId: LEAD }).expect(422)
      expect(JSON.stringify(r.body)).toContain('sem_consentimento_atendimento')
      expect(fetchCalls).toHaveLength(0)
      const a = db.audits().find((x) => x.action === 'voice.call.refused')!
      expect(a.details).toMatchObject({ code: 'sem_consentimento_atendimento' })
      expect(JSON.stringify(db.audits())).not.toMatch(/5583999991234|Fulano/)
    })
    it('lead com opt-out, anonimizado ou inexistente: 422', async () => {
      configure()
      db.lead = { ...db.lead, opt_out: true }
      expect(JSON.stringify((await place().send({ leadId: LEAD }).expect(422)).body)).toContain('contato_bloqueado')
      db.lead = { ...db.lead, opt_out: false, anonymized_at: new Date(), phone: 'anon:x' }
      expect(JSON.stringify((await place().send({ leadId: LEAD }).expect(422)).body)).toContain('lead_anonimizado')
      db.lead = null
      expect(JSON.stringify((await place().send({ leadId: LEAD }).expect(422)).body)).toContain('lead_nao_encontrado')
      expect(fetchCalls).toHaveLength(0)
    })
    it('sem aviso de gravação configurado: 422', async () => {
      configure(); db.settings = { ...db.settings, announcement_text: null }
      expect(JSON.stringify((await place().send({ leadId: LEAD }).expect(422)).body)).toContain('aviso_gravacao_ausente')
      expect(fetchCalls).toHaveLength(0)
    })
    it('fora da janela: 422', async () => {
      configure()
      const tomorrow = (new Date().getUTCDay() + 1) % 7
      db.settings = { ...db.settings, call_window: { days: [tomorrow], start: '00:00', end: '23:59', tz: 'UTC' } }
      expect(JSON.stringify((await place().send({ leadId: LEAD }).expect(422)).body)).toContain('fora_da_janela')
    })
    it('DNC ligado sem verificador: 422 (recusa por segurança)', async () => {
      configure(); process.env.VOICE_DNC_ENABLED = 'true'
      expect(JSON.stringify((await place().send({ leadId: LEAD }).expect(422)).body)).toContain('dnc_sem_verificador')
      expect(fetchCalls).toHaveLength(0)
    })
    it('tudo certo: 201, liga o OPERADOR primeiro, registra e audita', async () => {
      configure()
      const r = await place().send({ leadId: LEAD }).expect(201)
      expect(r.body).toMatchObject({ status: 'queued' })
      expect(r.body.id).toMatch(/^[0-9a-f-]{36}$/)
      expect(fetchCalls).toHaveLength(1)
      expect(fetchCalls[0].body.get('To')).toBe('+5583988887777')
      expect(fetchCalls[0].body.get('Url')).toBe(`${BASE}/voice/webhooks/twilio/bridge?callId=${r.body.id}`)
      expect(fetchCalls[0].body.get('StatusCallback')).toBe(`${BASE}/voice/webhooks/twilio/status`)
      expect(db.audits().map((a) => a.action)).toContain('voice.call.place')
      expect(JSON.stringify(db.audits())).not.toMatch(/5583/)
    })
    it('provedor falha: 502 e a ligação fica marcada como falha', async () => {
      configure(); fetchOk = false
      await place().send({ leadId: LEAD }).expect(502)
      expect(db.queries.some((q) => /SET status = 'failed'/.test(q.sql))).toBe(true)
    })
  })

  describe('GET /voice/calls/:id', () => {
    it('viewer não recebe transcrição; manager recebe e a leitura é auditada', async () => {
      const v = await http().get(`/voice/calls/${CALL}`).set('Authorization', tok('viewer')).expect(200)
      expect(v.body.transcript).toBeNull()
      expect(v.body.transcript_restricted).toBe(true)
      expect(v.body.phone_masked).toMatch(/\*\*\*\*-1234$/)
      expect(JSON.stringify(v.body)).not.toContain('5583999991234')
      expect(db.audits().filter((a) => a.action === 'voice.transcript.read')).toHaveLength(0)
      const m = await http().get(`/voice/calls/${CALL}`).set('Authorization', tok('manager')).expect(200)
      expect(m.body.transcript.segments[0].text).toBe('olá')
      expect(db.audits().filter((a) => a.action === 'voice.transcript.read')).toHaveLength(1)
    })
    it('id inválido: 400', async () => { await http().get('/voice/calls/xyz').set('Authorization', tok('viewer')).expect(400) })
  })

  describe('PUT /voice/settings', () => {
    it('owner altera; janela inválida e aviso grande demais dão 400', async () => {
      await http().put('/voice/settings').set('Authorization', tok('owner')).send({ announcementText: 'Aviso novo.', dncEnabled: true }).expect(200)
      expect(db.audits().find((a) => a.action === 'voice.settings.update')).toBeTruthy()
      await http().put('/voice/settings').set('Authorization', tok('owner')).send({ callWindow: { days: [1], start: '18:00', end: '09:00', tz: 'America/Sao_Paulo' } }).expect(400)
      await http().put('/voice/settings').set('Authorization', tok('owner')).send({ announcementText: 'x'.repeat(601) }).expect(400)
    })
  })

  describe('webhooks públicos', () => {
    const statusParams = { CallSid: SID, CallStatus: 'in-progress', SequenceNumber: '2' }
    const sign = (path: string, params: Record<string, string>) => twilioSignature(TOKEN, BASE + path, params)
    const post = (path: string, params: Record<string, string>, sig?: string) => {
      const r = http().post(path).type('form')
      if (sig) r.set('X-Twilio-Signature', sig)
      return r.send(params)
    }

    it('sem VOICE_WEBHOOK_BASE_URL: 503; sem token: 403 (fail closed)', async () => {
      await post('/voice/webhooks/twilio/status', statusParams, 'qualquer').expect(503)
      process.env.VOICE_WEBHOOK_BASE_URL = BASE
      await post('/voice/webhooks/twilio/status', statusParams, 'qualquer').expect(403)
    })
    it('assinatura ausente, errada ou de outro corpo: 403, nada é gravado', async () => {
      configure()
      const p = '/voice/webhooks/twilio/status'
      await post(p, statusParams).expect(403)
      await post(p, statusParams, 'AAAA').expect(403)
      await post(p, statusParams, sign(p, { ...statusParams, CallStatus: 'completed' })).expect(403)
      expect(db.queries.filter((q) => /voice_call_events|UPDATE horizon_agent\.voice_calls/.test(q.sql))).toHaveLength(0)
    })
    it('provedor desconhecido na rota: 404', async () => {
      configure()
      await post('/voice/webhooks/zenvia/status', statusParams, 'x').expect(404)
    })
    it('status válido aplica; o MESMO evento reenviado é idempotente', async () => {
      configure()
      const p = '/voice/webhooks/twilio/status'
      const a = await post(p, statusParams, sign(p, statusParams)).expect(200)
      expect(a.body).toEqual({ ok: true, applied: true })
      const b = await post(p, statusParams, sign(p, statusParams)).expect(200)
      expect(b.body).toEqual({ ok: true, applied: false })
      expect(db.eventInserts).toBe(1)
    })
    it('chamada desconhecida: 200 sem revelar nada', async () => {
      configure(); db.call = null
      const p = '/voice/webhooks/twilio/status'
      const r = await post(p, statusParams, sign(p, statusParams)).expect(200)
      expect(r.body).toEqual({ ok: true, applied: false })
    })
    it('evento malformado (assinado) é 400', async () => {
      configure()
      const p = '/voice/webhooks/twilio/status'
      const bad = { CallSid: "x'; DROP TABLE", CallStatus: 'completed' }
      await post(p, bad, sign(p, bad)).expect(400)
    })
    it('a assinatura cobre a query string (callId)', async () => {
      configure()
      const path = `/voice/webhooks/twilio/announce?callId=${CALL}`
      const params = { CallSid: SID }
      const r = await post(path, params, sign(path, params)).expect(200)
      expect(r.headers['content-type']).toMatch(/text\/xml/)
      expect(r.text).toContain('<Say language="pt-BR">')
      expect(r.text).toContain('Esta ligação pode ser gravada.')
      // mesma assinatura em outro callId: recusada
      await post(`/voice/webhooks/twilio/announce?callId=${CALL.replace('2', '3')}`, params, sign(path, params)).expect(403)
    })
    it('announce sem aviso configurado desliga a perna (não grava sem aviso)', async () => {
      configure(); db.settings = { ...db.settings, announcement_text: null }
      const path = `/voice/webhooks/twilio/announce?callId=${CALL}`
      const r = await post(path, { CallSid: SID }, sign(path, { CallSid: SID })).expect(200)
      expect(r.text).toContain('<Hangup/>')
    })
    it('recording de chamada sem aviso entregue é descartado no provedor, sem guardar referência', async () => {
      configure()
      const p = '/voice/webhooks/twilio/recording'
      const params = { CallSid: SID, RecordingSid: 'RE' + 'd'.repeat(32), RecordingStatus: 'completed', RecordingDuration: '30' }
      const r = await post(p, params, sign(p, params)).expect(200)
      expect(r.body).toEqual({ ok: true, stored: false })
      expect(fetchCalls.some((c) => c.url.includes('/Recordings/RE'))).toBe(true) // DELETE no provedor
      expect(db.queries.some((q) => /SET recording_url_ref = \$2/.test(q.sql))).toBe(false)
      expect(db.audits().map((a) => a.action)).toContain('voice.recording.discarded')
    })
  })
})
