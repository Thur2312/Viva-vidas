import { CallStatus, ProviderStatus } from '../voice.types'

export interface PlaceCallRequest {
  /** id interno da ligação (voice_calls.id), devolvido nos webhooks via URL. */
  callId: string
  /** Telefone do operador (E.164): a perna 1 toca primeiro. */
  operatorPhone: string
  /** Telefone do lead (E.164): a perna 2, ligada quando o operador atende. */
  leadPhone: string
  /** URL pública que o provedor chama quando o operador atende (instruções: aviso + ponte + gravação). */
  instructionsUrl: string
  /** URL pública dos eventos de status. */
  statusUrl: string
}

export interface PlacedCall { providerCallSid: string; status: CallStatus }
export interface ProviderCallInfo { providerCallSid: string; status: CallStatus; durationSec: number | null; priceCents: number | null }

export interface WebhookRequest {
  /** URL EXATA que o provedor chamou (base pública + caminho + query). */
  url: string
  params: Record<string, string>
  signature: string | undefined
}

export interface ParsedStatus {
  providerCallSid: string
  status: CallStatus
  durationSec: number | null
  /** Chave de idempotência do evento (o provedor reenvia). */
  eventKey: string
}

export interface ParsedRecording {
  providerCallSid: string
  /** Referência opaca da gravação no provedor (vai criptografada para o banco). */
  recordingRef: string
  status: 'completed' | 'in_progress' | 'failed' | 'absent'
  durationSec: number | null
  eventKey: string
}

export interface BridgeInstructionsInput {
  leadPhone: string
  callerId: string
  recordingCallbackUrl: string
  announceUrl: string
  record: boolean
}

export interface TelephonyAdapter {
  readonly id: string
  status(): ProviderStatus
  placeCall(req: PlaceCallRequest): Promise<PlacedCall>
  getCall(providerCallSid: string): Promise<ProviderCallInfo>
  hangup(providerCallSid: string): Promise<void>
  /** Assinatura do webhook, em tempo constante. Sem credencial configurada => false (fail closed). */
  validateWebhook(req: WebhookRequest): boolean
  parseStatusWebhook(params: Record<string, string>): ParsedStatus | null
  parseRecordingWebhook(params: Record<string, string>): ParsedRecording | null
  /** Baixa o áudio de forma transitória (para STT). Nunca persiste. */
  fetchRecordingAudio(recordingRef: string): Promise<{ audio: Buffer; mime: string }>
  /** Apaga a gravação no provedor (retenção / eliminação). Idempotente: 404 conta como apagada. */
  deleteRecording(recordingRef: string): Promise<void>
  /** Resposta de instruções (TwiML, no caso do Twilio) quando o operador atende. */
  buildBridgeInstructions(i: BridgeInstructionsInput): string
  /** Instruções tocadas ao LEAD antes da ponte: o aviso de gravação. */
  buildAnnouncementInstructions(text: string): string
  /** Instruções que encerram a perna (falha fechado quando o aviso não pode ser entregue). */
  buildHangupInstructions(): string
  /** Número de origem (caller ID) configurado. */
  callerId(): string
}

export class ProviderNotConfiguredError extends Error {
  constructor(public readonly missing: string[]) {
    super(`Provedor de telefonia não configurado: ${missing.join(', ')}`)
  }
}
export class ProviderError extends Error {
  constructor(message: string, public readonly httpStatus?: number) { super(message) }
}
