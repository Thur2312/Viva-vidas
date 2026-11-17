import { LatencyRecorder } from '../latency/latency-tracker'
import { AudioOutput, ReplyGenerator, SpeechSynthesizer, TextGate } from './agent.types'
import { SentenceChunker } from './sentence-chunker'
import { VoiceAgentSession } from './voice-agent-session'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('SentenceChunker', () => {
  const run = (tokens: string[], opts?: ConstructorParameters<typeof SentenceChunker>[0]) => {
    const c = new SentenceChunker(opts)
    const out: string[] = []
    for (const t of tokens) out.push(...c.push(t))
    const rest = c.flush()
    if (rest) out.push(rest)
    return out
  }

  it('corta em fim de frase e junta tokens quebrados', () => {
    expect(run(['Olá, ', 'tudo ', 'bem? ', 'Posso ', 'ajudar.'])).toEqual(['Olá, tudo bem?', 'Posso ajudar.'])
  })

  it('não corta em abreviação nem em número decimal', () => {
    expect(run(['O Dr. Silva atende às 9.5 horas. ', 'Combinado.'])).toEqual(['O Dr. Silva atende às 9.5 horas.', 'Combinado.'])
    expect(run(['Fale com a Sra. Maria hoje. ', 'Ok.'])).toEqual(['Fale com a Sra. Maria hoje.', 'Ok.'])
  })

  it('a primeira fala sai cedo, numa vírgula, depois de um mínimo de caracteres', () => {
    const c = new SentenceChunker({ minFirstChars: 10 })
    expect(c.push('Claro, posso explicar ')).toEqual([])
    expect(c.push('o plano, com calma ')).toEqual(['Claro, posso explicar o plano,'])
    expect(c.flush()).toBe('com calma')
  })

  it('corte precoce só vale para o primeiro trecho', () => {
    const c = new SentenceChunker({ minFirstChars: 10 })
    const first = c.push('Entendi perfeitamente, vou te explicar ')
    expect(first).toEqual(['Entendi perfeitamente,'])
    expect(c.push('o plano, com calma. ')).toEqual(['vou te explicar o plano, com calma.'])
  })

  it('nenhum trecho passa de maxChars', () => {
    const out = run(['palavra '.repeat(40)], { maxChars: 50 })
    expect(out.every((p) => p.length <= 50)).toBe(true)
    expect(out.join(' ').replace(/\s+/g, ' ').trim()).toBe('palavra '.repeat(40).trim())
  })

  it('flush devolve o resto e nulo quando vazio', () => {
    const c = new SentenceChunker()
    c.push('sem ponto final')
    expect(c.flush()).toBe('sem ponto final')
    expect(c.flush()).toBeNull()
  })
})

function harness(over: { tokens?: string[]; tokenDelay?: number; ttsDelay?: number; gate?: TextGate; config?: any; throwIn?: 'llm' | 'tts' } = {}) {
  const played: string[] = []
  const cleared: number[] = []
  let clock = 0
  const output: AudioOutput = { play: (b) => played.push(b.toString()), clear: () => cleared.push(played.length) }
  const generator: ReplyGenerator = {
    async *stream({ signal }) {
      for (const t of over.tokens ?? ['Olá. ', 'Como posso ajudar?']) {
        if (over.tokenDelay) await sleep(over.tokenDelay)
        if (signal.aborted) return
        if (over.throwIn === 'llm') throw new Error('falha llm')
        yield t
      }
    },
  }
  const synthesizer: SpeechSynthesizer = {
    async *stream(text, signal) {
      if (over.ttsDelay) await sleep(over.ttsDelay)
      if (signal.aborted) return
      if (over.throwIn === 'tts') throw new Error('falha tts')
      yield Buffer.from(`[${text}]`)
    },
  }
  const gate: TextGate = over.gate ?? { check: () => ({ allowed: true }) }
  const handoffs: string[] = []
  const recorder = new LatencyRecorder()
  const session = new VoiceAgentSession({
    generator, synthesizer, output, gate, recorder, config: over.config,
    now: () => (clock += 10),
    onHandoff: (r) => handoffs.push(r),
  })
  return { session, played, cleared, handoffs, recorder }
}

