import { Injectable, Logger } from '@nestjs/common'

/** STUB: distribuicao automatica de leads entre vendedores (HDM). No-op. */
@Injectable()
export class LeadDistributionEngineService {
  private readonly logger = new Logger(LeadDistributionEngineService.name)

  scheduleOnArrival(leadId: number): void {
    this.logger.debug(`[STUB] scheduleOnArrival lead=${leadId} ignorado`)
  }
}
