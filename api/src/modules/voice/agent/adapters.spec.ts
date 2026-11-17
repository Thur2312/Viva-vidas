import { ElevenLabsStreamTts, StreamTtsNotConfiguredError } from './adapters/elevenlabs-stream-tts'
import { GeminiNotConfiguredError, GeminiReplyGenerator } from './adapters/gemini-reply-generator'
import { SensitiveTextGate } from './adapters/sensitive-text-gate'
import { sseData } from './adapters/stream-utils'
import { TwilioAudioOutput, parseTwilioMessage } from './adapters/twilio-media-stream'
import { mulawDecodeByte, mulawEncodeSample, mulawToWav, pcm16ToMulaw } from './audio/mulaw'
import { EnergyVad, frameRms, silenceForPartial } from './audio/vad'
import { SttProvider } from '../providers/stt'
import { VoiceAgentSession } from './voice-agent-session'
import { VoiceStreamBridge } from './voice-stream-bridge'

const enc = (s: string) => new TextEncoder().encode(s)
async function collect<T>(it: AsyncIterable<T>): Promise<T[]> { const out: T[] = []; for await (const x of it) out.push(x); return out }
async function* chunks(parts: string[]) { for (const p of parts) yield enc(p) }
const withEnv = async (vars: Record<string, string | undefined>, fn: () => Promise<void> | void) => {
  const old: Record<string, string | undefined> = {}
  for (const k of Object.keys(vars)) { old[k] = process.env[k]; if (vars[k] === undefined) delete process.env[k]; else process.env[k] = vars[k] }
  try { await fn() } finally { for (const k of Object.keys(old)) { if (old[k] === undefined) delete process.env[k]; else process.env[k] = old[k] } }
}

describe('μ-law', () => {
  it('ida e volta mantém o sinal dentro do erro de quantização', () => {
    for (const s of [0, 100, -100, 1000, -1000, 8000, -8000, 30000]) {
      const back = mulawDecodeByte(mulawEncodeSample(s))
      expect(Math.abs(back - s)).toBeLessThanOrEqual(Math.max(40, Math.abs(s) * 0.07))
    }
  })
  it('silêncio é 0xFF e decodifica para 0', () => {
    expect(mulawEncodeSample(0)).toBe(0xff)
    expect(mulawDecodeByte(0xff)).toBe(0)
  })
  it('WAV tem cabeçalho RIFF/PCM 8 kHz e tamanho certo', () => {
    const wav = mulawToWav(Buffer.alloc(160, 0xff))
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF')
    expect(wav.toString('ascii', 8, 12)).toBe('WAVE')
    expect(wav.readUInt32LE(24)).toBe(8000)
    expect(wav.length).toBe(44 + 320)
  })
})

const speech = (frames: number) => pcm16ToMulaw(Int16Array.from({ length: 160 * frames }, (_, i) => Math.round(Math.sin(i / 4) * 5000)))
const silence = (frames: number) => Buffer.alloc(160 * frames, 0xff)

describe('EnergyVad', () => {
  it('RMS de silêncio é ~0 e de fala é alto', () => {
    expect(frameRms(silence(1))).toBe(0)
    expect(frameRms(speech(1))).toBeGreaterThan(1000)
  })
  it('detecta início de fala só após quadros consecutivos e fim após o silêncio configurado', () => {
    const ev: string[] = []
    const vad = new EnergyVad({ onSpeechStart: () => ev.push('start'), onSpeechEnd: (ms, v) => ev.push(`end:${ms}:${v}`) }, { silenceMs: 100 })
    vad.push(speech(2)); expect(ev).toEqual([])
    vad.push(speech(2)); expect(ev).toEqual(['start'])
    vad.push(silence(4)); expect(ev).toEqual(['start'])
    vad.push(silence(1)); expect(ev).toEqual(['start', 'end:100:80'])
  })
  it('estalo curto não vira fala', () => {
    const ev: string[] = []
    const vad = new EnergyVad({ onSpeechStart: () => ev.push('start'), onSpeechEnd: () => ev.push('end') })
    vad.push(speech(1)); vad.push(silence(10))
    expect(ev).toEqual([])
  })
  it('aceita áudio em pedaços que não alinham com o quadro', () => {
    const ev: string[] = []
    const vad = new EnergyVad({ onSpeechStart: () => ev.push('start'), onSpeechEnd: () => ev.push('end') })
    const s = speech(5)
    vad.push(s.subarray(0, 77)); vad.push(s.subarray(77))
    expect(ev).toEqual(['start'])
  })
  it('silêncio exigido encurta com frase completa e alonga com frase aberta', () => {
    expect(silenceForPartial('Quero o plano.')).toBeLessThan(silenceForPartial(null))
    expect(silenceForPartial('Quero o plano e')).toBeGreaterThan(silenceForPartial(null))
  })
})

describe('sseData', () => {
  it('junta eventos partidos entre blocos', async () => {
    const out = await collect(sseData(chunks(['data: {"a":1}\n\ndata: {"b"', ':2}\n\n', 'data: {"c":3}'])))
    expect(out).toEqual(['{"a":1}', '{"b":2}', '{"c":3}'])
  })
})

