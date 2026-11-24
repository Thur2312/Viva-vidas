import { ProviderStatus } from '../voice.types'
import { missingOf } from '../voice.config'
import { pcm24kToMulaw8k, stripWavHeader } from '../agent/audio/pcm'

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

const env = (k: string) => (process.env[k] ?? '').trim()

/** Provedores de voz que o dono pode escolher no painel (TTS_PROVIDER). Open source fica de fora: decisão do cliente. */
export const TTS_PROVIDERS = ['elevenlabs', 'gemini', 'openai', 'google'] as const
export type TtsProviderId = (typeof TTS_PROVIDERS)[number]

/** Cada provedor precisa destas variáveis. */
export const TTS_REQUIRED: Record<TtsProviderId, string[]> = {
  elevenlabs: ['ELEVENLABS_API_KEY', 'ELEVENLABS_VOICE_ID'],
  gemini: ['GEMINI_API_KEY'],
  openai: ['OPENAI_API_KEY'],
  google: ['GOOGLE_TTS_API_KEY'],
}

export class DisabledTts implements TtsProvider {
  readonly id = 'disabled'
  status(): ProviderStatus { return { provider: this.id, configured: false, ready: false, missing: TTS_REQUIRED.elevenlabs } }
  async synthesize(): Promise<never> { throw new TtsNotConfiguredError(TTS_REQUIRED.elevenlabs) }
}

abstract class BaseTts implements TtsProvider {
  abstract readonly id: TtsProviderId
  constructor(protected readonly fetchImpl: FetchLike = (u, i) => fetch(u, i)) {}

  status(): ProviderStatus {
    const missing = missingOf(TTS_REQUIRED[this.id])
    return { provider: this.id, configured: missing.length === 0, ready: missing.length === 0, missing }
  }

  protected guard(text: string) {
    const missing = this.status().missing
    if (missing.length) throw new TtsNotConfiguredError(missing)
    if (!text?.trim()) throw new Error('Texto vazio')
  }

  abstract synthesize(text: string, opts?: { format?: string }): Promise<{ audio: Buffer; mime: string }>
}

/**
 * ElevenLabs Text-to-Speech (POST /v1/text-to-speech/{voice_id}). UNTESTED contra o provedor real.
 * Transferência internacional (LGPD art. 33): o texto sintetizado sai do Brasil. Não envie dado pessoal do lead.
 */
export class ElevenLabsTts extends BaseTts {
  readonly id = 'elevenlabs' as const

  async synthesize(text: string, opts: { format?: string } = {}) {
    this.guard(text)
    const voice = encodeURIComponent(env('ELEVENLABS_VOICE_ID'))
    const format = opts.format ?? 'mp3_44100_128'
    const res = await this.fetchImpl(`https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=${encodeURIComponent(format)}`, {
      method: 'POST',
      headers: { 'xi-api-key': env('ELEVENLABS_API_KEY'), 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
      body: JSON.stringify({ text, model_id: env('ELEVENLABS_MODEL_ID') || 'eleven_multilingual_v2' }),
      signal: AbortSignal.timeout(30_000),
    })
    if (!res.ok) throw new Error(`ElevenLabs TTS respondeu HTTP ${res.status}`)
    return { audio: Buffer.from(await res.arrayBuffer()), mime: format.startsWith('ulaw') ? 'audio/basic' : 'audio/mpeg' }
  }
}

/**
 * Os três provedores abaixo devolvem SEMPRE μ-law 8 kHz (`audio/basic`), o formato da linha telefônica.
 * UNTESTED contra os provedores reais. Transferência internacional (art. 33): só frases do agente, sem dado do lead.
 */

/** Gemini TTS (generateContent com áudio). Usa a mesma chave GEMINI_API_KEY do agente. Saída: PCM 24 kHz. */
export class GeminiTts extends BaseTts {
  readonly id = 'gemini' as const

