import { Injectable, Logger } from '@nestjs/common'
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq'
import { TRACKING_EXCHANGE, ROUTING_KEY_TRACKING } from './tracking-queue.constants'

export interface TrackingJobData {
  /** Dados completos do tracking (mesma shape de createTrackingByKey) */
  data: Record<string, any>
  /** Tipo de auth usado: campaign, company ou subdomain */
  authType: 'campaign' | 'company' | 'subdomain'
  /** IDs resolvidos na auth (do cache Redis) */
  companyId: string
  campaignId: string | null
  /** Retry count */
  _retryCount?: number
}

@Injectable()
export class TrackingQueueProducer {
  private readonly logger = new Logger(TrackingQueueProducer.name)

  constructor(private readonly amqpConnection: AmqpConnection) {}

  async enqueueTracking(job: TrackingJobData): Promise<void> {
    try {
      await this.amqpConnection.publish(TRACKING_EXCHANGE, ROUTING_KEY_TRACKING, job, {
        persistent: true,
        headers: {
          'x-retry-count': 0,
          'x-created-at': Date.now(),
        },
      })
    } catch (err) {
      this.logger.error(`[TrackingQueue] Falha ao publicar: ${err?.message}`)
      throw err
    }
  }
}