describe('GeminiReplyGenerator', () => {
  const body = (texts: string[]) => chunks(texts.map((t) => `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: t }] } }] })}\n\n`))

  it('sem chave falha fechado', async () => {
    await withEnv({ GEMINI_API_KEY: undefined }, async () => {
      const g = new GeminiReplyGenerator(jest.fn())
      await expect(collect(g.stream({ history: [], userText: 'oi', signal: new AbortController().signal }))).rejects.toBeInstanceOf(GeminiNotConfiguredError)
    })
  })

  it('envia chave no cabeçalho, histórico, sem pensar (2.5) e devolve os tokens em ordem', async () => {
    await withEnv({ GEMINI_API_KEY: 'k-teste', PILOT_MODEL: 'gemini-2.5-flash', VOICE_LLM_MODEL: undefined }, async () => {
      const fetchImpl = jest.fn().mockResolvedValue({ ok: true, body: body(['Olá, ', 'tudo bem?']) })
      const g = new GeminiReplyGenerator(fetchImpl)
      const out = await collect(g.stream({ history: [{ role: 'lead', text: 'oi' }, { role: 'agente', text: 'olá' }], userText: 'quero um plano', signal: new AbortController().signal }))
      expect(out).toEqual(['Olá, ', 'tudo bem?'])
      const [url, init] = fetchImpl.mock.calls[0]
      expect(url).toContain('gemini-2.5-flash:streamGenerateContent?alt=sse')
      expect(url).not.toContain('k-teste')
      expect(init.headers['x-goog-api-key']).toBe('k-teste')
      const sent = JSON.parse(init.body)
      expect(sent.contents.map((c: any) => c.role)).toEqual(['user', 'model', 'user'])
      expect(sent.generationConfig.thinkingConfig).toEqual({ thinkingBudget: 0 })
    })
  })

  it('modelo fora da família 2.5 não recebe thinkingConfig', async () => {
    await withEnv({ GEMINI_API_KEY: 'k', PILOT_MODEL: 'gemini-3.1-flash-lite', VOICE_LLM_MODEL: undefined }, async () => {
      const fetchImpl = jest.fn().mockResolvedValue({ ok: true, body: body(['ok']) })
      await collect(new GeminiReplyGenerator(fetchImpl).stream({ history: [], userText: 'oi', signal: new AbortController().signal }))
      expect(JSON.parse(fetchImpl.mock.calls[0][1].body).generationConfig.thinkingConfig).toBeUndefined()
    })
  })

  it('erro HTTP não repete o corpo da resposta', async () => {
    await withEnv({ GEMINI_API_KEY: 'k' }, async () => {
      const fetchImpl = jest.fn().mockResolvedValue({ ok: false, status: 429, text: async () => 'texto do cliente' })
      const p = collect(new GeminiReplyGenerator(fetchImpl).stream({ history: [], userText: 'oi', signal: new AbortController().signal }))
      await expect(p).rejects.toThrow('HTTP 429')
      await expect(p).rejects.not.toThrow(/texto do cliente/)
    })
  })

  it('para de emitir quando abortado', async () => {
    await withEnv({ GEMINI_API_KEY: 'k' }, async () => {
      const ac = new AbortController()
      const fetchImpl = jest.fn().mockResolvedValue({ ok: true, body: body(['a', 'b', 'c']) })
      const out: string[] = []
      for await (const t of new GeminiReplyGenerator(fetchImpl).stream({ history: [], userText: 'oi', signal: ac.signal })) { out.push(t); ac.abort() }
      expect(out).toEqual(['a'])
    })
  })
})

describe('ElevenLabsStreamTts', () => {
  it('sem chave falha fechado, listando só nomes', async () => {
    await withEnv({ ELEVENLABS_API_KEY: undefined, ELEVENLABS_VOICE_ID: undefined }, async () => {
      await expect(collect(new ElevenLabsStreamTts(jest.fn()).stream('oi', new AbortController().signal))).rejects.toBeInstanceOf(StreamTtsNotConfiguredError)
    })
  })

  it('pede ulaw_8000 no modelo rápido e repassa os blocos de áudio', async () => {
    await withEnv({ ELEVENLABS_API_KEY: 'k-el', ELEVENLABS_VOICE_ID: 'voz1', ELEVENLABS_MODEL_ID: undefined }, async () => {
      const fetchImpl = jest.fn().mockResolvedValue({ ok: true, body: chunks(['AAAA', 'BBBB']) })
      const out = await collect(new ElevenLabsStreamTts(fetchImpl).stream('Olá.', new AbortController().signal))
      expect(out.map((b) => b.toString())).toEqual(['AAAA', 'BBBB'])
      const [url, init] = fetchImpl.mock.calls[0]
      expect(url).toContain('/voz1/stream?output_format=ulaw_8000')
      expect(JSON.parse(init.body).model_id).toBe('eleven_flash_v2_5')
      expect(init.headers['xi-api-key']).toBe('k-el')
    })
  })
})

