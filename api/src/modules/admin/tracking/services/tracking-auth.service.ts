import { Injectable } from '@nestjs/common'
import { PrismaService } from 'src/database/prisma.service'
import { RedisService } from 'src/shared/redis/redis.service'
import { decrypt } from 'src/shared/util/encryption.utils'

@Injectable()
export class TrackingAuthService {
  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
  ) {}

  /**
   * Verifica se já existe um tracking OPTIN para o mesmo email+companyId
   * nos últimos N segundos. Evita duplicação quando múltiplos scripts
   * de captura disparam no mesmo submit de formulário.
   */
  async hasRecentOptin(
    email: string,
    companyId: string,
    windowSeconds = 10,
  ): Promise<boolean> {
    if (!email || !companyId) return false

    const cutoff = new Date(Date.now() - windowSeconds * 1000)

    const existing = await this.prisma.tracking.findFirst({
      where: {
        email,
        companyId,
        action: { in: ['OPTIN', 'optin'] },
        timestamp: { gte: cutoff },
      },
      select: { id: true },
    })

    return !!existing
  }

  /**
   * Encontra campanha pela API key.
   * Usa cache Redis (TTL 1h) para evitar O(n) decrypt em cada request.
   */
  async findCampaignByKey(key: string) {
    if (!key) return null

    return this.redis.cachedLookup(
      `tracking:campaign-key:${key}`,
      () => this.findCampaignByKeyFromDb(key),
      3600,
    )
  }

  private async findCampaignByKeyFromDb(key: string) {
    const campaignsWithKey = await this.prisma.client.campaigns.findMany({
      where: { trackingApiKey: { not: null } },
      select: { campaignId: true, companyId: true, trackingApiKey: true, columnSetId: true, name: true },
    })

    return campaignsWithKey.find((c) => {
      try {
        return decrypt(c.trackingApiKey) === key
      } catch {
        return false
      }
    }) || null
  }

  /**
   * Encontra empresa pela secret key.
   * Usa cache Redis (TTL 1h) para evitar O(n) decrypt em cada request.
   */
  async findCompanyBySecretKey(key: string) {
    if (!key) return null

    return this.redis.cachedLookup(
      `tracking:company-key:${key}`,
      () => this.findCompanyBySecretKeyFromDb(key),
      3600,
    )
  }

  private async findCompanyBySecretKeyFromDb(key: string) {
    // `status: 'ACTIVE'` faz a chave de tracking da empresa desativada deixar de
    // resolver — o pixel dela para de coletar. O resultado e cacheado por 1h, e a
    // invalidacao vem do CompanyStatusService/lista, nao daqui; ate 1h de coleta
    // residual e aceitavel para tracking, ao contrario de sessao ou webhook.
    const companiesWithKey = await this.prisma.client.companies.findMany({
      where: { secretKey: { not: null }, status: 'ACTIVE' },
      select: { id: true, secretKey: true },
    })

    return companiesWithKey.find((c) => {
      try {
        return decrypt(c.secretKey) === key
      } catch {
        return false
      }
    }) || null
  }
}
