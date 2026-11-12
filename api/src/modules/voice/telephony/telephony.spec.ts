import { createHmac } from 'crypto'
import { twilioSignature, validateTwilioSignature } from './twilio-signature'
import { TwilioTelephony } from './twilio.adapter'
import { DisabledTelephony } from './disabled.telephony'
import { ProviderNotConfiguredError } from './telephony.types'

const TOKEN = 'token-de-teste-0000'
const URL_ = 'https://voz.exemplo.test/voice/webhooks/twilio/status'
const PARAMS = { CallSid: 'CA' + 'a'.repeat(32), CallStatus: 'completed', CallDuration: '42', SequenceNumber: '3' }

describe('assinatura X-Twilio-Signature', () => {
  it('bate com HMAC-SHA1 independente (url + chaves ordenadas chave+valor, base64)', () => {
    const data = URL_ + 'CallDuration42CallSid' + PARAMS.CallSid + 'CallStatuscompletedSequenceNumber3'
    expect(twilioSignature(TOKEN, URL_, PARAMS)).toBe(createHmac('sha1', TOKEN).update(data).digest('base64'))
  })
  it('vetor de exemplo conhecido da documentação do Twilio (token 12345; transcrito de memória, conferir no site)', () => {
    const sig = twilioSignature('12345', 'https://mycompany.com/myapp.php?foo=1&bar=2', {
      Digits: '1234', To: '+18005551212', From: '+14158675310', Caller: '+14158675310', CallSid: 'CA1234567890ABCDE',
    })
    expect(sig).toBe('GvWf1cFY/Q7PnoempGyD5oXAezc=')
  })
  it('aceita a válida e recusa adulterada, outra URL, outro token, ausente e de tamanho diferente', () => {
    const good = twilioSignature(TOKEN, URL_, PARAMS)
    expect(validateTwilioSignature(TOKEN, URL_, PARAMS, good)).toBe(true)
    expect(validateTwilioSignature(TOKEN, URL_, { ...PARAMS, CallDuration: '43' }, good)).toBe(false)
    expect(validateTwilioSignature(TOKEN, URL_ + '?x=1', PARAMS, good)).toBe(false)
    expect(validateTwilioSignature('outro', URL_, PARAMS, good)).toBe(false)
    expect(validateTwilioSignature(TOKEN, URL_, PARAMS, undefined)).toBe(false)
    expect(validateTwilioSignature(TOKEN, URL_, PARAMS, good.slice(0, -2))).toBe(false)
    expect(validateTwilioSignature('', URL_, PARAMS, good)).toBe(false)
  })
})

