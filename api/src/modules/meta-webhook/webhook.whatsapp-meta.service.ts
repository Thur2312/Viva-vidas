import { Injectable, Logger, UnauthorizedException } from '@nestjs/common'
import { PrismaService } from 'src/database/prisma.service'
import { decryptIntegrationData } from 'src/shared/util/encryption.utils'
import { WhatsAppMessageDirection, WhatsAppMessageStatus } from '@prisma/client'
import * as crypto from 'crypto'

export interface WhatsAppMetaWebhookPayload {
  object: string
  entry: WhatsAppEntry[]
}

export interface WhatsAppEntry {
  id: string
  changes: WhatsAppChange[]
}

export interface WhatsAppChange {
  value: WhatsAppChangeValue
  field: string
}

export interface WhatsAppChangeValue {
  messaging_product: string
  metadata: {
    display_phone_number: string
    phone_number_id: string
  }
  contacts?: {
    profile: { name: string }
    wa_id: string
  }[]
  messages?: WhatsAppIncomingMessage[]
  statuses?: WhatsAppStatusPayload[]
}

export interface WhatsAppIncomingMessage {
  from: string
  id: string
  timestamp: string
  type: string
  text?: { body: string }
  button?: { payload: string; text: string }
  context?: { from: string; id: string }
}

export interface WhatsAppStatusPayload {
  id: string
  status: string
  timestamp: string
  recipient_id: string
  biz_opaque_callback_data?: string
  pricing?: {
    billable: boolean
    pricing_model: string
    category: string
    type: string
  }
}

@Injectable()
export class WebhookWhatsappMetaService {
  private readonly logger = new Logger(WebhookWhatsappMetaService.name)

  constructor(private prisma: PrismaService) {}

  verifyWebhook(mode: string, token: string, challenge: string, verifyToken: string): string | null {
    if (mode === 'subscribe' && token === verifyToken) {
      this.logger.log('[WhatsApp Meta] Webhook verified successfully')
      return challenge
    }
    this.logger.warn('[WhatsApp Meta] Webhook verification failed')
    return null
  }

  async verifyWebhookWithDb(subdomain: string, mode: string, token: string, challenge: string): Promise<string | null> {
    const dbVerifyToken = await this.getVerifyTokenForSubdomain(subdomain)
    const verifyToken = dbVerifyToken || process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN

    if (!verifyToken) {
      this.logger.warn(`[WhatsApp Meta] No verify token configured for subdomain=${subdomain}`)
      return null
    }

    if (mode === 'subscribe' && token === verifyToken) {
      this.logger.log(`[WhatsApp Meta] Webhook verified successfully for subdomain=${subdomain}`)
      return challenge
    }

    this.logger.warn(`[WhatsApp Meta] Webhook verification failed for subdomain=${subdomain}`)
    return null
  }

  private async getVerifyTokenForSubdomain(subdomain: string): Promise<string | null> {
    const company = await this.prisma.companies.findFirst({
      where: { subdomain, deleted_at: null },
      select: { id: true },
    })

    if (!company) return null

    const integration = await this.prisma.integrations.findFirst({
      where: {
        companiesId: company.id,
        whatsappWebhookEnabled: true,
        deleted_at: null,
      },
      select: { whatsappVerifyToken: true },
    })

    return integration?.whatsappVerifyToken || null
  }

