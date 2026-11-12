import { DisabledStt, ElevenLabsStt, OpenAiCompatStt, resolveStt, SttNotConfiguredError, wordsToSegments } from './stt'
import { DisabledTts, ElevenLabsTts, TtsNotConfiguredError } from './tts'

describe('STT / TTS (sem rede)', () => {
  const saved = { ...process.env }
  afterEach(() => { process.env = { ...saved } })

  it('sem STT_PROVIDER o padrão é Disabled e falha fechado, listando nomes de variáveis', async () => {
    delete process.env.STT_PROVIDER
    const s = resolveStt()
    expect(s).toBeInstanceOf(DisabledStt)
    expect(s.status()).toMatchObject({ configured: false, ready: false, missing: ['STT_PROVIDER', 'STT_API_KEY'] })
    await expect(s.transcribe(Buffer.from('x'), { mime: 'audio/mpeg' })).rejects.toBeInstanceOf(SttNotConfiguredError)
  })

  it('STT_PROVIDER desconhecido não liga nada', () => {
    process.env.STT_PROVIDER = 'inventado'
    expect(resolveStt().status().ready).toBe(false)
  })

  it('seleciona adaptador por STT_PROVIDER e exige STT_API_KEY', () => {
    process.env.STT_PROVIDER = 'openai'; delete process.env.STT_API_KEY
    expect(resolveStt()).toBeInstanceOf(OpenAiCompatStt)
    expect(resolveStt().status()).toMatchObject({ configured: false, missing: ['STT_API_KEY'] })
    process.env.STT_API_KEY = 'k'
    expect(resolveStt().status().ready).toBe(true)
    process.env.STT_PROVIDER = 'elevenlabs'; delete process.env.STT_API_KEY; delete process.env.ELEVENLABS_API_KEY
    expect(resolveStt()).toBeInstanceOf(ElevenLabsStt)
    expect(resolveStt().status().ready).toBe(false)
    process.env.ELEVENLABS_API_KEY = 'k'
    expect(resolveStt().status().ready).toBe(true) // fallback documentado
  })

  it('agrupa palavras por falante (Scribe)', () => {
    const segs = wordsToSegments([
      { text: 'Olá', start: 0, end: 0.4, type: 'word', speaker_id: 'speaker_0' },
      { text: ' ', start: 0.4, end: 0.5, type: 'spacing', speaker_id: 'speaker_0' },
      { text: 'tudo', start: 0.5, end: 0.9, type: 'word', speaker_id: 'speaker_0' },
      { text: 'Bem', start: 1.2, end: 1.5, type: 'word', speaker_id: 'speaker_1' },
    ])
    expect(segs).toEqual([
      { start: 0, end: 0.9, speaker: 'speaker_0', text: 'Olá tudo' },
      { start: 1.2, end: 1.5, speaker: 'speaker_1', text: 'Bem' },
    ])
  })

  it('transcreve com fetch falso e usa a chave só no cabeçalho', async () => {
    process.env.STT_PROVIDER = 'openai'; process.env.STT_API_KEY = 'chave-x'
    let seen: any
    const s = new OpenAiCompatStt(async (url, init) => { seen = { url, init }; return { ok: true, json: async () => ({ language: 'pt', segments: [{ start: 0, end: 1, text: ' oi ' }] }) } })
    const r = await s.transcribe(Buffer.from('a'), { mime: 'audio/mpeg', language: 'pt' })
    expect(r.segments).toEqual([{ start: 0, end: 1, speaker: null, text: 'oi' }])
    expect(seen.url).toBe('https://api.openai.com/v1/audio/transcriptions')
    expect(seen.init.headers.Authorization).toBe('Bearer chave-x')
  })

  it('TTS: Disabled e ElevenLabs sem chave falham fechado; com chave monta o POST', async () => {
    await expect(new DisabledTts().synthesize()).rejects.toBeInstanceOf(TtsNotConfiguredError)
    delete process.env.ELEVENLABS_API_KEY; delete process.env.ELEVENLABS_VOICE_ID
    const t = new ElevenLabsTts(async () => { throw new Error('nao deveria chamar') })
    expect(t.status().missing).toEqual(['ELEVENLABS_API_KEY', 'ELEVENLABS_VOICE_ID'])
    await expect(t.synthesize('oi')).rejects.toBeInstanceOf(TtsNotConfiguredError)
    process.env.ELEVENLABS_API_KEY = 'k'; process.env.ELEVENLABS_VOICE_ID = 'voz/1'
    let seen: any
    const ok = new ElevenLabsTts(async (url, init) => { seen = { url, init }; return { ok: true, arrayBuffer: async () => new Uint8Array([1, 2]).buffer } })
    const out = await ok.synthesize('Olá')
    expect(out.audio.length).toBe(2)
    expect(seen.url).toContain('/v1/text-to-speech/voz%2F1?output_format=mp3_44100_128')
    expect(seen.init.headers['xi-api-key']).toBe('k')
  })
})
