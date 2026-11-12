import { ProviderStatus, TranscriptSegment } from '../voice.types'

type FetchLike = (url: string, init?: any) => Promise<any>

export interface SttResult { segments: TranscriptSegment[]; language: string | null }

export interface SttProvider {
  readonly id: string
  status(): ProviderStatus
  transcribe(audio: Buffer, opts: { mime: string; language?: string }): Promise<SttResult>
}

export class SttNotConfiguredError extends Error {
  constructor(public readonly missing: string[]) { super(`STT não configurado: ${missing.join(', ')}`) }
}

const env = (k: string) => (process.env[k] ?? '').trim()

export class DisabledStt implements SttProvider {
  readonly id = 'disabled'
  constructor(private readonly missing = ['STT_PROVIDER', 'STT_API_KEY']) {}
  status(): ProviderStatus { return { provider: this.id, configured: false, ready: false, missing: this.missing } }
  async transcribe(): Promise<never> { throw new SttNotConfiguredError(this.missing) }
}

/** Junta palavras consecutivas do mesmo falante em segmentos (formato do ElevenLabs Scribe). */
export function wordsToSegments(words: any[]): TranscriptSegment[] {
  const segs: TranscriptSegment[] = []
  for (const w of words ?? []) {
    if (w?.type && w.type !== 'word' && w.type !== 'spacing') continue
    const speaker = w.speaker_id != null ? String(w.speaker_id) : null
    const last = segs[segs.length - 1]
    if (last && last.speaker === speaker) {
      last.text += w.text ?? ''
      if (typeof w.end === 'number') last.end = w.end
    } else {
      segs.push({ start: typeof w.start === 'number' ? w.start : null, end: typeof w.end === 'number' ? w.end : null, speaker, text: String(w.text ?? '') })
    }
  }
  return segs.map((s) => ({ ...s, text: s.text.replace(/\s+/g, ' ').trim() })).filter((s) => s.text)
}

/**
 * ElevenLabs Scribe (POST /v1/speech-to-text, multipart, model_id scribe_v1). UNTESTED contra o provedor real.
 * Chave: STT_API_KEY, com fallback para ELEVENLABS_API_KEY.
 */
export class ElevenLabsStt implements SttProvider {
  readonly id = 'elevenlabs'
  constructor(private readonly fetchImpl: FetchLike = (u, i) => fetch(u, i)) {}
  private key() { return env('STT_API_KEY') || env('ELEVENLABS_API_KEY') }
  status(): ProviderStatus {
    const ok = !!this.key()
    return { provider: this.id, configured: ok, ready: ok, missing: ok ? [] : ['STT_API_KEY'] }
  }
  async transcribe(audio: Buffer, opts: { mime: string; language?: string }): Promise<SttResult> {
    if (!this.key()) throw new SttNotConfiguredError(['STT_API_KEY'])
    const form = new FormData()
    form.set('model_id', env('STT_MODEL') || 'scribe_v1')
    form.set('diarize', 'true')
    if (opts.language) form.set('language_code', opts.language)
    form.set('file', new Blob([new Uint8Array(audio)], { type: opts.mime }), 'call.mp3')
    const res = await this.fetchImpl('https://api.elevenlabs.io/v1/speech-to-text', {
      method: 'POST', headers: { 'xi-api-key': this.key() }, body: form, signal: AbortSignal.timeout(120_000),
    })
    if (!res.ok) throw new Error(`ElevenLabs STT respondeu HTTP ${res.status}`)
    const j = await res.json()
    const segments = wordsToSegments(j.words)
    return { segments: segments.length ? segments : j.text ? [{ start: null, end: null, speaker: null, text: String(j.text) }] : [], language: j.language_code ?? null }
  }
}

/** API de transcrição compatível com a da OpenAI (POST {STT_BASE_URL}/audio/transcriptions). UNTESTED. */
export class OpenAiCompatStt implements SttProvider {
  readonly id = 'openai'
  constructor(private readonly fetchImpl: FetchLike = (u, i) => fetch(u, i)) {}
  status(): ProviderStatus {
    const ok = !!env('STT_API_KEY')
    return { provider: this.id, configured: ok, ready: ok, missing: ok ? [] : ['STT_API_KEY'] }
  }
  async transcribe(audio: Buffer, opts: { mime: string; language?: string }): Promise<SttResult> {
    if (!env('STT_API_KEY')) throw new SttNotConfiguredError(['STT_API_KEY'])
    const base = (env('STT_BASE_URL') || 'https://api.openai.com/v1').replace(/\/+$/, '')
    const form = new FormData()
    form.set('model', env('STT_MODEL') || 'whisper-1')
    form.set('response_format', 'verbose_json')
    if (opts.language) form.set('language', opts.language)
    form.set('file', new Blob([new Uint8Array(audio)], { type: opts.mime }), 'call.mp3')
    const res = await this.fetchImpl(`${base}/audio/transcriptions`, {
      method: 'POST', headers: { Authorization: `Bearer ${env('STT_API_KEY')}` }, body: form, signal: AbortSignal.timeout(120_000),
    })
    if (!res.ok) throw new Error(`STT respondeu HTTP ${res.status}`)
    const j = await res.json()
    const segs: TranscriptSegment[] = Array.isArray(j.segments)
      ? j.segments.map((s: any) => ({ start: s.start ?? null, end: s.end ?? null, speaker: null, text: String(s.text ?? '').trim() })).filter((s: TranscriptSegment) => s.text)
      : j.text ? [{ start: null, end: null, speaker: null, text: String(j.text) }] : []
    return { segments: segs, language: j.language ?? null }
  }
}

/** STT_PROVIDER: elevenlabs | openai (compatível) | vazio/desconhecido => desativado. */
export function resolveStt(fetchImpl?: FetchLike): SttProvider {
  const p = env('STT_PROVIDER').toLowerCase()
  if (p === 'elevenlabs') return new ElevenLabsStt(fetchImpl)
  if (p === 'openai') return new OpenAiCompatStt(fetchImpl)
  return new DisabledStt(p ? [`STT_PROVIDER (valor "${p.slice(0, 20)}" desconhecido; use elevenlabs ou openai)`] : ['STT_PROVIDER', 'STT_API_KEY'])
}