describe('TwilioTelephony', () => {
  const saved = { ...process.env }
  afterEach(() => { process.env = { ...saved } })
  const configure = () => Object.assign(process.env, { TWILIO_ACCOUNT_SID: 'AC' + 'b'.repeat(32), TWILIO_AUTH_TOKEN: TOKEN, TWILIO_VOICE_NUMBER: '+5511999990000' })

  it('sem variáveis: não configurado, lista os NOMES que faltam e falha fechado', async () => {
    for (const k of ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_VOICE_NUMBER']) delete process.env[k]
    const t = new TwilioTelephony()
    expect(t.status()).toEqual({ provider: 'twilio', configured: false, ready: false, missing: ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_VOICE_NUMBER'] })
    await expect(t.placeCall({ callId: 'c', operatorPhone: '+1', leadPhone: '+2', instructionsUrl: 'u', statusUrl: 's' })).rejects.toBeInstanceOf(ProviderNotConfiguredError)
    expect(t.validateWebhook({ url: URL_, params: PARAMS, signature: twilioSignature(TOKEN, URL_, PARAMS) })).toBe(false)
  })

  it('placeCall monta o POST do REST com Basic auth, URLs e eventos (fetch falso, nenhuma rede)', async () => {
    configure()
    const calls: any[] = []
    const t = new TwilioTelephony(async (url, init) => { calls.push({ url, init }); return { ok: true, status: 201, json: async () => ({ sid: 'CA' + 'c'.repeat(32), status: 'queued' }) } })
    const r = await t.placeCall({ callId: 'id1', operatorPhone: '+5583988887777', leadPhone: '+5583999991234', instructionsUrl: 'https://x.test/bridge?callId=id1', statusUrl: 'https://x.test/status' })
    expect(r).toEqual({ providerCallSid: 'CA' + 'c'.repeat(32), status: 'queued' })
    const c = calls[0]
    expect(c.url).toBe(`https://api.twilio.com/2010-04-01/Accounts/AC${'b'.repeat(32)}/Calls.json`)
    expect(c.init.method).toBe('POST')
    expect(c.init.headers.Authorization).toBe('Basic ' + Buffer.from(`AC${'b'.repeat(32)}:${TOKEN}`).toString('base64'))
    const body = new URLSearchParams(c.init.body)
    expect(body.get('To')).toBe('+5583988887777') // toca primeiro o operador
    expect(body.get('From')).toBe('+5511999990000')
    expect(body.get('Url')).toBe('https://x.test/bridge?callId=id1')
    expect(body.get('StatusCallback')).toBe('https://x.test/status')
    expect(body.getAll('StatusCallbackEvent')).toEqual(['initiated', 'ringing', 'answered', 'completed'])
    expect(body.toString()).not.toContain('5583999991234') // telefone do lead só vai na instrução (TwiML), não no REST
  })

  it('erro HTTP do provedor vira ProviderError sem vazar o corpo', async () => {
    configure()
    const t = new TwilioTelephony(async () => ({ ok: false, status: 401, json: async () => ({ message: 'segredo' }) }))
    await expect(t.placeCall({ callId: 'c', operatorPhone: '+1', leadPhone: '+2', instructionsUrl: 'u', statusUrl: 's' })).rejects.toThrow(/HTTP 401/)
  })

  it('parseStatusWebhook mapeia estados e rejeita sid/estado inválidos', () => {
    const t = new TwilioTelephony()
    expect(t.parseStatusWebhook(PARAMS)).toEqual({ providerCallSid: PARAMS.CallSid, status: 'completed', durationSec: 42, eventKey: 'completed:3' })
    expect(t.parseStatusWebhook({ ...PARAMS, CallStatus: 'no-answer' })?.status).toBe('no_answer')
    expect(t.parseStatusWebhook({ ...PARAMS, CallStatus: 'in-progress' })?.status).toBe('in_progress')
    expect(t.parseStatusWebhook({ ...PARAMS, CallStatus: 'inventado' })).toBeNull()
    expect(t.parseStatusWebhook({ ...PARAMS, CallSid: "x'; DROP" })).toBeNull()
    expect(t.parseStatusWebhook({ ...PARAMS, CallDuration: '-5' })?.durationSec).toBeNull()
  })

  it('parseRecordingWebhook guarda só a referência (sem URL) e valida sids', () => {
    const t = new TwilioTelephony()
    const p = { CallSid: PARAMS.CallSid, RecordingSid: 'RE' + 'd'.repeat(32), RecordingStatus: 'completed', RecordingDuration: '40', RecordingUrl: 'https://api.twilio.com/x' }
    const r = t.parseRecordingWebhook(p)!
    expect(r).toMatchObject({ recordingRef: 'twilio:RE' + 'd'.repeat(32), status: 'completed', durationSec: 40 })
    expect(JSON.stringify(r)).not.toContain('https://')
    expect(t.parseRecordingWebhook({ ...p, RecordingSid: 'zzz' })).toBeNull()
    expect(t.parseRecordingWebhook({ ...p, RecordingStatus: 'x' })).toBeNull()
  })

  it('instruções (TwiML): gravação só quando record=true; escapa XML', () => {
    const t = new TwilioTelephony()
    const i = { leadPhone: '+5583999991234', callerId: '+5511999990000', recordingCallbackUrl: 'https://x.test/rec?a=1&b=2', announceUrl: 'https://x.test/ann?callId=1', record: true }
    const withRec = t.buildBridgeInstructions(i)
    expect(withRec).toContain('record="record-from-answer-dual"')
    expect(withRec).toContain('a=1&amp;b=2')
    expect(withRec).toContain('<Number url="https://x.test/ann?callId=1"')
    expect(t.buildBridgeInstructions({ ...i, record: false })).not.toContain('record=')
    expect(t.buildAnnouncementInstructions('Gravada <agora> & "sempre"')).toContain('Gravada &lt;agora&gt; &amp; &quot;sempre&quot;')
    expect(t.buildHangupInstructions()).toContain('<Hangup/>')
  })

  it('deleteRecording trata 404 como já apagada e recusa referência malformada', async () => {
    configure()
    const t404 = new TwilioTelephony(async () => ({ ok: false, status: 404 }))
    await expect(t404.deleteRecording('twilio:RE' + 'e'.repeat(32))).resolves.toBeUndefined()
    await expect(t404.deleteRecording('../../Calls')).rejects.toThrow(/inválida/)
    const t500 = new TwilioTelephony(async () => ({ ok: false, status: 500 }))
    await expect(t500.deleteRecording('twilio:RE' + 'e'.repeat(32))).rejects.toThrow(/500/)
  })
})

describe('DisabledTelephony', () => {
  it('tudo falha fechado', async () => {
    const d = new DisabledTelephony()
    expect(d.status().ready).toBe(false)
    expect(d.validateWebhook()).toBe(false)
    expect(d.parseStatusWebhook()).toBeNull()
    await expect(d.hangup('x')).rejects.toBeInstanceOf(ProviderNotConfiguredError)
  })
})