  async synthesize(text: string) {
    this.guard(text)
    const model = env('GEMINI_TTS_MODEL') || 'gemini-2.5-flash-preview-tts'
    const res = await this.fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': env('GEMINI_API_KEY') },
      body: JSON.stringify({
        contents: [{ parts: [{ text: `Diga em português do Brasil, em tom natural e acolhedor: ${text}` }] }],
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: env('GEMINI_TTS_VOICE') || 'Kore' } } },
        },
      }),
      signal: AbortSignal.timeout(30_000),
    })
    if (!res.ok) throw new Error(`Gemini TTS respondeu HTTP ${res.status}`)
    const json: any = await res.json()
    const b64 = json?.candidates?.[0]?.content?.parts?.find((p: any) => p?.inlineData?.data)?.inlineData?.data
    if (typeof b64 !== 'string' || !b64) throw new Error('Gemini TTS sem áudio na resposta')
    return { audio: pcm24kToMulaw8k(Buffer.from(b64, 'base64')), mime: 'audio/basic' }
  }
}

/** OpenAI TTS (/v1/audio/speech, `response_format: pcm` = 24 kHz s16le). */
export class OpenAiTts extends BaseTts {
  readonly id = 'openai' as const

  async synthesize(text: string) {
    this.guard(text)
    const res = await this.fetchImpl('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: { authorization: `Bearer ${env('OPENAI_API_KEY')}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: env('OPENAI_TTS_MODEL') || 'gpt-4o-mini-tts',
        voice: env('OPENAI_TTS_VOICE') || 'alloy',
        input: text,
        response_format: 'pcm',
        instructions: 'Fale em português do Brasil, em tom natural e acolhedor, em ritmo de conversa.',
      }),
      signal: AbortSignal.timeout(30_000),
    })
    if (!res.ok) throw new Error(`OpenAI TTS respondeu HTTP ${res.status}`)
    return { audio: pcm24kToMulaw8k(Buffer.from(await res.arrayBuffer())), mime: 'audio/basic' }
  }
}

/** Google Cloud Text-to-Speech (vozes Chirp 3 HD). Pede MULAW 8 kHz direto; a resposta pode vir com cabeçalho WAV. */
export class GoogleTts extends BaseTts {
  readonly id = 'google' as const

  async synthesize(text: string) {
    this.guard(text)
    const res = await this.fetchImpl('https://texttospeech.googleapis.com/v1/text:synthesize', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': env('GOOGLE_TTS_API_KEY') },
      body: JSON.stringify({
        input: { text },
        voice: { languageCode: 'pt-BR', name: env('GOOGLE_TTS_VOICE') || 'pt-BR-Chirp3-HD-Aoede' },
        audioConfig: { audioEncoding: 'MULAW', sampleRateHertz: 8000 },
      }),
      signal: AbortSignal.timeout(30_000),
    })
    if (!res.ok) throw new Error(`Google TTS respondeu HTTP ${res.status}`)
    const json: any = await res.json()
    if (typeof json?.audioContent !== 'string' || !json.audioContent) throw new Error('Google TTS sem áudio na resposta')
    return { audio: stripWavHeader(Buffer.from(json.audioContent, 'base64')), mime: 'audio/basic' }
  }
}

/** Provedor escolhido no painel (TTS_PROVIDER). Sem escolha, ElevenLabs (o comportamento anterior). */
export function ttsProviderId(): TtsProviderId {
  const v = env('TTS_PROVIDER').toLowerCase()
  return (TTS_PROVIDERS as readonly string[]).includes(v) ? (v as TtsProviderId) : 'elevenlabs'
}

/** Delega ao provedor escolhido NO MOMENTO do uso: trocar TTS_PROVIDER no painel vale sem reiniciar a API. */
export class DynamicTts implements TtsProvider {
  constructor(private readonly fetchImpl?: FetchLike) {}
  get id() { return resolveTts(this.fetchImpl).id }
  status() { return resolveTts(this.fetchImpl).status() }
  synthesize(text: string, opts?: { format?: string }) { return resolveTts(this.fetchImpl).synthesize(text, opts) }
}

export function resolveTts(fetchImpl?: FetchLike): TtsProvider {
  switch (ttsProviderId()) {
    case 'gemini': return new GeminiTts(fetchImpl)
    case 'openai': return new OpenAiTts(fetchImpl)
    case 'google': return new GoogleTts(fetchImpl)
    default: return new ElevenLabsTts(fetchImpl)
  }
}
