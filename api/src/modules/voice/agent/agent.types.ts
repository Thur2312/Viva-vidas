/**
 * Portas do agente de voz. O núcleo (`VoiceAgentSession`) só conhece estas interfaces; Twilio Media Streams,
 * STT em streaming, Gemini e TTS entram depois como adaptadores. Nada aqui fala com rede.
 */
export type AgentState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'handed_off'

export interface ChatTurn { role: 'lead' | 'agente'; text: string }

/** Gera a resposta em streaming (tokens de texto). Deve respeitar `signal` (barge-in aborta). */
export interface ReplyGenerator {
  stream(input: { history: ChatTurn[]; userText: string; signal: AbortSignal }): AsyncIterable<string>
}

/** Sintetiza uma frase em streaming (blocos de áudio já no formato da linha, ex.: μ-law 8 kHz). */
export interface SpeechSynthesizer {
  stream(text: string, signal: AbortSignal): AsyncIterable<Buffer>
}

/** Saída de áudio para a linha. `clear()` descarta o que ainda não tocou (barge-in). */
export interface AudioOutput {
  play(chunk: Buffer): void
  clear(): void
}

/**
 * Portão de texto ANTES do LLM. Dado sensível (saúde, art. 11) não vai ao modelo: quem decide é o humano.
 * Falha fechado: se o portão lançar erro, o turno é tratado como bloqueado.
 */
export interface TextGate {
  check(text: string): { allowed: boolean; reason?: string }
}

export type HandoffReason = 'sensivel' | 'portao_falhou' | 'nao_entendeu' | 'pedido_do_lead' | 'erro'

export interface AgentConfig {
  /** Pausa de silêncio que fecha o turno; o VAD informa quanto silêncio já passou. */
  maxUnderstandFailures: number
  /** Se o primeiro áudio demorar mais que isso, toca a frase de preenchimento (se houver). */
  fillerAfterMs: number
  /** Frase curta pré-sintetizada (ex.: "um instante"). Opcional. */
  fillerAudio?: Buffer
  /** Pede ao lead para repetir quando não entendeu. Pré-sintetizada, opcional. */
  repeatAudio?: Buffer
  /** Frases que o lead diz para falar com uma pessoa. */
  handoffPhrases: RegExp
}

export const DEFAULT_AGENT_CONFIG: AgentConfig = {
  maxUnderstandFailures: 2,
  fillerAfterMs: 700,
  handoffPhrases: /\b(falar com (uma )?(pessoa|humano|atendente|corretor)|quero (um )?(humano|atendente)|passa pra (uma )?pessoa)\b/i,
}
