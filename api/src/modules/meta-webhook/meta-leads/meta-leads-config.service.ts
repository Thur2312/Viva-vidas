import { Injectable, Logger } from '@nestjs/common'
import * as crypto from 'crypto'
import { PrismaService } from 'src/database/prisma.service'
import { decryptIntegrationData, looksEncrypted } from 'src/shared/util/encryption.utils'
import { MetaLeadsWebhookConfig } from './types/meta-lead.types'

@Injectable()
export class MetaLeadsConfigService {
  private readonly logger = new Logger(MetaLeadsConfigService.name)

  constructor(private readonly prisma: PrismaService) {}

  async getVerifyTokenForSubdomain(subdomain: string): Promise<string | null> {
    const company = await this.prisma.companies.findFirst({
      where: { subdomain, deleted_at: null },
      select: { id: true },
    })

    if (!company) return null

    const integration = await this.prisma.integrations.findFirst({
      where: {
        companiesId: company.id,
        metaLeadsWebhookEnabled: true,
        deleted_at: null,
      },
      select: { metaLeadsVerifyToken: true },
    })

    return integration?.metaLeadsVerifyToken || null
  }

  async getWebhookConfig(companyId: string): Promise<MetaLeadsWebhookConfig | null> {
    const integration = await this.prisma.integrations.findFirst({
      where: {
        companiesId: companyId,
        metaAccessToken: { not: null },
        deleted_at: null,
      },
    })

    if (!integration?.metaAccessToken) return null

    try {
      const decrypted = decryptIntegrationData(integration)

      // decrypt() nao lanca quando a chave nao abre o dado: devolve o ciphertext intacto
      // (compat com linhas antigas em texto puro), entao o catch abaixo nao pega esse caso.
      // Sem o guard, o ciphertext ia para a Graph API como se fosse token.
      if (looksEncrypted(decrypted.metaAccessToken)) {
        this.logger.error(
          `[Meta Leads] Token da company=${companyId} nao decriptou (ENCRYPTION_KEY divergente?) — ` +
            `regrave o token na tela de Integracoes`,
        )
        return null
      }

      return {
        accessToken: decrypted.metaAccessToken,
        verifyToken: integration.metaLeadsVerifyToken || null,
        appSecret: decrypted.metaLeadsAppSecret || null,
      }
    } catch (error) {
      this.logger.error(`[Meta Leads] Error decrypting config for company=${companyId}: ${error.message}`)
      return null
    }
  }

  async getMetaAccessToken(companyId: string): Promise<string | null> {
    const config = await this.getWebhookConfig(companyId)
    return config?.accessToken || null
  }

  validateSignature(rawBody: Buffer, signature256: string, appSecret: string): boolean {
    try {
      const expectedSignature = crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex')
      const receivedSignature = signature256.replace('sha256=', '')
      const expectedBuffer = Buffer.from(expectedSignature, 'hex')
      const receivedBuffer = Buffer.from(receivedSignature, 'hex')
      if (expectedBuffer.length !== receivedBuffer.length) return false
      return crypto.timingSafeEqual(expectedBuffer, receivedBuffer)
    } catch {
      return false
    }
  }
}
