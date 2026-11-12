import { TelephonyAdapter } from './telephony/telephony.types'
import { SttProvider } from './providers/stt'
import { TtsProvider } from './providers/tts'

export const TELEPHONY = Symbol('VOICE_TELEPHONY')
export const TTS = Symbol('VOICE_TTS')
export const STT = Symbol('VOICE_STT')
export const DNC_CHECKER = Symbol('VOICE_DNC_CHECKER')

/**
 * Verificador de "Não Perturbe" plugável (lista própria, cadastro externo, etc.).
 * Nenhum vem implementado: com VOICE_DNC_ENABLED=true e sem verificador, toda ligação é recusada.
 */
export interface DncChecker {
  isConfigured(): boolean
  /** true = número bloqueado. Qualquer erro deve ser lançado (a ligação é recusada). */
  isBlocked(phoneE164: string): Promise<boolean>
}

export type { TelephonyAdapter, SttProvider, TtsProvider }