  async processWebhook(
    subdomain: string,
    payload: WhatsAppMetaWebhookPayload,
    signature256?: string,
    rawBody?: Buffer,
  ) {
    if (payload.object !== 'whatsapp_business_account') {
      this.logger.warn(`[WhatsApp Meta] Object type not supported: ${payload.object}`)
      return { success: false, message: 'Object type not supported' }
    }

    const company = await this.prisma.companies.findFirst({
      where: { subdomain, deleted_at: null },
    })

    if (!company) {
      throw new UnauthorizedException('Company not found')
    }

    // Empresa desativada nao recebe mensagem de WhatsApp. Descarte com 200 (a
    // rota ja e @HttpCode(200)) para a Meta nao desabilitar a subscription.
    if (company.status !== 'ACTIVE') {
      this.logger.warn(`[WhatsApp Meta] Empresa inativa, evento descartado subdomain=${subdomain}`)
      return { success: false, message: 'Company inactive' }
    }

    const companyId = company.id

    // Fail-closed quando a empresa configurou `whatsappAppSecret` — mesmo criterio do
    // webhook de Meta Lead Ads. ATE AQUI A ROTA NAO TINHA AUTENTICACAO NENHUMA: o
    // `signature256` era recebido no controller, repassado como parametro e nunca lido,
    // entao qualquer um que soubesse o subdominio conseguia injetar mensagem de WhatsApp.
    // O `validateSignature` existia neste arquivo, mas era codigo morto.
    //
    // Quem ainda NAO tem o segredo salvo continua passando: ligar fail-closed para todo
    // mundo de uma vez cortaria as conversas de quem esta em producao hoje. O segredo ja
    // tem campo proprio (`Integrations.whatsappAppSecret`, criptografado) e e so preencher
    // para a rota fechar.
    const appSecret = await this.getAppSecret(companyId)
    if (appSecret) {
      // `rawBody?.length`, nao `!!rawBody`: Buffer VAZIO e truthy (string vazia nao era).
      // Sem isto, corpo vazio passaria como "tem corpo" e o HMAC seria calculado sobre nada.
      const isValid = !!rawBody?.length && !!signature256 && this.validateSignature(rawBody, signature256, appSecret)
      if (!isValid) {
        this.logger.warn(
          `[WhatsApp Meta] Assinatura ${!rawBody?.length ? 'nao verificavel (corpo cru ausente)' : signature256 ? 'inválida' : 'ausente'} (fail-closed) subdomain=${subdomain}`,
        )
        return { success: false, message: 'Invalid signature' }
      }
    } else if (process.env.WHATSAPP_META_WEBHOOK_SIGNATURE_DISABLED !== 'true') {
      // P-120: sem `whatsappAppSecret` (nao configurado OU decriptacao falhou — getAppSecret
      // nao distingue os dois casos, ver comentario dela), a rota aceitava QUALQUER corpo
      // sem nenhuma verificacao. Kill-switch nasce desligado (fail-closed e o padrao);
      // ligar `=true` restaura o comportamento antigo para quem ainda nao configurou o
      // segredo, sem exigir deploy.
      this.logger.warn(`[WhatsApp Meta] Sem whatsappAppSecret configurado (fail-closed) subdomain=${subdomain}`)
      return { success: false, message: 'Integration not configured' }
    } else {
      this.logger.warn(
        `[WhatsApp Meta] Sem whatsappAppSecret configurado, aceito via WHATSAPP_META_WEBHOOK_SIGNATURE_DISABLED=true subdomain=${subdomain}`,
      )
    }

    for (const entry of payload.entry) {
      for (const change of entry.changes) {
        if (change.field !== 'messages') continue

        const { metadata, messages, statuses, contacts } = change.value

        if (messages && messages.length > 0) {
          await this.processIncomingMessages(messages, contacts, metadata, companyId, entry.id)
        }

        if (statuses && statuses.length > 0) {
          await this.processStatusUpdates(statuses, metadata, companyId, entry.id)
        }
      }
    }

    return { success: true, message: 'Webhook processed' }
  }

  private async processIncomingMessages(
    messages: WhatsAppIncomingMessage[],
    contacts: WhatsAppChangeValue['contacts'],
    metadata: WhatsAppChangeValue['metadata'],
    companyId: string,
    wabaId: string,
  ) {
    for (const message of messages) {
      const contactName = contacts?.find((c) => c.wa_id === message.from)?.profile?.name || ''

      this.logger.log(
        `[WhatsApp Meta] Message received from ${message.from} (${contactName}) - type: ${message.type} - company: ${companyId}`,
      )

      // Deduplicacao pelo wamid
      const existing = await this.prisma.whatsappMessage.findUnique({
        where: { wamid: message.id },
      })

      if (existing) {
        this.logger.warn(`[WhatsApp Meta] Duplicate message ignored: ${message.id}`)
        continue
      }

      await this.prisma.whatsappMessage.create({
        data: {
          companyId,
          wabaId,
          phoneNumberId: metadata.phone_number_id,
          displayPhoneNumber: metadata.display_phone_number,
          wamid: message.id,
          direction: WhatsAppMessageDirection.INBOUND,
          fromNumber: message.from,
          toNumber: metadata.display_phone_number,
          contactName,
          contactWaId: message.from,
          messageType: message.type,
          content: this.extractMessageContent(message),
          rawPayload: message as any,
          contextMessageId: message.context?.id || null,
          contextFrom: message.context?.from || null,
          timestamp: new Date(parseInt(message.timestamp) * 1000),
        },
      })
    }
  }

