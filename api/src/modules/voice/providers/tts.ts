import { ProviderStatus } from '../voice.types'
import { missingOf } from '../voice.config'

type FetchLike = (url: string, init?: any) => Promise<any>

export interface TtsProvider {
  readonly id: string
  status(): ProviderStatus
  /** Sintetiza fala. Falha fechado (lança) sem chave. */
  synthesize(text: string, opts?: { format?: string }): Promise<{ audio: Buffer; mime: string }>
}

export class TtsNotConfiguredError extends Error {
  constructor(public readonly missing: string[]) { super(`TTS não configurado: ${missing.join(', ')}`) }
}

export class DisabledTts implements TtsProvider {
  readonly id = 'disabled'
  status(): ProviderStatus { return { provider: this.id, configured: false, ready: false, missing: ['ELEVENLABS_API_KEY', 'ELEVENLABS_VOICE_ID'] } }
  async synthesize(): Promise<never> { throw new TtsNotConfiguredError(['ELEVENLABS_API_KEY', 'ELEVENLABS_VOICE_ID']) }
}

/**
 * ElevenLabs Text-to-Speech (POST /v1/text-to-speech/{voice_id}). UNTESTED contra o provedor real.
 * Transferência internacional (LGPD art. 33): o texto sintetizado sai do Brasil. Não envie dado pessoal do lead.
 */
export class ElevenLabsTts implements TtsProvider {
  readonly id = 'elevenlabs'
  constructor(private readonly fetchImpl: FetchLike = (u, i) => fetch(u, i)) {}

  status(): ProviderStatus {
    const missing = missingOf(['ELEVENLABS_API_KEY', 'ELEVENLABS_VOICE_ID'])
    return { provider: this.id, configured: missing.length === 0, ready: missing.length === 0, missing }
  }

  async synthesize(text: string, opts: { format?: string } = {}) {
    const missing = this.status().missing
    if (missing.length) throw new TtsNotConfiguredError(missing)
    if (!text?.trim()) throw new Error('Texto vazio')
    const voice = encodeURIComponent((process.env.ELEVENLABS_VOICE_ID ?? '').trim())
    const format = opts.format ?? 'mp3_44100_128'
    const res = await this.fetchImpl(`https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=${encodeURIComponent(format)}`, {
      method: 'POST',
      headers: { 'xi-api-key': (process.env.ELEVENLABS_API_KEY ?? '').trim(), 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
      body: JSON.stringify({ text, model_id: (process.env.ELEVENLABS_MODEL_ID ?? '').trim() || 'eleven_multilingual_v2' }),
      signal: AbortSignal.timeout(30_000),
    })
    if (!res.ok) throw new Error(`ElevenLabs TTS respondeu HTTP ${res.status}`)
    return { audio: Buffer.from(await res.arrayBuffer()), mime: format.startsWith('ulaw') ? 'audio/basic' : 'audio/mpeg' }
  }
}

export function resolveTts(fetchImpl?: FetchLike): TtsProvider {
  return new ElevenLabsTts(fetchImpl)
}
