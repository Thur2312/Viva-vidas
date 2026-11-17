import { LatencyRecorder, TurnTimeline } from '../latency/latency-tracker'
import {
  AgentConfig, AgentState, AudioOutput, ChatTurn, DEFAULT_AGENT_CONFIG, HandoffReason, ReplyGenerator, SpeechSynthesizer, TextGate,
} from './agent.types'
import { SentenceChunker } from './sentence-chunker'

export interface SessionDeps {
  generator: ReplyGenerator
  synthesizer: SpeechSynthesizer
  output: AudioOutput
  /** Sem portão o agente NÃO responde: falha fechado. Passe um portão explícito (mesmo que permissivo, em teste). */
  gate: TextGate
  now?: () => number
  recorder?: LatencyRecorder
  config?: Partial<AgentConfig>
  onHandoff?: (reason: HandoffReason) => void
}

/**
 * Uma ligação do agente de voz, independente do transporte. Quem a alimenta (Media Streams + VAD + STT)
 * chama `speechStart`, `speechEnd` e `finalTranscript`; as respostas saem por `AudioOutput`.
 *
 * Garantias:
 * - barge-in: fala do lead durante a resposta aborta o LLM/TTS e limpa o áudio pendente;
 * - texto passa pelo `TextGate` ANTES do LLM; bloqueado => passagem ao humano, o modelo nunca vê o texto;
 * - o histórico guarda só o que foi de fato enviado para tocar (não o que ficou pendente após barge-in);
 * - cada turno gera uma `TurnTimeline` no `recorder`.
 */
export class VoiceAgentSession {
  state: AgentState = 'idle'
  readonly history: ChatTurn[] = []

  private readonly cfg: AgentConfig
  private readonly now: () => number
  private abort: AbortController | null = null
  private timeline: TurnTimeline | null = null
  private failures = 0
  private turnSeq = 0

  constructor(private readonly deps: SessionDeps) {
    this.cfg = { ...DEFAULT_AGENT_CONFIG, ...(deps.config ?? {}) }
    this.now = deps.now ?? (() => performance.now())
  }

  /** O lead começou a falar. Se o agente falava ou pensava, é barge-in. */
  speechStart(): void {
    if (this.state === 'handed_off') return
    if (this.state === 'speaking' || this.state === 'thinking') this.interrupt()
    this.state = 'listening'
  }

  /** O VAD declarou fim de fala; `silenceMs` é quanto silêncio já se passou desde que o lead parou. */
  speechEnd(silenceMs = 0): void {
    if (this.state === 'handed_off') return
    const t = this.now()
    this.timeline = new TurnTimeline().mark('speech_end', t - Math.max(0, silenceMs)).mark('endpoint', t)
    this.state = 'thinking'
  }

  /** Texto final do STT. Roda o turno inteiro; resolve quando o agente terminou de falar ou foi interrompido. */
  async finalTranscript(text: string): Promise<void> {
    if (this.state === 'handed_off') return
    if (!this.timeline) this.timeline = new TurnTimeline().mark('speech_end', this.now()).mark('endpoint', this.now())
    this.timeline.mark('stt_final', this.now())
    const timeline = this.timeline
    const seq = ++this.turnSeq
    const clean = (text ?? '').replace(/\s+/g, ' ').trim()

    if (clean.length < 2) return this.notUnderstood()
    this.failures = 0

    if (this.cfg.handoffPhrases.test(clean)) return this.handoff('pedido_do_lead')

    let verdict: { allowed: boolean; reason?: string }
    try { verdict = this.deps.gate.check(clean) } catch { return this.handoff('portao_falhou') }
    if (!verdict?.allowed) return this.handoff('sensivel')

    this.history.push({ role: 'lead', text: clean })
    const ac = new AbortController()
    this.abort = ac
    this.state = 'thinking'
    let filler: ReturnType<typeof setTimeout> | null = null
    let started = false
    const startPlayback = () => { if (!started) { started = true; timeline.mark('playback', this.now()) } }

    if (this.cfg.fillerAudio) {
      filler = setTimeout(() => {
        if (!started && !ac.signal.aborted && this.turnSeq === seq) { this.deps.output.play(this.cfg.fillerAudio as Buffer); startPlayback() }
      }, this.cfg.fillerAfterMs)
    }

    const spoken: string[] = []
    try {
      const chunker = new SentenceChunker()
      const speak = async (piece: string) => {
        if (ac.signal.aborted) return
        timeline.mark('first_chunk', this.now())
        for await (const audio of this.deps.synthesizer.stream(piece, ac.signal)) {
          if (ac.signal.aborted) return
          timeline.mark('tts_first_audio', this.now())
          if (this.state !== 'speaking') this.state = 'speaking'
          this.deps.output.play(audio)
          startPlayback()
        }
        if (!ac.signal.aborted) spoken.push(piece)
      }
      for await (const token of this.deps.generator.stream({ history: this.history.slice(0, -1), userText: clean, signal: ac.signal })) {
        if (ac.signal.aborted) break
        timeline.mark('llm_first_token', this.now())
        for (const piece of chunker.push(token)) await speak(piece)
      }
      if (!ac.signal.aborted) { const rest = chunker.flush(); if (rest) await speak(rest) }
    } catch (e) {
      if (!ac.signal.aborted) { this.deps.output.clear(); return this.handoff('erro') }
    } finally {
      if (filler) clearTimeout(filler)
      if (spoken.length) this.history.push({ role: 'agente', text: spoken.join(' ') })
      if (this.turnSeq === seq) {
        this.abort = null
        if (this.isIn('speaking', 'thinking')) this.state = 'idle'
      }
      this.deps.recorder?.add(timeline)
    }
  }

  /** Encerra o agente e chama o humano. Idempotente. */
  handoff(reason: HandoffReason): void {
    if (this.state === 'handed_off') return
    this.abort?.abort()
    this.deps.output.clear()
    this.state = 'handed_off'
    this.deps.onHandoff?.(reason)
  }

  /** Estado atual dentro do conjunto (evita o estreitamento do TS após atribuições no mesmo método). */
  private isIn(...states: AgentState[]): boolean { return states.includes(this.state) }

  private interrupt(): void {
    this.abort?.abort()
    this.abort = null
    this.deps.output.clear()
  }

  private notUnderstood(): void {
    this.failures++
    if (this.failures >= this.cfg.maxUnderstandFailures) return this.handoff('nao_entendeu')
    if (this.cfg.repeatAudio) this.deps.output.play(this.cfg.repeatAudio)
    this.state = 'idle'
  }
}
