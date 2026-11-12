import { Body, Controller, Header, HttpCode, Inject, Logger, NotFoundException, Param, Post, Query, Req, ServiceUnavailableException, ForbiddenException, BadRequestException } from '@nestjs/common'
import { Public } from '../auth/public.decorator'
import { NoTenant } from '../auth/no-tenant.decorator'
import { TelephonyAdapter } from './telephony/telephony.types'
import { TELEPHONY } from './voice.tokens'
import { VoiceService } from './voice.service'
import { voiceEnv } from './voice.config'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Webhooks do provedor: públicos (sem JWT), autenticados SÓ pela assinatura. Nunca registram corpo, query
 * ou telefone (o requestLogger global já guarda só método/caminho/status). Respondem 200 mesmo para chamadas
 * desconhecidas (não revelam quais ids existem) e são idempotentes por provider_call_sid + evento.
 */
@Public()
@NoTenant()
@Controller('voice/webhooks')
export class VoiceWebhooksController {
  private readonly log = new Logger(VoiceWebhooksController.name)
  constructor(@Inject(TELEPHONY) private readonly telephony: TelephonyAdapter, private readonly voice: VoiceService) {}

  /** Valida o provedor da rota e a assinatura sobre a URL pública configurada (não sobre o Host recebido). */
  private verify(provider: string, req: any, body: Record<string, any>) {
    if (provider !== this.telephony.id) throw new NotFoundException()
    const base = voiceEnv.webhookBase()
    if (!base) throw new ServiceUnavailableException('VOICE_WEBHOOK_BASE_URL não configurada')
    const params: Record<string, string> = {}
    for (const [k, v] of Object.entries(body ?? {})) if (typeof v === 'string') params[k] = v
    const ok = this.telephony.validateWebhook({ url: base + req.originalUrl, params, signature: req.headers?.['x-twilio-signature'] as string | undefined })
    if (!ok) throw new ForbiddenException('Assinatura inválida')
    return params
  }

  @Post(':provider/status') @HttpCode(200)
  async status(@Param('provider') provider: string, @Req() req: any, @Body() body: Record<string, any>) {
    const params = this.verify(provider, req, body)
    const parsed = this.telephony.parseStatusWebhook(params)
    if (!parsed) throw new BadRequestException('Evento inválido')
    const r = await this.voice.handleStatus(parsed)
    return { ok: true, applied: r.applied }
  }

  @Post(':provider/recording') @HttpCode(200)
  async recording(@Param('provider') provider: string, @Req() req: any, @Body() body: Record<string, any>) {
    const params = this.verify(provider, req, body)
    const parsed = this.telephony.parseRecordingWebhook(params)
    if (!parsed) throw new BadRequestException('Evento inválido')
    const r = await this.voice.handleRecording(parsed)
    if (r.transcribe && r.callId) {
      const id = r.callId
      // Fora do ciclo do request: o provedor não deve esperar o STT. Falhas ficam no status da ligação.
      setImmediate(() => { this.voice.transcribe(id).catch(() => this.log.error('Transcrição falhou')) })
    }
    return { ok: true, stored: r.stored }
  }

  /** Perna do operador atendeu: devolve as instruções (aviso -> ponte -> gravação). */
  @Post(':provider/bridge') @HttpCode(200) @Header('Content-Type', 'text/xml; charset=utf-8')
  async bridge(@Param('provider') provider: string, @Query('callId') callId: string, @Req() req: any, @Body() body: Record<string, any>) {
    this.verify(provider, req, body)
    if (!UUID.test(callId ?? '')) throw new BadRequestException('callId inválido')
    return this.voice.bridgeInstructions(callId)
  }

  /** Perna do lead atendeu: toca o aviso de gravação e o registra como entregue. */
  @Post(':provider/announce') @HttpCode(200) @Header('Content-Type', 'text/xml; charset=utf-8')
  async announce(@Param('provider') provider: string, @Query('callId') callId: string, @Req() req: any, @Body() body: Record<string, any>) {
    this.verify(provider, req, body)
    if (!UUID.test(callId ?? '')) throw new BadRequestException('callId inválido')
    return this.voice.announceInstructions(callId)
  }
}