describe('Twilio Media Streams', () => {
  it('interpreta start, media, mark e stop; ignora lixo', () => {
    expect(parseTwilioMessage(JSON.stringify({ event: 'start', start: { streamSid: 'MZ1', callSid: 'CA1', customParameters: { callId: '7' } } })))
      .toEqual({ type: 'start', streamSid: 'MZ1', callSid: 'CA1', customParameters: { callId: '7' } })
    const m = parseTwilioMessage(JSON.stringify({ event: 'media', media: { track: 'inbound', payload: Buffer.from('abc').toString('base64') } }))
    expect(m).toMatchObject({ type: 'media', track: 'inbound' })
    expect((m as any).payload.toString()).toBe('abc')
    expect(parseTwilioMessage('{"event":"stop"}')).toEqual({ type: 'stop' })
    expect(parseTwilioMessage('não é json')).toBeNull()
    expect(parseTwilioMessage(JSON.stringify({ event: 'media', media: {} }))).toBeNull()
  })

  it('saída envia media em blocos e clear para barge-in', () => {
    const sent: any[] = []
    const out = new TwilioAudioOutput('MZ1', (j) => sent.push(JSON.parse(j)), 4)
    out.play(Buffer.from('12345678'))
    out.clear()
    expect(sent.map((s) => s.event)).toEqual(['media', 'media', 'clear'])
    expect(Buffer.from(sent[0].media.payload, 'base64').toString()).toBe('1234')
    expect(sent.every((s) => s.streamSid === 'MZ1')).toBe(true)
  })
})

describe('SensitiveTextGate', () => {
  it('bloqueia saúde e libera conversa comum', () => {
    const g = new SensitiveTextGate()
    expect(g.check('tenho diabetes e uso insulina').allowed).toBe(false)
    expect(g.check('quero saber o valor do plano para a minha família').allowed).toBe(true)
  })
})

describe('VoiceStreamBridge (áudio → VAD → STT → agente)', () => {
  function build(sttText: string | Error) {
    const played: string[] = []
    const handoffs: string[] = []
    const stt: SttProvider = {
      id: 'fake', status: () => ({ provider: 'fake', configured: true, ready: true, missing: [] }),
      transcribe: jest.fn(async () => { if (sttText instanceof Error) throw sttText; return { language: 'pt', segments: [{ start: 0, end: 1, speaker: null, text: sttText }] } }),
    }
    const session = new VoiceAgentSession({
      generator: { async *stream() { yield 'Claro. ' } },
      synthesizer: { async *stream(t) { yield Buffer.from(`[${t}]`) } },
      output: { play: (b) => played.push(b.toString()), clear: () => undefined },
      gate: new SensitiveTextGate(),
      onHandoff: (r) => handoffs.push(r),
    })
    const bridge = new VoiceStreamBridge({ session, stt, vad: { silenceMs: 100 } })
    return { bridge, session, stt, played, handoffs }
  }
  const settle = () => new Promise((r) => setTimeout(r, 20))
  const talk = (b: VoiceStreamBridge) => { b.onMedia(speech(15)); b.onMedia(silence(6)) }

  it('uma fala vira uma resposta falada', async () => {
    const h = build('quero o valor do plano')
    talk(h.bridge)
    await settle()
    expect(h.stt.transcribe).toHaveBeenCalledTimes(1)
    expect((h.stt.transcribe as jest.Mock).mock.calls[0][0].toString('ascii', 0, 4)).toBe('RIFF')
    expect(h.played).toEqual(['[Claro.]'])
  })

  it('fala sobre saúde não chega ao modelo: passa ao humano', async () => {
    const h = build('eu tenho diabetes')
    talk(h.bridge)
    await settle()
    expect(h.handoffs).toEqual(['sensivel'])
    expect(h.played).toEqual([])
  })

  it('falha do STT passa ao humano', async () => {
    const h = build(new Error('stt fora'))
    talk(h.bridge)
    await settle()
    expect(h.handoffs).toEqual(['erro'])
  })

  it('ruído curto não chama o STT', async () => {
    const h = build('x')
    h.bridge.onMedia(speech(3)); h.bridge.onMedia(silence(10))
    await settle()
    expect(h.stt.transcribe).not.toHaveBeenCalled()
  })

  it('entende as mensagens do Twilio (start, media inbound, stop)', async () => {
    const h = build('quero o valor do plano')
    const msg = (o: any) => h.bridge.handleTwilioMessage(JSON.stringify(o))
    msg({ event: 'start', start: { streamSid: 'MZ9', callSid: 'CA9' } })
    for (const f of [speech(15), silence(6)]) {
      for (let i = 0; i < f.length; i += 160) msg({ event: 'media', media: { track: 'inbound', payload: f.subarray(i, i + 160).toString('base64') } })
    }
    msg({ event: 'media', media: { track: 'outbound', payload: speech(2).toString('base64') } })
    await settle()
    expect(h.bridge.streamSid).toBe('MZ9')
    expect(h.played).toEqual(['[Claro.]'])
    msg({ event: 'stop' })
  })
})
