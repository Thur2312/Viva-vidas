import { CallStatus, ProviderStatus } from '../voice.types'
import { missingOf } from '../voice.config'
import { validateTwilioSignature } from './twilio-signature'
import {
  BridgeInstructionsInput, ParsedRecording, ParsedStatus, PlaceCallRequest, PlacedCall, ProviderCallInfo, ProviderError,
  ProviderNotConfiguredError, TelephonyAdapter, WebhookRequest,
} from './telephony.types'

type FetchLike = (url: string, init?: any) => Promise<any>

const API = 'https://api.twilio.com/2010-04-01'
const REQUIRED = ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_VOICE_NUMBER']

const STATUS_MAP: Record<string, CallStatus> = {
  queued: 'queued', initiated: 'queued', ringing: 'ringing', 'in-progress': 'in_progress', answered: 'in_progress',
  completed: 'completed', busy: 'busy', 'no-answer': 'no_answer', failed: 'failed', canceled: 'canceled',
}

const XML_ESC: Record<string, string> = { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }
const xml = (s: string) => s.replace(/[<>&"']/g, (c) => XML_ESC[c])
const CALL_SID = /^CA[0-9a-zA-Z]{20,40}$/
const REC_SID = /^RE[0-9a-zA-Z]{20,40}$/

const num = (v: unknown): number | null => {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null
}

/**
 * Twilio Programmable Voice via REST + webhooks, sem SDK (fetch nativo do Node 18+).
 * ESCRITO CONTRA A DOCUMENTAÇÃO PÚBLICA, NUNCA EXECUTADO CONTRA O TWILIO: sem conta, não há como validar.
 * Antes de produção: ligar com uma conta de teste e conferir cada chamada (ver docs/voice.md).
 */
export class TwilioTelephony implements TelephonyAdapter {
  readonly id = 'twilio'
  constructor(private readonly fetchImpl: FetchLike = (u, i) => fetch(u, i)) {}

  private get sid() { return (process.env.TWILIO_ACCOUNT_SID ?? '').trim() }
  private get token() { return (process.env.TWILIO_AUTH_TOKEN ?? '').trim() }
  private get from() { return (process.env.TWILIO_VOICE_NUMBER ?? '').trim() }

  callerId() { return this.from }

  status(): ProviderStatus {
    const missing = missingOf(REQUIRED)
    return { provider: this.id, configured: missing.length === 0, ready: missing.length === 0, missing }
  }

  private assertReady() {
    const missing = missingOf(REQUIRED)
    if (missing.length) throw new ProviderNotConfiguredError(missing)
  }

  private async call(method: string, path: string, body?: URLSearchParams, accept = 'application/json') {
    this.assertReady()
    try {
      return await this.fetchImpl(`${API}/Accounts/${encodeURIComponent(this.sid)}/${path}`, {
        method,
        headers: {
          Authorization: 'Basic ' + Buffer.from(`${this.sid}:${this.token}`).toString('base64'),
          Accept: accept,
          ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
        },
        body: body?.toString(),
        signal: AbortSignal.timeout(15_000),
      })
    } catch {
      throw new ProviderError('Falha de rede ao falar com o provedor de telefonia')
    }
  }

  async placeCall(r: PlaceCallRequest): Promise<PlacedCall> {
    const b = new URLSearchParams()
    b.set('To', r.operatorPhone)
    b.set('From', this.from)
    b.set('Url', r.instructionsUrl)
    b.set('Method', 'POST')
    b.set('StatusCallback', r.statusUrl)
    b.set('StatusCallbackMethod', 'POST')
    for (const e of ['initiated', 'ringing', 'answered', 'completed']) b.append('StatusCallbackEvent', e)
    b.set('Timeout', '25')
    const res = await this.call('POST', 'Calls.json', b)
    if (!res.ok) throw new ProviderError(`Provedor recusou a ligação (HTTP ${res.status})`, res.status)
    const j = await res.json()
    if (!j?.sid) throw new ProviderError('Resposta do provedor sem identificador de chamada')
    return { providerCallSid: String(j.sid), status: STATUS_MAP[String(j.status)] ?? 'queued' }
  }

  async getCall(sid: string): Promise<ProviderCallInfo> {
    const res = await this.call('GET', `Calls/${encodeURIComponent(sid)}.json`)
    if (!res.ok) throw new ProviderError(`Provedor respondeu HTTP ${res.status}`, res.status)
    const j = await res.json()
    const price = j.price != null ? Math.round(Math.abs(Number(j.price)) * 100) : null // moeda da conta (USD por padrão)
    return {
      providerCallSid: String(j.sid), status: STATUS_MAP[String(j.status)] ?? 'queued',
      durationSec: num(j.duration), priceCents: price != null && Number.isFinite(price) ? price : null,
    }
  }

  async hangup(sid: string): Promise<void> {
    const res = await this.call('POST', `Calls/${encodeURIComponent(sid)}.json`, new URLSearchParams({ Status: 'completed' }))
    if (!res.ok) throw new ProviderError(`Provedor respondeu HTTP ${res.status}`, res.status)
  }

  validateWebhook(r: WebhookRequest): boolean {
    return validateTwilioSignature(this.token, r.url, r.params, r.signature)
  }

  parseStatusWebhook(p: Record<string, string>): ParsedStatus | null {
    const sid = p.CallSid
    const status = STATUS_MAP[String(p.CallStatus ?? '').toLowerCase()]
    if (!sid || !CALL_SID.test(sid) || !status) return null
    return { providerCallSid: sid, status, durationSec: num(p.CallDuration), eventKey: `${status}:${p.SequenceNumber ?? ''}` }
  }

  parseRecordingWebhook(p: Record<string, string>): ParsedRecording | null {
    const sid = p.CallSid, rec = p.RecordingSid
    if (!sid || !CALL_SID.test(sid) || !rec || !REC_SID.test(rec)) return null
    const s = String(p.RecordingStatus ?? '').toLowerCase()
    const status = s === 'completed' ? 'completed' : s === 'in-progress' ? 'in_progress' : s === 'absent' ? 'absent' : s === 'failed' ? 'failed' : null
    if (!status) return null
    return { providerCallSid: sid, recordingRef: `twilio:${rec}`, status, durationSec: num(p.RecordingDuration), eventKey: `rec:${rec}:${status}` }
  }

  private recSid(ref: string) {
    const m = /^twilio:(RE[0-9a-zA-Z]{20,40})$/.exec(ref)
    if (!m) throw new ProviderError('Referência de gravação inválida')
    return m[1]
  }

  async fetchRecordingAudio(ref: string) {
    const res = await this.call('GET', `Recordings/${this.recSid(ref)}.mp3`, undefined, 'audio/mpeg')
    if (!res.ok) throw new ProviderError(`Provedor respondeu HTTP ${res.status}`, res.status)
    return { audio: Buffer.from(await res.arrayBuffer()), mime: 'audio/mpeg' }
  }

  async deleteRecording(ref: string): Promise<void> {
    const res = await this.call('DELETE', `Recordings/${this.recSid(ref)}.json`)
    if (!res.ok && res.status !== 404) throw new ProviderError(`Provedor respondeu HTTP ${res.status} ao apagar gravação`, res.status)
  }

  /** TwiML: o <Number url> toca o aviso para o LEAD antes de ligar a ponte; `record` só é ligado com aviso configurado. */
  buildBridgeInstructions(i: BridgeInstructionsInput): string {
    const rec = i.record
      ? ` record="record-from-answer-dual" recordingStatusCallback="${xml(i.recordingCallbackUrl)}" recordingStatusCallbackEvent="completed" recordingStatusCallbackMethod="POST"`
      : ''
    return `<?xml version="1.0" encoding="UTF-8"?><Response><Dial callerId="${xml(i.callerId)}" answerOnBridge="true"${rec}><Number url="${xml(i.announceUrl)}" method="POST">${xml(i.leadPhone)}</Number></Dial></Response>`
  }

  buildHangupInstructions(): string {
    return `<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>`
  }

  buildAnnouncementInstructions(text: string): string {
    return `<?xml version="1.0" encoding="UTF-8"?><Response><Say language="pt-BR">${xml(text)}</Say></Response>`
  }
}
