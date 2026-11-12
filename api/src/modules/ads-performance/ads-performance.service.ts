import { Injectable } from '@nestjs/common'
import { AdsQueryService } from './services/ads-query.service'
import { AdsLinkingService } from './services/ads-linking.service'
import {
  PaginatedAvailableAdsResponse,
  AvailableAdsResponse,
  GetAvailableParams,
} from './types/ads-performance.types'

// Re-export types for backward compatibility with external consumers
export type {
  MetaCampaignGroup,
  MetaCampaignGroupWithType,
  PaginationMeta,
  AvailableAdsResponse,
  PaginatedAvailableAdsResponse,
  SortField,
  SortOrder,
  FilterHasLeads,
  GetAvailableParams,
} from './types/ads-performance.types'

@Injectable()
export class AdsPerformanceService {
  constructor(
    private readonly adsQueryService: AdsQueryService,
    private readonly adsLinkingService: AdsLinkingService,
  ) {}

  async getAvailableCampaignsPaginated(params: GetAvailableParams): Promise<PaginatedAvailableAdsResponse> {
    return this.adsQueryService.getAvailableCampaignsPaginated(params)
  }

  /** @deprecated Use getAvailableCampaignsPaginated instead */
  async getAvailableCampaigns(companyId: string, hdmCampaignId?: string): Promise<AvailableAdsResponse> {
    return this.adsQueryService.getAvailableCampaigns(companyId, hdmCampaignId)
  }

  async linkAdsToCampaign(hdmCampaignId: string, externalCampaignIds: string[]): Promise<{ linked: number }> {
    return this.adsLinkingService.linkAdsToCampaign(hdmCampaignId, externalCampaignIds)
  }

  async unlinkAdsFromCampaign(hdmCampaignId: string, externalCampaignIds: string[]): Promise<{ unlinked: number }> {
    return this.adsLinkingService.unlinkAdsFromCampaign(hdmCampaignId, externalCampaignIds)
  }

  async autoLinkNewRecords(companyId: string): Promise<number> {
    return this.adsLinkingService.autoLinkNewRecords(companyId)
  }
}
