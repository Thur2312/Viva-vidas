import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common'
import { CollectEventDto } from './dto/create-tracking.dto'
import { PrismaService } from 'src/database/prisma.service'
import { formatPhone } from 'src/shared/util/utils'
import { TrackingEventService } from './services/tracking-event.service'
import { TrackingLeadService } from './services/tracking-lead.service'
import { TrackingAuthService } from './services/tracking-auth.service'
import { TrackingCollectService } from './services/tracking-collect.service'
import { TrackingQueryService } from './services/tracking-query.service'
import { TrackingQueueProducer } from './queue/tracking-queue.producer'
import { CompanyStatusService } from 'src/shared/services/company-status.service'
import { CompanyInactiveError } from 'src/shared/errors/company-inactive.error'

@Injectable()
export class TrackingService {
  private readonly logger = new Logger(TrackingService.name)

  constructor(
    private prisma: PrismaService,
    private trackingEventService: TrackingEventService,
    private trackingLeadService: TrackingLeadService,
    private trackingAuthService: TrackingAuthService,
    private trackingCollectService: TrackingCollectService,
    private trackingQueryService: TrackingQueryService,
    private trackingQueueProducer: TrackingQueueProducer,
    // Vive no SharedModule, que e @Global — nao precisa de import de modulo aqui.
    private readonly companyStatus: CompanyStatusService,
  ) {}

  async hasRecentOptin(email: string, companyId: string, windowSeconds = 10): Promise<boolean> {
    return this.trackingAuthService.hasRecentOptin(email, companyId, windowSeconds)
  }

  /**
   * Valida e autentica o tracking, depois enfileira no RabbitMQ.
   * O processamento pesado (INSERT, lead creation, triggers) é feito pelo consumer.
   * Response imediata: { ok: true } em ~5-10ms.
   */
  async createTrackingByKey(data: Record<string, any>) {
    const action = data.action || ''
    if (!action) {
      throw new HttpException('O parâmetro action é obrigatório', HttpStatus.BAD_REQUEST)
    }

    const email = (data.email || '').trim().toLowerCase()
    const phone = data.phone ? formatPhone(data.phone) : ''
    if (!email && !phone) {
      throw new HttpException('O parâmetro email ou phone é obrigatório', HttpStatus.BAD_REQUEST)
    }

    const key = data.key || ''

    // 1. Resolver empresa/campanha pela key (via cache Redis — ~1ms)
    let companyId: string | null = null
    let campaignId: string | null = null
    let authType: 'campaign' | 'company' | 'subdomain' = 'subdomain'

    if (key) {
      const campaign = await this.trackingAuthService.findCampaignByKey(key)
      if (campaign) {
        companyId = campaign.companyId
        campaignId = campaign.campaignId
        authType = 'campaign'
      } else {
        const company = await this.trackingAuthService.findCompanyBySecretKey(key)
        if (company) {
          companyId = company.id
          campaignId = data.campaignId || null
          authType = 'company'
        }
      }
    }

    // Fallback: subdomain
    if (!companyId && data.subdomain) {
      const company = await this.prisma.client.companies.findFirst({
        where: { subdomain: data.subdomain },
        select: { id: true },
      })
      if (company) {
        companyId = company.id
        campaignId = data.campaignId || null
      }
    }

    if (!companyId) {
      throw new HttpException('Key ou subdomain inválido', HttpStatus.UNAUTHORIZED)
    }

    // UM guard depois de resolver, cobrindo os TRES caminhos acima. Nenhum deles
    // filtrava status por conta propria: `findCampaignByKey` nao olha a empresa, e o
    // fallback por subdominio tambem nao — so `findCompanyBySecretKey` filtrava. O
    // resultado era pixel de empresa desativada continuando a criar Lead e Customer,
    // em texto puro, por cima do selo de `Customers` (customer-identity.utils.ts).
    //
    // Pelo CompanyStatusService, e nao por um WHERE no lookup, porque as duas buscas
    // de chave sao cacheadas 1h no Redis e nao sao invalidadas na transicao — o status
    // e, por `onCompanyStatusChanged`.
    if (!(await this.companyStatus.isActive(companyId))) {
      throw new CompanyInactiveError(companyId, 'tracking')
    }

    // 2. Enfileirar no RabbitMQ — response imediata
    await this.trackingQueueProducer.enqueueTracking({
      data,
      authType,
      companyId,
      campaignId,
    })

    return { ok: true }
  }

  async getLeadTracking(email: string, phone: string, companyId: string) {
    return this.trackingQueryService.getLeadTracking(email, phone, companyId)
  }

  async collectEvent(dto: CollectEventDto, subdomain: string) {
    return this.trackingCollectService.collectEvent(dto, subdomain)
  }
}
