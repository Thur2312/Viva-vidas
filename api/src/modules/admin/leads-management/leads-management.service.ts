import { Injectable, Logger, NotImplementedException } from '@nestjs/common'
import { CreateLeadDto } from './dto/create-leads-management.dto'

/**
 * STUB. No HDM este servico e o CRM de leads inteiro (criacao, dedup, kanban, distribuicao...).
 * O codigo do meta-webhook so chama `createLead`; implemente aqui a persistencia de lead do
 * novo projeto (ou injete o servico real do agente de vendas).
 */
@Injectable()
export class LeadsManagementService {
  private readonly logger = new Logger(LeadsManagementService.name)

  async createLead(
    campaignId: string,
    createLeadDto: CreateLeadDto,
    _options?: { skipApiKeyValidation?: boolean },
  ): Promise<any> {
    this.logger.warn(`[STUB] createLead campaign=${campaignId} nao implementado`)
    throw new NotImplementedException('LeadsManagementService.createLead is a stub in horizon-agent')
  }
}
