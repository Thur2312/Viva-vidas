import { Module } from '@nestjs/common'
import { LeadDistributionEngineService } from './lead-distribution-engine.service'

// STUB module
@Module({
  providers: [LeadDistributionEngineService],
  exports: [LeadDistributionEngineService],
})
export class LeadDistributionModule {}
