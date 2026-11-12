import { ProviderStatus } from '../voice.types'
import { ParsedRecording, ParsedStatus, PlaceCallRequest, PlacedCall, ProviderCallInfo, ProviderNotConfiguredError, TelephonyAdapter } from './telephony.types'

/** Padrão sem chaves: tudo falha fechado e o status diz honestamente "não configurado". */
export class DisabledTelephony implements TelephonyAdapter {
  readonly id: string
  constructor(private readonly missing: string[] = ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_VOICE_NUMBER'], id = 'disabled') {
    this.id = id
  }
  status(): ProviderStatus { return { provider: this.id, configured: false, ready: false, missing: this.missing } }
  private no(): never { throw new ProviderNotConfiguredError(this.missing) }
  async placeCall(_r: PlaceCallRequest): Promise<PlacedCall> { return this.no() }
  async getCall(_s: string): Promise<ProviderCallInfo> { return this.no() }
  async hangup(_s: string): Promise<void> { return this.no() }
  validateWebhook(): boolean { return false }
  parseStatusWebhook(): ParsedStatus | null { return null }
  parseRecordingWebhook(): ParsedRecording | null { return null }
  async fetchRecordingAudio(_r: string): Promise<{ audio: Buffer; mime: string }> { return this.no() }
  async deleteRecording(_r: string): Promise<void> { return this.no() }
  buildBridgeInstructions(): string { return this.no() }
  buildAnnouncementInstructions(): string { return this.no() }
  buildHangupInstructions(): string { return this.no() }
  callerId(): string { return '' }
}
