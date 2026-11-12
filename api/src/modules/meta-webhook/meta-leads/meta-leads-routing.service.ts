import { Injectable, Logger } from '@nestjs/common'
import { PrismaService } from 'src/database/prisma.service'
import { MetaLeadFormsService } from 'src/modules/meta-ads/services/meta-lead-forms.service'
import { MetaLeadData } from './types/meta-lead.types'

@Injectable()
export class MetaLeadsRoutingService {
  private readonly logger = new Logger(MetaLeadsRoutingService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly metaLeadFormsService: MetaLeadFormsService,
  ) {}

  /**
   * Encontra a campanha HDM vinculada ao lead.
   * Estrategia de busca (em ordem de prioridade):
   * 0. Mapeamento explicito form_id -> campanha (tabela meta_lead_form_mapping)
   * 1. Campanha que ja tem leads com o mesmo form_id
   * 2. Campanha que ja tem leads com o mesmo page_id
   * 3. Campanha vinculada via AdsPerformance (external_campaign_id)
   * 4. Sem mapeamento encontrado (retorna null)
   */
  async findCampaignForLead(
    companyId: string,
    leadData: MetaLeadData,
    pageId: string,
    formId: string,
  ): Promise<string | null> {
    // 0. Mapeamento explicito configurado pelo usuario
    if (formId) {
      const mappedCampaign = await this.metaLeadFormsService.findCampaignByFormId(formId, companyId)
      if (mappedCampaign) {
        this.logger.log(`[Meta Leads] Campaign found via form mapping: form=${formId} -> campaign=${mappedCampaign}`)
        return mappedCampaign
      }
    }

    // 1. Busca por form_id em leads existentes
    if (formId) {
      const existingLead = await this.prisma.leads.findFirst({
        where: { form_id: formId, companyId, deleted_at: null },
        select: { campaignId: true },
      })
      if (existingLead?.campaignId) return existingLead.campaignId
    }

    // 2. Busca por page_id em leads existentes
    if (pageId) {
      const existingLead = await this.prisma.leads.findFirst({
        where: { page_id: pageId, companyId, deleted_at: null },
        select: { campaignId: true },
        orderBy: { created_at: 'desc' },
      })
      if (existingLead?.campaignId) return existingLead.campaignId
    }

    // 3. Busca via AdsPerformance (se o lead veio de uma campanha Meta ja sincronizada)
    if (leadData.campaign_id) {
      const adsPerf = await this.prisma.adsPerformance.findFirst({
        where: {
          externalCampaignId: leadData.campaign_id,
          companyId,
          campaignId: { not: null },
        },
        select: { campaignId: true },
      })
      if (adsPerf?.campaignId) return adsPerf.campaignId
    }

    // 4. Sem mapeamento encontrado — lead sera criado sem campanha
    return null
  }
}
