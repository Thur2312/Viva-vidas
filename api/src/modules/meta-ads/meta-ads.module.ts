import { Module } from '@nestjs/common'
import { DatabaseModule } from 'src/database/database.module'
import { AdsPerformanceModule } from '../ads-performance/ads-performance.module'
import { FilesModule } from '../files/files.module'
// Para o probe do oauth/status notificar gestores na transição de token inválido.
// Módulo folha (só importa DatabaseModule) — sem risco de ciclo.
import { UserNotificationsModule } from '../admin/notifications/user-notifications.module'
import { MetaVideoSourceModule } from './meta-video-source.module'

// Controllers
import { MetaAdsOAuthController } from './controllers/meta-ads-oauth.controller'
import { MetaAdsInsightsController } from './controllers/meta-ads-insights.controller'
import { MetaAdsCronController } from './controllers/meta-ads-cron.controller'
import { MetaLeadFormsController } from './controllers/meta-lead-forms.controller'

// Services
import { MetaAdsService } from './services/meta-ads.service'
import { MetaAdsCronService } from './services/meta-ads-cron.service'
import { MetaAdsOAuthService } from './services/meta-ads-oauth.service'
import { MetaLeadFormsService } from './services/meta-lead-forms.service'

// Strategies
import { InsightsSyncStrategy } from './strategies/insights-sync.strategy'
import { AdsSyncStrategy } from './strategies/ads-sync.strategy'
import { BreakdownSyncStrategy } from './strategies/breakdown-sync.strategy'

// Mappers
import { MetaAdsMapper } from './mappers/meta-ads.mapper'

@Module({
  imports: [DatabaseModule, AdsPerformanceModule, FilesModule, UserNotificationsModule, MetaVideoSourceModule],
  controllers: [
    MetaAdsOAuthController,
    MetaAdsInsightsController,
    MetaAdsCronController,
    MetaLeadFormsController,
  ],
  providers: [
    // Services
    MetaAdsService,
    MetaAdsCronService,
    MetaAdsOAuthService,
    MetaLeadFormsService,

    // Strategies
    InsightsSyncStrategy,
    AdsSyncStrategy,
    BreakdownSyncStrategy,

    // Mappers
    MetaAdsMapper,
  ],
  exports: [MetaAdsService, MetaAdsCronService, MetaAdsOAuthService, MetaLeadFormsService],
})
export class MetaAdsModule {}
