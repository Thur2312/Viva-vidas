import { SpeechSynthesizer } from '../agent.types'
import { readBody } from './stream-utils'

type FetchLike = (url: string, init?: any) => Promise<any>

export class StreamTtsNotConfiguredError extends Error {
  constructor(public readonly missing: string[]) { super(`TTS não configurado: ${missing.join(', ')}`) }
}

const env = (k: string) => (process.env[k] ?? '').trim()

/**
 * TTS em streaming do ElevenLabs já em μ-law 8 kHz (`output_format=ulaw_8000`): vai direto para a linha, sem reamostrar.
 * Modelo padrão `eleven_flash_v2_5` (o de menor latência); `ELEVENLABS_MODEL_ID` sobrescreve.
 * UNTESTED contra o provedor real. Transferência internacional (art. 33): só frases do agente, sem dado do lead.
 */
export class ElevenLabsStreamTts implements SpeechSynthesizer {
  constructor(private readonly fetchImpl: FetchLike = (u, i) => fetch(u, i)) {}

  missing(): string[] {
    return ['ELEVENLABS_API_KEY', 'ELEVENLABS_VOICE_ID'].filter((k) => !env(k))
  }

  async *stream(text: string, signal: AbortSignal): AsyncIterable<Buffer> {
    const missing = this.missing()
    if (missing.length) throw new StreamTtsNotConfiguredError(missing)
    if (!text?.trim()) return
    const voice = encodeURIComponent(env('ELEVENLABS_VOICE_ID'))
    const res = await this.fetchImpl(`https://api.elevenlabs.io/v1/text-to-speech/${voice}/stream?output_format=ulaw_8000`, {
      method: 'POST',
      headers: { 'xi-api-key': env('ELEVENLABS_API_KEY'), 'content-type': 'application/json', accept: 'audio/basic' },
      body: JSON.stringify({ text, model_id: env('ELEVENLABS_MODEL_ID') || 'eleven_flash_v2_5', language_code: 'pt' }),
      signal,
    })
    if (!res.ok) throw new Error(`ElevenLabs TTS respondeu HTTP ${res.status}`)
    for await (const chunk of readBody(res.body)) {
      if (signal.aborted) return
      yield Buffer.from(chunk)
    }
  }
}
