import { DynamicTts, GeminiTts, GoogleTts, OpenAiTts, resolveTts, ttsProviderId, TtsNotConfiguredError } from './tts'
import { downsample24kTo8k, pcm24kToMulaw8k, stripWavHeader } from '../agent/audio/pcm'
import { ProviderStreamTts, resolveStreamTts } from '../agent/adapters/provider-stream-tts'
import { ElevenLabsStreamTts } from '../agent/adapters/elevenlabs-stream-tts'

const KEYS = ['TTS_PROVIDER', 'GEMINI_API_KEY', 'OPENAI_API_KEY', 'GOOGLE_TTS_API_KEY', 'ELEVENLABS_API_KEY', 'ELEVENLABS_VOICE_ID', 'GEMINI_TTS_VOICE', 'GOOGLE_TTS_VOICE']
const saved: Record<string, string | undefined> = {}
beforeEach(() => { for (const k of KEYS) { saved[k] = process.env[k]; delete process.env[k] } })
afterEach(() => { for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] } })

// 0,3 s de uma onda a 24 kHz (7200 amostras), s16le.
function pcm24k(): Buffer {
  const b = Buffer.alloc(7200 * 2)
  for (let i = 0; i < 7200; i++) b.writeInt16LE(Math.round(8000 * Math.sin((2 * Math.PI * 440 * i) / 24000)), i * 2)
  return b
}
const ok = (body: any, binary = false) => async () => ({ ok: true, json: async () => body, arrayBuffer: async () => (binary ? body : Buffer.from('')) })

describe('áudio', () => {
  it('24 kHz vira 8 kHz (1/3 das amostras) e μ-law (1 byte por amostra)', () => {
    expect(downsample24kTo8k(new Int16Array(300))).toHaveLength(100)
    expect(pcm24kToMulaw8k(pcm24k())).toHaveLength(2400)
  })

  it('tira o cabeçalho WAV e deixa áudio cru como está', () => {
    const dados = Buffer.from([1, 2, 3, 4])
    const wav = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVEfmt '), Buffer.from([16, 0, 0, 0]), Buffer.alloc(16), Buffer.from('data'), Buffer.from([4, 0, 0, 0]), dados])
    expect(stripWavHeader(wav)).toEqual(dados)
    expect(stripWavHeader(dados)).toEqual(dados)
  })
})

describe('escolha do provedor de voz', () => {
  it('padrão é ElevenLabs e valor desconhecido também cai nele', () => {
    expect(ttsProviderId()).toBe('elevenlabs')
    process.env.TTS_PROVIDER = 'qualquer'
    expect(ttsProviderId()).toBe('elevenlabs')
    process.env.TTS_PROVIDER = 'Gemini'
    expect(resolveTts().id).toBe('gemini')
  })

  it('o status mostra só o que falta do provedor escolhido', () => {
    process.env.TTS_PROVIDER = 'google'
    expect(resolveTts().status()).toMatchObject({ provider: 'google', ready: false, missing: ['GOOGLE_TTS_API_KEY'] })
    process.env.TTS_PROVIDER = 'openai'
    process.env.OPENAI_API_KEY = 'sk-teste'
    expect(resolveTts().status()).toMatchObject({ provider: 'openai', ready: true, missing: [] })
  })

  it('DynamicTts acompanha a troca no painel sem reiniciar', () => {
    const d = new DynamicTts()
    expect(d.id).toBe('elevenlabs')
    process.env.TTS_PROVIDER = 'openai'
    expect(d.id).toBe('openai')
  })

  it('sem chave falha fechado e não chama a rede', async () => {
    const f = jest.fn()
    await expect(new GeminiTts(f).synthesize('oi')).rejects.toBeInstanceOf(TtsNotConfiguredError)
    expect(f).not.toHaveBeenCalled()
  })
})

