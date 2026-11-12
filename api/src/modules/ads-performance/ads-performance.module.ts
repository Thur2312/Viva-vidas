import { Module } from '@nestjs/common'
import { AdsPerformanceController } from './ads-performance.controller'
import { AdsPerformanceService } from './ads-performance.service'
import { AdsQueryService } from './services/ads-query.service'
import { AdsLinkingService } from './services/ads-linking.service'
import { DatabaseModule } from 'src/database/database.module'

@Module({
  imports: [DatabaseModule],
  controllers: [AdsPerformanceController],
  providers: [AdsPerformanceService, AdsQueryService, AdsLinkingService],
  exports: [AdsPerformanceService],
})
export class AdsPerformanceModule {}
