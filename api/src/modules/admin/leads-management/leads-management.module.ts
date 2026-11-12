import { Module } from '@nestjs/common'
import { LeadsManagementService } from './leads-management.service'
import { LeadsUsageService } from './services/leads-usage.service'

// STUB module (ver leads-management.service.ts)
@Module({
  providers: [LeadsManagementService, LeadsUsageService],
  exports: [LeadsManagementService, LeadsUsageService],
})
export class LeadsManagementModule {}
