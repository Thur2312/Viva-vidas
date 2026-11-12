import { Injectable } from '@nestjs/common'

/** STUB: cota/excedente de leads por plano (conceito de billing do HDM). No-op. */
@Injectable()
export class LeadsUsageService {
  async incrementLeadCount(_companyId: string): Promise<void> {}

  async logLeadOverage(_params: {
    companyId: string
    leadId?: string
    leadName?: string
    leadEmail?: string
    leadSource?: string
    campaignId?: string
    campaignName?: string
  }): Promise<void> {}
}
