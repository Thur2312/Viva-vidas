import { Module } from '@nestjs/common'
import { PilotModule } from '../pilot/pilot.module'
import { PgModule } from '../pilot/pg.module'
import { CryptoService } from '../pilot/compliance/crypto.service'
import { DisabledTelephony } from './telephony/disabled.telephony'
import { TwilioTelephony } from './telephony/twilio.adapter'
import { resolveStt } from './providers/stt'
import { resolveTts } from './providers/tts'
import { voiceEnv } from './voice.config'
import { DNC_CHECKER, STT, TELEPHONY, TTS } from './voice.tokens'
import { VoiceController } from './voice.controller'
import { VoiceWebhooksController } from './voice-webhooks.controller'
import { VoiceService } from './voice.service'
import { VoiceSettingsService } from './voice-settings.service'

/**
 * Voz / VoIP. Reaproveita Consent/Audit do PilotModule; usa o PgService compartilhado (PgModule, um único pool)
 * e o CryptoService (sem estado, lê as mesmas chaves PILOT_DATA_KEY*).
 */
@Module({
  imports: [PilotModule, PgModule],
  controllers: [VoiceController, VoiceWebhooksController],
  providers: [
    CryptoService, VoiceService, VoiceSettingsService,
    // Sem credenciais, cada adaptador reporta "não configurado" e falha fechado.
    {
      provide: TELEPHONY,
      useFactory: () => (voiceEnv.telephonyProvider() === 'twilio' ? new TwilioTelephony() : new DisabledTelephony(['VOICE_TELEPHONY_PROVIDER (use "twilio")'], 'disabled')),
    },
    { provide: TTS, useFactory: () => resolveTts() },
    { provide: STT, useFactory: () => resolveStt() },
    // Nenhum verificador de "Não Perturbe" vem pronto: com VOICE_DNC_ENABLED=true toda ligação é recusada até existir um.
    { provide: DNC_CHECKER, useValue: null },
  ],
  exports: [VoiceService],
})
export class VoiceModule {}
