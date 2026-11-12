export interface MetaCampaignGroup {
  externalCampaignId: string
  externalCampaignIds: string[]
  campaignName: string | null
  totalRecords: number
  adSetsCount: number
  adsCount: number
  isLinked: boolean
  linkedToCampaignId: string | null
  linkedToCampaignName?: string | null
  firstDate: string | null
  lastDate: string | null
  totalSpent: number
  totalImpressions: number
  totalClicks: number
  totalLeads: number
  deliveryStatus: string | null
  objective: string | null
  accountName: string | null
}

export interface MetaCampaignGroupWithType extends MetaCampaignGroup {
  _type: 'linked' | 'available' | 'other'
}

export interface PaginationMeta {
  page: number
  pageSize: number
  totalItems: number
  totalPages: number
}

export interface AvailableAdsResponse {
  available: MetaCampaignGroup[]
  linked: MetaCampaignGroup[]
  linkedToOther: MetaCampaignGroup[]
}

export interface PaginatedAvailableAdsResponse {
  data: MetaCampaignGroupWithType[]
  meta: PaginationMeta
  counts: {
    available: number
    linked: number
    linkedToOther: number
  }
  lastUpdatedAt: string | null
}

export type SortField = 'name' | 'date' | 'spent' | 'impressions' | 'clicks' | 'leads'
export type SortOrder = 'asc' | 'desc'
export type FilterHasLeads = 'all' | 'yes' | 'no'

export interface GetAvailableParams {
  companyId: string
  hdmCampaignId?: string
  search?: string
  sortField?: SortField
  sortOrder?: SortOrder
  filterHasLeads?: FilterHasLeads
  filterObjective?: string
  filterStatus?: string
  page?: number
  pageSize?: number
}
