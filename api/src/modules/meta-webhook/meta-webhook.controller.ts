import { Controller, Post, Body, Req, Get, Param, Headers, Query, HttpCode, ForbiddenException } from '@nestjs/common'
import { Public } from 'src/modules/auth/public.decorator'
import { SkipThrottle } from '@nestjs/throttler'
import { SkipLogging } from 'src/shared/decorators/skip-logging.decorator'
import { Request } from 'express'
import { WebhookWhatsappMetaService, WhatsAppMetaWebhookPayload } from './webhook.whatsapp-meta.service'
import { WebhookMetaLeadsService } from './meta-leads/webhook-meta-leads.service'
import { MetaLeadWebhookPayload } from './meta-leads/types/meta-lead.types'

/**
 * ATENCAO — @SkipLogging e obrigatorio aqui, nao e otimizacao.
 *
 * O LoggingInterceptor grava `${method} ${url}` na tabela `Logs` a cada request. A rota
 * `POST /api/meta-leads/campaign/:token` carrega o TOKEN NO PATH, entao sem isto a
 * credencial da campanha fica em claro no banco, para sempre.
 *
 * O interceptor ja excluia `WebhookController` por uma lista de NOMES
 * (`logger.interceptor.ts`), e foi exatamente assim que o buraco nasceu: este controller foi
 * criado depois e ninguem atualizou a lista. O decorator viaja junto com a classe e sobrevive
 * a rename — por isso a correcao e aqui, e nao la. Mesmo molde do `/telecom/webhook`.
 */
@SkipLogging()
@Public()
@SkipThrottle()
@Controller('api')
export class MetaWebhookController {
  constructor(
    private readonly webhookWhatsappMetaService: WebhookWhatsappMetaService,
    private readonly webhookMetaLeadsService: WebhookMetaLeadsService,
  ) {}

  // ===== WhatsApp Meta Webhook =====

  @Get('whatsapp-meta/:subdomain')
  async whatsappMetaVerify(
    @Param('subdomain') subdomain: string,
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
  ) {
    const result = await this.webhookWhatsappMetaService.verifyWebhookWithDb(subdomain, mode, token, challenge)
    if (result === null) {
      throw new ForbiddenException('Webhook verification failed')
    }
    return result
  }

  @Post('whatsapp-meta/:subdomain')
  @HttpCode(200)
  async whatsappMetaWebhook(
    @Param('subdomain') subdomain: string,
    @Headers('x-hub-signature-256') signature256: string,
    @Body() payload: WhatsAppMetaWebhookPayload,
    @Req() req: Request,
  ) {
    // O `signature256` ja era recebido aqui, mas nunca chegava ao service — a rota
    // processava qualquer corpo de quem soubesse o subdominio. Passar o rawBody junto e o
    // que torna a verificacao possivel.
    const rawBody = (req as any).rawBody as Buffer | undefined
    return this.webhookWhatsappMetaService.processWebhook(subdomain, payload, signature256, rawBody)
  }

  // ===== Meta Lead Ads Webhook — Por Campaign (rotas especificas ANTES da generica) =====

  @Get('meta-leads/campaign/:token')
  async metaLeadsCampaignVerify(
    @Param('token') campaignToken: string,
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
  ) {
    const result = await this.webhookMetaLeadsService.verifyWebhookByCampaign(campaignToken, mode, token, challenge)
    if (result === null) {
      throw new ForbiddenException('Webhook verification failed')
    }
    return result
  }

  @Post('meta-leads/campaign/:token')
  @HttpCode(200)
  async metaLeadsCampaignWebhook(
    @Param('token') campaignToken: string,
    @Headers('x-hub-signature-256') signature256: string,
    @Body() payload: MetaLeadWebhookPayload,
    @Req() req: Request,
  ) {
    // `rawBody` vem do `verify` do body-parser em main.ts (prefixo `/api/meta-leads`).
    // NAO ha fallback para `JSON.stringify(payload)`: a Meta assina os BYTES que enviou, e
    // re-serializar o objeto ja parseado nao os reproduz (um acento que veio escapado como
    // \uXXXX volta como caractere literal, e a assinatura passa a nunca bater). Com o
    // fallback, a validacao ora passava por acaso ora derrubava lead legitimo em silencio.
    // Sem rawBody o service trata como assinatura ausente — que so bloqueia quem configurou
    // appSecret, e ai bloquear e o comportamento certo.
    const rawBody = (req as any).rawBody as Buffer | undefined
    return this.webhookMetaLeadsService.ingestWebhookByCampaign(campaignToken, payload, rawBody, signature256)
  }

  // ===== Meta Lead Ads Webhook — Por Subdomain (empresa) =====

  @Get('meta-leads/:subdomain')
  async metaLeadsVerify(
    @Param('subdomain') subdomain: string,
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
  ) {
    const result = await this.webhookMetaLeadsService.verifyWebhook(subdomain, mode, token, challenge)
    if (result === null) {
      throw new ForbiddenException('Webhook verification failed')
    }
    return result
  }

  @Post('meta-leads/:subdomain')
  @HttpCode(200)
  async metaLeadsWebhook(
    @Param('subdomain') subdomain: string,
    @Headers('x-hub-signature-256') signature256: string,
    @Body() payload: MetaLeadWebhookPayload,
    @Req() req: Request,
  ) {
    const rawBody = (req as any).rawBody as Buffer | undefined
    return this.webhookMetaLeadsService.ingestWebhook(subdomain, payload, rawBody, signature256)
  }

}
