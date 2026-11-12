import { Global, Module } from '@nestjs/common'
import { CompanyStatusService } from './services/company-status.service'

// TRIMMED: o original registra dezenas de servicos globais do HDM.
@Global()
@Module({ providers: [CompanyStatusService], exports: [CompanyStatusService] })
export class SharedModule {}
