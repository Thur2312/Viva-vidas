import { Module } from '@nestjs/common'
import { TrackingService } from './tracking.service'
import { TrackingController } from './tracking.controller'
import { TrackController } from './track.controller'
import { TrackingEventService } from './services/tracking-event.service'
import { TrackingLeadService } from './services/tracking-lead.service'
import { TrackingAuthService } from './services/tracking-auth.service'
import { TrackingCollectService } from './services/tracking-collect.service'
import { TrackingQueryService } from './services/tracking-query.service'
import { TrackingAnalyticsService } from './services/tracking-analytics.service'
import { TrackingActionConfigService } from './services/tracking-action-config.service'
import { TrackingActionConfigAuditService } from './services/tracking-action-config-audit.service'
import { TrackingQueueProducer } from './queue/tracking-queue.producer'
import { TrackingQueueProcessor } from './queue/tracking-queue.processor'
import { LeadDistributionModule } from 'src/modules/admin/lead-distribution/lead-distribution.module'

@Module({
  // Distribuição automática do lead criado pelo pixel de tracking.
  imports: [LeadDistributionModule],
  controllers: [TrackingController, TrackController],
  providers: [
    TrackingService,
    TrackingEventService,
    TrackingLeadService,
    TrackingAuthService,
    TrackingCollectService,
    TrackingQueryService,
    TrackingAnalyticsService,
    TrackingActionConfigService,
    TrackingActionConfigAuditService,
    TrackingQueueProducer,
    TrackingQueueProcessor,
  ],
  // O TriggerModule consome o catalogo para popular o seletor de acao das condicoes.
  exports: [TrackingActionConfigService],
})
export class TrackingModule {}