describe('VoiceAgentSession', () => {
  it('fala a resposta por frase e guarda o histórico', async () => {
    const h = harness()
    h.session.speechStart()
    h.session.speechEnd(300)
    await h.session.finalTranscript('Quero saber do plano')
    expect(h.played).toEqual(['[Olá.]', '[Como posso ajudar?]'])
    expect(h.session.history).toEqual([
      { role: 'lead', text: 'Quero saber do plano' },
      { role: 'agente', text: 'Olá. Como posso ajudar?' },
    ])
    expect(h.session.state).toBe('idle')
  })

  it('registra a linha do tempo do turno com a latência percebida', async () => {
    const h = harness()
    h.session.speechStart()
    h.session.speechEnd(250)
    await h.session.finalTranscript('Oi, tudo bem')
    const r = h.recorder.report()
    expect(r.completed).toBe(1)
    expect(r.total!.p50).toBeGreaterThan(250)
    expect(r.stages.endpoint!.p50).toBe(250)
  })

  it('texto sensível não chega ao modelo: passa ao humano', async () => {
    const seen: string[] = []
    const h = harness({ gate: { check: (t) => (seen.push(t), { allowed: false, reason: 'saude' }) } })
    h.session.speechEnd()
    await h.session.finalTranscript('tenho diabetes e faço tratamento')
    expect(h.handoffs).toEqual(['sensivel'])
    expect(h.played).toEqual([])
    expect(h.session.history).toEqual([])
    expect(h.session.state).toBe('handed_off')
  })

  it('portão que lança erro falha fechado', async () => {
    const h = harness({ gate: { check: () => { throw new Error('boom') } } })
    h.session.speechEnd()
    await h.session.finalTranscript('qualquer coisa aqui')
    expect(h.handoffs).toEqual(['portao_falhou'])
    expect(h.played).toEqual([])
  })

  it('pedido explícito de pessoa passa ao humano sem chamar o modelo', async () => {
    const h = harness()
    h.session.speechEnd()
    await h.session.finalTranscript('quero falar com uma pessoa')
    expect(h.handoffs).toEqual(['pedido_do_lead'])
    expect(h.played).toEqual([])
  })

  it('duas falas ininteligíveis seguidas passam ao humano', async () => {
    const h = harness({ config: { repeatAudio: Buffer.from('[repete]') } })
    h.session.speechEnd()
    await h.session.finalTranscript('')
    expect(h.played).toEqual(['[repete]'])
    expect(h.handoffs).toEqual([])
    await h.session.finalTranscript(' ')
    expect(h.handoffs).toEqual(['nao_entendeu'])
  })

  it('barge-in: interrompe, limpa o áudio e não grava no histórico o que não foi dito', async () => {
    const h = harness({ tokens: ['Primeira frase. ', 'Segunda frase. ', 'Terceira frase.'], tokenDelay: 30 })
    h.session.speechEnd()
    const turn = h.session.finalTranscript('me explica o plano')
    await sleep(45)
    h.session.speechStart()
    await turn
    expect(h.cleared.length).toBeGreaterThanOrEqual(1)
    expect(h.played.length).toBeLessThan(3)
    expect(h.session.state).toBe('listening')
    const agent = h.session.history.find((t) => t.role === 'agente')?.text ?? ''
    expect(agent).not.toContain('Terceira')
  })

  it('erro do LLM limpa o áudio e passa ao humano', async () => {
    const h = harness({ throwIn: 'llm' })
    h.session.speechEnd()
    await h.session.finalTranscript('quero contratar o plano')
    expect(h.handoffs).toEqual(['erro'])
    expect(h.cleared.length).toBeGreaterThanOrEqual(1)
  })

  it('erro do TTS também passa ao humano', async () => {
    const h = harness({ throwIn: 'tts' })
    h.session.speechEnd()
    await h.session.finalTranscript('quero contratar o plano')
    expect(h.handoffs).toEqual(['erro'])
  })

  it('toca a frase de preenchimento quando o primeiro áudio demora', async () => {
    const h = harness({ tokenDelay: 80, config: { fillerAudio: Buffer.from('[um instante]'), fillerAfterMs: 20 } })
    h.session.speechEnd()
    await h.session.finalTranscript('qual o valor do plano')
    expect(h.played[0]).toBe('[um instante]')
    expect(h.played.length).toBeGreaterThan(1)
  })

  it('não toca preenchimento se a resposta chega rápido', async () => {
    const h = harness({ config: { fillerAudio: Buffer.from('[um instante]'), fillerAfterMs: 500 } })
    h.session.speechEnd()
    await h.session.finalTranscript('qual o valor do plano')
    expect(h.played).not.toContain('[um instante]')
  })

  it('depois da passagem ao humano ignora qualquer entrada', async () => {
    const h = harness()
    h.session.handoff('pedido_do_lead')
    h.session.handoff('erro')
    h.session.speechStart()
    await h.session.finalTranscript('oi tudo bem')
    expect(h.handoffs).toEqual(['pedido_do_lead'])
    expect(h.played).toEqual([])
    expect(h.session.state).toBe('handed_off')
  })
})
