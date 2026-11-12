export const CALL_STATUSES = ['queued', 'ringing', 'in_progress', 'completed', 'busy', 'no_answer', 'failed', 'canceled'] as const
export type CallStatus = (typeof CALL_STATUSES)[number]
export const TERMINAL_STATUSES: readonly CallStatus[] = ['completed', 'busy', 'no_answer', 'failed', 'canceled']

export type TranscriptStatus = 'none' | 'pending' | 'done' | 'failed' | 'disabled'

/** Estado de configuração de um provedor: nunca inclui valores, só NOMES de variáveis ausentes. */
export interface ProviderStatus {
  provider: string
  configured: boolean
  ready: boolean
  missing: string[]
}

export interface TranscriptSegment {
  start: number | null
  end: number | null
  speaker: string | null
  text: string
}
