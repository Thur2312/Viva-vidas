import { Injectable, Logger } from '@nestjs/common'
import { RabbitSubscribe } from '@golevelup/nestjs-rabbitmq'
import { SkipThrottle } from '@nestjs/throttler'
import { Public } from 'src/modules/auth/public.decorator'
import { PrismaService } from 'src/database/prisma.service'
import { normalizeAction, formatName, formatPhone, parseUtms } from 'src/shared/util/utils'
import { TrackingEventService } from '../services/tracking-event.service'
import { TrackingLeadService } from '../services/tracking-lead.service'
import { TrackingAuthService } from '../services/tracking-auth.service'
import { TrackingJobData } from './tracking-queue.producer'
import {
  TRACKING_EXCHANGE,
  TRACKING_QUEUE,
  ROUTING_KEY_TRACKING,
  TRACKING_MAX_RETRIES,
} from './tracking-queue.constants'
import { TRACKING_CHANNEL } from 'src/shared/rabbitmq/shared-rabbitmq.constants'

@Injectable()
@Public()
@SkipThrottle()
export class TrackingQueueProcessor {
  private readonly logger = new Logger(TrackingQueueProcessor.name)

  constructor(
    private prisma: PrismaService,
    private trackingEventService: TrackingEventService,
    private trackingLeadService: TrackingLeadService,
    private trackingAuthService: TrackingAuthService,
  ) {}

  @RabbitSubscribe({
    exchange: TRACKING_EXCHANGE,
    routingKey: ROUTING_KEY_TRACKING,
    queue: TRACKING_QUEUE,
    createQueueIfNotExists: false,
    queueOptions: { channel: TRACKING_CHANNEL },
  })
  async handleTracking(job: TrackingJobData): Promise<void> {
    const { data, authType, companyId, campaignId } = job
    const retryCount = job._retryCount || 0

    try {
      const email = (data.email || '').trim().toLowerCase()
      const phone = data.phone ? formatPhone(data.phone) : ''
      const name = data.name ? formatName(data.name) : ''
      const normalizedAction = normalizeAction(data.action || '')

      // 1. Se auth por secret key de empresa, verificar se lead/tracking existe
      if (authType === 'company') {
        const leadWhere = email
          ? { email, isStudent: true, campaign: { companyId } }
          : { phone, isStudent: true, campaign: { companyId } }

        const lead = await this.prisma.leads.findFirst({
          where: leadWhere,
          select: { id: true, campaignId: true },
        })

        if (!lead) {
          const trackingWhere = email ? { email, companyId } : { phone, companyId }
          const existingTracking = await this.prisma.tracking.findFirst({
            where: trackingWhere,
            select: { id: true },
          })

          if (!existingTracking) {
            this.logger.warn(`[TrackingQueue] Aluno não encontrado: ${email || phone}`)
            return // Descartar — não faz sentido retry
          }
        }
      }

      // 2. Dedup OPTIN
      if (normalizedAction.toUpperCase() === 'OPTIN' && email && companyId) {
        const isDuplicate = await this.trackingAuthService.hasRecentOptin(email, companyId)
        if (isDuplicate) return
      }

      // 3. Parsear UTMs
      const parsedUtms = parseUtms(data.utms || '')
      const currentTimestamp = new Date()
      const unixTimestamp = data.timestamp_2
        ? parseInt(data.timestamp_2)
        : Math.floor(currentTimestamp.getTime() / 1000)

      // 4. INSERT tracking
      await this.prisma.tracking.create({
        data: {
          action: normalizedAction,
          email,
          name,
          phone,
          companyId,
          campaignId,
          sessionId: data.sessionId || '',
          ip: data.ip || '',
          url: data.url || '',
          device: data.device || '',
          referral: data.referral || '',
          tag: data.tag || '',
          trackingTitle: data.trackingTitle || '',
          trackingIconUrl: data.trackingIconUrl || '',
          timestamp: data.timestamp || currentTimestamp,
          timestamp_2: unixTimestamp,
          utms: data.utms || '',
          utm_source: parsedUtms.utm_source || data.utm_source || '',
          utm_medium: parsedUtms.utm_medium || data.utm_medium || '',
          utm_campaign: parsedUtms.utm_campaign || data.utm_campaign || '',
          utm_content: parsedUtms.utm_content || data.utm_content || '',
          utm_term: parsedUtms.utm_term || data.utm_term || '',
          utm_var1: parsedUtms.utm_var1 || data.utm_var1 || '',
          fbc: parsedUtms.utm_fb || data.fbc || '',
          gclid: parsedUtms.utm_gclid || data.gclid || '',
          adset_id: data.adset_id || '',
          adset_name: data.adset_name || '',
          ad_id: data.ad_id || '',
          ad_name: data.ad_name || '',
          page_id: data.page_id || '',
          page_name: data.page_name || '',
          form_id: data.form_id || '',
          form_name: data.form_name || '',
          form_locale: data.form_locale || '',
          form_status: data.form_status || '',
        },
      })

      // 5. Auto-criar Lead se auth por campaign key.
      // findOrCreateLeadFromTracking encapsula defesa contra race condition (Redis lock + P2002 catch).
      if (authType === 'campaign' && campaignId && (email || phone)) {
        const campaignData = await this.prisma.campaigns.findUnique({
          where: { campaignId },
          select: { campaignId: true, companyId: true, columnSetId: true, name: true },
        })
        if (campaignData) {
          await this.trackingLeadService.findOrCreateLeadFromTracking(email, campaignData, phone)
        }
      }

      // 6. Emitir evento para triggers
      this.trackingEventService.emitTrackingEvent({
        companyId,
        campaignId,
        email,
        phone,
        action: normalizedAction,
      })
    } catch (err) {
      // NUNCA throw aqui — throw causa nack/redelivery que gera tempestade de retries
      // e esgota o connection pool do PostgreSQL. Melhor logar e descartar (ack).
      this.logger.error(
        `[TrackingQueue] Erro ao processar tracking: ${err?.message} | email=${data.email || ''} | company=${companyId}`,
      )
    }
  }
}