describe('provedores devolvem μ-law 8 kHz', () => {
  it('Gemini: manda a chave no cabeçalho, pede áudio e converte o PCM', async () => {
    process.env.GEMINI_API_KEY = 'g-key'
    const f = jest.fn(ok({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/L16;rate=24000', data: pcm24k().toString('base64') } }] } }] }))
    const r = await new GeminiTts(f).synthesize('Olá, tudo bem?')
    expect(r.mime).toBe('audio/basic')
    expect(r.audio).toHaveLength(2400)
    const [url, init] = f.mock.calls[0] as any
    expect(url).not.toContain('g-key')
    expect(init.headers['x-goog-api-key']).toBe('g-key')
    const body = JSON.parse(init.body)
    expect(body.generationConfig.responseModalities).toEqual(['AUDIO'])
    expect(body.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName).toBe('Kore')
  })

  it('Gemini sem áudio na resposta é erro claro', async () => {
    process.env.GEMINI_API_KEY = 'g'
    await expect(new GeminiTts(jest.fn(ok({ candidates: [] }))).synthesize('oi')).rejects.toThrow('sem áudio')
  })

  it('OpenAI: pede pcm e converte', async () => {
    process.env.OPENAI_API_KEY = 'sk-x'
    const pcm = pcm24k()
    const f = jest.fn(ok(pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.length), true))
    const r = await new OpenAiTts(f).synthesize('Olá')
    expect(r.audio).toHaveLength(2400)
    const [url, init] = f.mock.calls[0] as any
    expect(url).toBe('https://api.openai.com/v1/audio/speech')
    expect(init.headers.authorization).toBe('Bearer sk-x')
    expect(JSON.parse(init.body)).toMatchObject({ response_format: 'pcm', input: 'Olá' })
  })

  it('Google: pede MULAW 8 kHz, voz pt-BR e tira o WAV se vier', async () => {
    process.env.GOOGLE_TTS_API_KEY = 'goog'
    const dados = Buffer.from([0xff, 0x7f, 0x80, 0x00])
    const wav = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVEfmt '), Buffer.from([16, 0, 0, 0]), Buffer.alloc(16), Buffer.from('data'), Buffer.from([4, 0, 0, 0]), dados])
    const f = jest.fn(ok({ audioContent: wav.toString('base64') }))
    const r = await new GoogleTts(f).synthesize('Olá')
    expect(r.audio).toEqual(dados)
    const [url, init] = f.mock.calls[0] as any
    expect(url).toBe('https://texttospeech.googleapis.com/v1/text:synthesize')
    expect(init.headers['x-goog-api-key']).toBe('goog')
    expect(JSON.parse(init.body)).toMatchObject({ voice: { languageCode: 'pt-BR' }, audioConfig: { audioEncoding: 'MULAW', sampleRateHertz: 8000 } })
  })

  it('HTTP de erro não vaza o corpo', async () => {
    process.env.OPENAI_API_KEY = 'k'
    await expect(new OpenAiTts(async () => ({ ok: false, status: 401, text: async () => 'segredo' })).synthesize('oi')).rejects.toThrow('HTTP 401')
  })
})

describe('agente de voz', () => {
  it('ProviderStreamTts entrega blocos de 400 ms e para quando o lead interrompe', async () => {
    const audio = Buffer.alloc(8000, 1)
    const tts = { id: 'x', status: () => ({ provider: 'x', configured: true, ready: true, missing: [] }), synthesize: async () => ({ audio, mime: 'audio/basic' }) }
    const blocos: Buffer[] = []
    for await (const c of new ProviderStreamTts(tts as any).stream('oi', new AbortController().signal)) blocos.push(c)
    expect(blocos.map((b) => b.length)).toEqual([3200, 3200, 1600])

    const ctrl = new AbortController()
    let n = 0
    for await (const _ of new ProviderStreamTts(tts as any).stream('oi', ctrl.signal)) { n++; ctrl.abort() }
    expect(n).toBe(1)
  })

  it('resolveStreamTts usa o streaming nativo só no ElevenLabs', () => {
    expect(resolveStreamTts()).toBeInstanceOf(ElevenLabsStreamTts)
    process.env.TTS_PROVIDER = 'gemini'
    expect(resolveStreamTts()).toBeInstanceOf(ProviderStreamTts)
  })
})
