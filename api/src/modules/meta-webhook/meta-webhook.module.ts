import { Module } from '@nestjs/common'
import { MetaWebhookController } from './meta-webhook.controller'
import { WebhookWhatsappMetaService } from './webhook.whatsapp-meta.service'
import { WebhookMetaLeadsService } from './meta-leads/webhook-meta-leads.service'
import { MetaLeadsConfigService } from './meta-leads/meta-leads-config.service'
import { MetaLeadsMapperService } from './meta-leads/meta-leads-mapper.service'
import { MetaLeadsRoutingService } from './meta-leads/meta-leads-routing.service'
import { MetaLeadsFallbackService } from './meta-leads/meta-leads-fallback.service'
import { MetaLeadsReconciliationService } from './meta-leads/meta-leads-reconciliation.service'
import { LeadsManagementModule } from 'src/modules/admin/leads-management/leads-management.module'
import { MetaAdsModule } from 'src/modules/meta-ads/meta-ads.module'

@Module({
  controllers: [MetaWebhookController],
  providers: [
    WebhookWhatsappMetaService,
    WebhookMetaLeadsService,
    MetaLeadsConfigService,
    MetaLeadsMapperService,
    MetaLeadsRoutingService,
    MetaLeadsFallbackService,
    MetaLeadsReconciliationService,
  ],
  imports: [LeadsManagementModule, MetaAdsModule],
})
export class MetaWebhookModule {}