  private async processStatusUpdates(
    statuses: WhatsAppStatusPayload[],
    metadata: WhatsAppChangeValue['metadata'],
    companyId: string,
    wabaId: string,
  ) {
    for (const statusUpdate of statuses) {
      this.logger.log(
        `[WhatsApp Meta] Status update: ${statusUpdate.status} for message ${statusUpdate.id} - recipient: ${statusUpdate.recipient_id} - company: ${companyId}`,
      )

      const statusEnum = this.mapStatusToEnum(statusUpdate.status)

      await this.prisma.whatsappStatusUpdate.create({
        data: {
          companyId,
          wamid: statusUpdate.id,
          status: statusEnum,
          recipientId: statusUpdate.recipient_id,
          phoneNumberId: metadata.phone_number_id,
          displayPhoneNumber: metadata.display_phone_number,
          wabaId,
          billable: statusUpdate.pricing?.billable ?? false,
          pricingModel: statusUpdate.pricing?.pricing_model || null,
          pricingCategory: statusUpdate.pricing?.category || null,
          pricingType: statusUpdate.pricing?.type || null,
          bizOpaqueCallbackData: statusUpdate.biz_opaque_callback_data || null,
          timestamp: new Date(parseInt(statusUpdate.timestamp) * 1000),
        },
      })

      // Atualizar status na mensagem original (se existir)
      await this.prisma.whatsappMessage.updateMany({
        where: { wamid: statusUpdate.id },
        data: { status: statusEnum },
      })
    }
  }

  private extractMessageContent(message: WhatsAppIncomingMessage): string {
    switch (message.type) {
      case 'text':
        return message.text?.body || ''
      case 'button':
        return message.button?.text || message.button?.payload || ''
      default:
        return `[${message.type}]`
    }
  }

  private mapStatusToEnum(status: string): WhatsAppMessageStatus {
    switch (status.toUpperCase()) {
      case 'SENT':
        return WhatsAppMessageStatus.SENT
      case 'DELIVERED':
        return WhatsAppMessageStatus.DELIVERED
      case 'READ':
        return WhatsAppMessageStatus.READ
      case 'FAILED':
        return WhatsAppMessageStatus.FAILED
      default:
        return WhatsAppMessageStatus.SENT
    }
  }

  /**
   * Le o `whatsappAppSecret` da integracao da empresa. Devolve `null` quando nao ha segredo
   * salvo OU quando a descriptografia falha — nesse caso a rota segue aberta, igual ao que
   * `MetaLeadsConfigService.getWebhookConfig` faz. Fechar por erro de chave transformaria um
   * problema de configuracao em queda de recebimento de mensagem.
   */
  private async getAppSecret(companyId: string): Promise<string | null> {
    try {
      const integration = await this.prisma.integrations.findFirst({
        where: { companiesId: companyId, whatsappAppSecret: { not: null }, deleted_at: null },
      })
      if (!integration?.whatsappAppSecret) return null
      return decryptIntegrationData(integration).whatsappAppSecret || null
    } catch (error) {
      this.logger.error(`[WhatsApp Meta] Falha ao ler appSecret company=${companyId}: ${error?.message ?? error}`)
      return null
    }
  }

  validateSignature(rawBody: Buffer, signature256: string, appSecret: string): boolean {
    // Comparacao em tempo constante: `===` em string vaza, pelo tempo de resposta, quantos
    // caracteres do prefixo o atacante ja acertou. Mesmo formato do
    // MetaLeadsConfigService.validateSignature.
    try {
      const expectedSignature = crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex')
      const receivedSignature = signature256.replace('sha256=', '')
      const expectedBuffer = Buffer.from(expectedSignature, 'hex')
      const receivedBuffer = Buffer.from(receivedSignature, 'hex')
      // timingSafeEqual LANCA se os tamanhos diferem — checar antes.
      if (expectedBuffer.length !== receivedBuffer.length) return false
      return crypto.timingSafeEqual(expectedBuffer, receivedBuffer)
    } catch {
      return false
    }
  }
}
