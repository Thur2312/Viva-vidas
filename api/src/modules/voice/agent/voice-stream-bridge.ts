import { SttProvider } from '../providers/stt'
import { mulawToWav } from './audio/mulaw'
import { EnergyVad, VadOptions } from './audio/vad'
import { parseTwilioMessage } from './adapters/twilio-media-stream'
import { VoiceAgentSession } from './voice-agent-session'

export interface BridgeDeps {
  session: VoiceAgentSession
  /** STT em LOTE por fala (usa os provedores existentes). Mais lento que streaming: trocar por um STT em streaming quando houver. */
  stt: SttProvider
  vad?: VadOptions
  /** Áudio anterior ao início detectado da fala, para não cortar a primeira sílaba. */
  preRollMs?: number
  /** Falas mais curtas que isso são ruído/estalo: não vão ao STT. */
  minUtteranceMs?: number
  /** Teto de áudio guardado por fala. */
  maxUtteranceMs?: number
  language?: string
  onClose?: () => void
}

/**
 * Liga o áudio da linha (μ-law 8 kHz) à `VoiceAgentSession`: VAD → fim de turno → STT → agente.
 * Independente do transporte: `onMedia` recebe bytes; `handleTwilioMessage` aceita o JSON do Media Streams.
 */
export class VoiceStreamBridge {
  private readonly vad: EnergyVad
  private ring: Buffer = Buffer.alloc(0)
  private utter: Buffer[] = []
  private utterBytes = 0
  private collecting = false
  private seq = 0
  private closed = false
  private readonly preBytes: number
  private readonly minMs: number
  private readonly maxBytes: number
  streamSid: string | null = null

  constructor(private readonly deps: BridgeDeps) {
    this.preBytes = ((deps.preRollMs ?? 300) * 8000) / 1000
    this.minMs = deps.minUtteranceMs ?? 200
    this.maxBytes = ((deps.maxUtteranceMs ?? 30_000) * 8000) / 1000
    this.vad = new EnergyVad({
      onSpeechStart: () => this.speechStart(),
      onSpeechEnd: (silenceMs, voicedMs) => this.speechEnd(silenceMs, voicedMs),
    }, deps.vad)
  }

  onMedia(chunk: Buffer): void {
    if (this.closed) return
    if (this.collecting) {
      if (this.utterBytes < this.maxBytes) { this.utter.push(chunk); this.utterBytes += chunk.length }
    } else {
      const joined = this.ring.length ? Buffer.concat([this.ring, chunk]) : chunk
      this.ring = joined.length > this.preBytes ? joined.subarray(joined.length - this.preBytes) : joined
    }
    this.vad.push(chunk)
  }

  handleTwilioMessage(raw: string | Buffer): void {
    const ev = parseTwilioMessage(raw)
    if (!ev) return
    if (ev.type === 'start') this.streamSid = ev.streamSid
    else if (ev.type === 'media' && (ev.track === null || ev.track === 'inbound')) this.onMedia(ev.payload)
    else if (ev.type === 'stop') this.close()
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.seq++
    this.deps.onClose?.()
  }

  private speechStart(): void {
    this.seq++
    this.collecting = true
    this.utter = [this.ring]
    this.utterBytes = this.ring.length
    this.ring = Buffer.alloc(0)
    this.deps.session.speechStart()
  }

  private speechEnd(silenceMs: number, voicedMs: number): void {
    this.collecting = false
    const audio = Buffer.concat(this.utter)
    this.utter = []
    this.utterBytes = 0
    if (voicedMs < this.minMs) return
    const mine = ++this.seq
    this.deps.session.speechEnd(silenceMs)
    void this.transcribeAndReply(audio, mine)
  }

  private async transcribeAndReply(audio: Buffer, mine: number): Promise<void> {
    let text = ''
    try {
      const r = await this.deps.stt.transcribe(mulawToWav(audio), { mime: 'audio/wav', language: this.deps.language ?? 'pt' })
      text = r.segments.map((s) => s.text).join(' ').trim()
    } catch {
      // Nunca repetir o erro do provedor (pode conter trecho da fala): só passa ao humano.
      if (mine === this.seq && !this.closed) this.deps.session.handoff('erro')
      return
    }
    // O lead voltou a falar enquanto transcrevia: esta transcrição ficou velha.
    if (mine !== this.seq || this.closed) return
    await this.deps.session.finalTranscript(text)
  }
}
