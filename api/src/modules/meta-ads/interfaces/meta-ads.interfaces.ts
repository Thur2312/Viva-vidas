/**
 * Interfaces para o modulo Meta ADS
 * Documentacao: https://developers.facebook.com/docs/marketing-api/reference/ads-insights
 * Versao: v25.0 - TODOS os campos disponiveis
 */

// Tipos auxiliares para arrays de actions/stats da API Meta
// Documentacao: https://developers.facebook.com/docs/marketing-api/reference/ads-action-stats
export type AdsActionStats = {
  // Identificacao da acao
  action_type: string
  value: string // Valor default attribution window

  // Attribution windows - Click
  '1d_click'?: string
  '1d_click_all_conversions'?: string
  '1d_click_first_conversion'?: string
  '7d_click'?: string
  '7d_click_all_conversions'?: string
  '7d_click_first_conversion'?: string
  '28d_click'?: string
  '28d_click_all_conversions'?: string
  '28d_click_first_conversion'?: string

  // Attribution windows - View
  '1d_view'?: string
  '1d_view_all_conversions'?: string
  '1d_view_first_conversion'?: string
  '7d_view'?: string
  '7d_view_all_conversions'?: string
  '7d_view_first_conversion'?: string
  '28d_view'?: string
  '28d_view_all_conversions'?: string
  '28d_view_first_conversion'?: string

  // Attribution windows - Engaged View
  '1d_ev'?: string
  '1d_ev_all_conversions'?: string
  '1d_ev_first_conversion'?: string

  // Attribution models
  dda?: string
  incrementality?: string
  incrementality_all_conversions?: string
  incrementality_first_conversion?: string
  inline?: string

  // Metadata da acao
  action_canvas_component_name?: string
  action_carousel_card_id?: string
  action_carousel_card_name?: string
  action_destination?: string
  action_device?: string
  action_reaction?: string
  action_target_id?: string
  action_video_sound?: string
  action_video_type?: string
}

export type AdsHistogramStats = {
  action_type?: string
  value?: string | number[]
}

export type AdsInsightsResult = {
  action_type?: string
  value?: string

  // Attribution windows (mesmo padrao de AdsActionStats)
  '1d_click'?: string
  '7d_click'?: string
  '28d_click'?: string
  '1d_view'?: string
  '7d_view'?: string
  '28d_view'?: string
  '1d_ev'?: string
  dda?: string
  inline?: string
}

// ============================================================================
// INTERFACES DA API META
// ============================================================================

export interface MetaInsightData {
  // === IDENTIFICACAO ===
  account_id?: string
  account_name?: string
  account_currency?: string
  campaign_name: string
  campaign_id: string
  adset_name: string
  adset_id: string
  ad_name: string
  ad_id: string

  // === METADATA DA CAMPANHA ===
  objective?: string
  optimization_goal?: string
  buying_type?: string
  attribution_setting?: string
  created_time?: string
  updated_time?: string

  // === METRICAS DE ALCANCE ===
  impressions: string
  reach: string
  frequency: string
  frequency_value?: string
  full_view_impressions?: string
  full_view_reach?: string

  // === METRICAS DE CLIQUES ===
  clicks?: string
  inline_link_clicks: string
  inline_post_engagement?: string
  unique_clicks?: string
  unique_inline_link_clicks?: string
  outbound_clicks?: AdsActionStats[]
  unique_outbound_clicks?: AdsActionStats[]

  // === TAXAS (CTR) ===
  ctr: string
  unique_ctr?: string
  inline_link_click_ctr?: string
  unique_link_clicks_ctr?: string
  outbound_clicks_ctr?: AdsActionStats[]
  unique_outbound_clicks_ctr?: AdsActionStats[]
  website_ctr?: AdsActionStats[]

  // === METRICAS DE CUSTO ===
  spend: string
  cpm: string
  cpc: string
  cpp?: string
  cost_per_inline_link_click?: string
  cost_per_inline_post_engagement?: string
  cost_per_unique_click?: string
  cost_per_unique_inline_link_click?: string
  cost_per_thruplay?: AdsActionStats[]
  cost_per_action_type?: AdsActionStats[]
  cost_per_conversion?: AdsActionStats[]
  cost_per_unique_action_type?: AdsActionStats[]
  cost_per_unique_conversion?: AdsActionStats[]
  cost_per_outbound_click?: AdsActionStats[]
  cost_per_unique_outbound_click?: AdsActionStats[]
  cost_per_ad_click?: AdsActionStats[]
  cost_per_15_sec_video_view?: AdsActionStats[]
  cost_per_2_sec_continuous_video_view?: AdsActionStats[]
  cost_per_one_thousand_ad_impression?: AdsActionStats[]
  cost_per_dda_countby_convs?: string
  cost_per_objective_result?: AdsInsightsResult[]
  cost_per_result?: AdsInsightsResult[]

  // === METRICAS DE VIDEO ===
  video_play_actions?: AdsActionStats[]
  video_p25_watched_actions?: AdsActionStats[]
  video_p50_watched_actions?: AdsActionStats[]
  video_p75_watched_actions?: AdsActionStats[]
  video_p95_watched_actions?: AdsActionStats[]
  video_p100_watched_actions?: AdsActionStats[]
  video_30_sec_watched_actions?: AdsActionStats[]
  video_avg_time_watched_actions?: AdsActionStats[]
  video_thruplay_watched_actions?: AdsActionStats[]
  video_continuous_2_sec_watched_actions?: AdsActionStats[]
  video_time_watched_actions?: AdsActionStats[]
  video_play_curve_actions?: AdsHistogramStats[]
  video_play_retention_0_to_15s_actions?: AdsHistogramStats[]
  video_play_retention_20_to_60s_actions?: AdsHistogramStats[]
  video_play_retention_graph_actions?: AdsHistogramStats[]

  // === ENGAJAMENTO SOCIAL ===
  social_spend?: string

  // === QUALIDADE E RANKING ===
  quality_ranking?: string
  engagement_rate_ranking?: string
  conversion_rate_ranking?: string

  // === CONVERSOES E ACOES ===
  actions?: AdsActionStats[]
  action_values?: AdsActionStats[]
  ad_click_actions?: AdsActionStats[]
  ad_impression_actions?: AdsActionStats[]
  unique_actions?: AdsActionStats[]
  conversions?: AdsActionStats[]
  conversion_values?: AdsActionStats[]
  unique_conversions?: AdsActionStats[]
  purchase_roas?: AdsActionStats[]
  website_purchase_roas?: AdsActionStats[]
  mobile_app_purchase_roas?: AdsActionStats[]

  // === CANVAS/INSTANT EXPERIENCE ===
  canvas_avg_view_percent?: string
  canvas_avg_view_time?: string
  instant_experience_clicks_to_open?: string
  instant_experience_clicks_to_start?: string
  instant_experience_outbound_clicks?: AdsActionStats[]

  // === ESTIMATIVAS ===
  estimated_ad_recall_rate?: string
  estimated_ad_recallers?: string

  // === CATALOGO ===
  catalog_segment_value?: AdsActionStats[]
  catalog_segment_actions?: AdsActionStats[]
  catalog_segment_value_mobile_purchase_roas?: AdsActionStats[]
  catalog_segment_value_omni_purchase_roas?: AdsActionStats[]
  catalog_segment_value_website_purchase_roas?: AdsActionStats[]

  // === RESULTADOS/OBJETIVOS ===
  objective_results?: AdsInsightsResult[]
  objective_result_rate?: AdsInsightsResult[]
  result_rate?: AdsInsightsResult[]
  result_values_performance_indicator?: string

  // === DDA (Data-Driven Attribution) ===
  dda_countby_convs?: string
  dda_results?: any[]

  // === ENGAJAMENTO ADICIONAL ===
  interactive_component_tap?: AdsActionStats[]
  instagram_upcoming_event_reminders_set?: string

  // === LANDING PAGE ===
  landing_page_view_per_link_click?: string
  purchase_per_landing_page_view?: string

  // === MARKETING MESSAGES ===
  marketing_messages_delivered?: string
  marketing_messages_delivery_rate?: string
  marketing_messages_read_rate_benchmark?: string

  // === WEBSITE ===
  // website_ctr already in TAXAS section

  // === AUCTION ===
  auction_bid?: string
  auction_competitiveness?: string
  auction_max_competitor_bid?: string
  wish_bid?: string

  // === OUTROS ===
  qualifying_question_qualify_answer_rate?: string
  shops_assisted_purchases?: string
  total_card_view?: string
  anchor_event_attribution_setting?: string
  anchor_events_performance_indicator?: string
  multi_event_conversion_attribution_setting?: string

  // === REELS / INSTAGRAM (v25.0) ===
  reels_activity?: any[]

  // === DATAS ===
  date_start: string
  date_stop: string

  // === CAMPOS CALCULADOS (adicionados pelo service) ===
  leads?: number
  cpl?: string
}

export interface MetaCampaignInsight {
  campaignName: string
  campaignId: string
  accountCurrency?: string
  objective?: string
  optimizationGoal?: string
  buyingType?: string
  attributionSetting?: string | null
  createdTime?: string | null
  updatedTime?: string | null
  spend: number
  impressions: number
  reach: number
  frequency: number
  frequencyValue?: string | null
  clicks: number
  uniqueClicks: number
  ctr: number
  uniqueCtr: number
  cpm: number
  cpc: number
  cpp: number
  costPerInlineLinkClick: number
  costPerInlinePostEngagement: number
  costPerUniqueClick: number
  costPerUniqueInlineLinkClick: number
  costPerThruplay?: AdsActionStats[] | null
  costPerOutboundClick?: AdsActionStats[] | null
  costPerUniqueOutboundClick?: AdsActionStats[] | null
  costPerAdClick?: AdsActionStats[] | null
  costPer15SecVideoView?: AdsActionStats[] | null
  costPer2SecContinuousVideoView?: AdsActionStats[] | null
  costPerOneThousandAdImpression?: AdsActionStats[] | null
  costPerDdaCountbyConvs?: number
  costPerObjectiveResult?: AdsInsightsResult[] | null
  costPerResult?: AdsInsightsResult[] | null
  inlinePostEngagement: number
  uniqueInlineLinkClicks: number
  inlineLinkClickCtr: number
  uniqueLinkClicksCtr?: number
  outboundClicks?: AdsActionStats[] | null
  uniqueOutboundClicks?: AdsActionStats[] | null
  outboundClicksCtr?: AdsActionStats[] | null
  uniqueOutboundClicksCtr?: AdsActionStats[] | null
  websiteCtr?: AdsActionStats[] | null
  fullViewImpressions: number
  fullViewReach: number
  leads: number
  cpl: string
  videoPlays: number
  videoViews25: number
  videoViews50: number
  videoViews75: number
  videoViews95: number
  videoViews100: number
  video30SecWatched: number
  videoAvgTimeWatched: number
  videoThruplayWatched: number
  videoContinuous2SecWatched?: AdsActionStats[] | null
  videoTimeWatched?: AdsActionStats[] | null
  videoPlayCurveActions?: AdsHistogramStats[] | null
  videoPlayRetention0To15s?: AdsHistogramStats[] | null
  videoPlayRetention20To60s?: AdsHistogramStats[] | null
  videoPlayRetentionGraph?: AdsHistogramStats[] | null
  socialSpend: number
  qualityRanking?: string | null
  engagementRateRanking?: string | null
  conversionRateRanking?: string | null
  actions?: AdsActionStats[] | null
  actionValues?: AdsActionStats[] | null
  adClickActions?: AdsActionStats[] | null
  adImpressionActions?: AdsActionStats[] | null
  uniqueActions?: AdsActionStats[] | null
  conversions?: AdsActionStats[] | null
  conversionValues?: AdsActionStats[] | null
  uniqueConversions?: AdsActionStats[] | null
  costPerActionType?: AdsActionStats[] | null
  costPerConversion?: AdsActionStats[] | null
  costPerUniqueActionType?: AdsActionStats[] | null
  costPerUniqueConversion?: AdsActionStats[] | null
  purchaseRoas?: AdsActionStats[] | null
  websitePurchaseRoas?: AdsActionStats[] | null
  mobileAppPurchaseRoas?: AdsActionStats[] | null
  canvasAvgViewPercent: number
  canvasAvgViewTime: number
  instantExperienceClicksToOpen?: number
  instantExperienceClicksToStart?: number
  instantExperienceOutboundClicks?: AdsActionStats[] | null
  estimatedAdRecallRate: number
  estimatedAdRecallers: number
  catalogSegmentValue?: AdsActionStats[] | null
  catalogSegmentActions?: AdsActionStats[] | null
  catalogSegmentValueMobilePurchaseRoas?: AdsActionStats[] | null
  catalogSegmentValueOmniPurchaseRoas?: AdsActionStats[] | null
  catalogSegmentValueWebsitePurchaseRoas?: AdsActionStats[] | null
  objectiveResults?: AdsInsightsResult[] | null
  objectiveResultRate?: AdsInsightsResult[] | null
  resultRate?: AdsInsightsResult[] | null
  resultValuesPerformanceIndicator?: string | null
  ddaCountbyConvs?: number
  ddaResults?: any[] | null
  interactiveComponentTap?: AdsActionStats[] | null
  instagramUpcomingEventRemindersSet: number
  landingPageViewPerLinkClick: number
  purchasePerLandingPageView: number
  marketingMessagesDelivered: number
  marketingMessagesDeliveryRate?: number
  marketingMessagesReadRateBenchmark?: string | null
  auctionBid?: number
  auctionCompetitiveness?: number
  auctionMaxCompetitorBid?: number
  wishBid?: number
  qualifyingQuestionQualifyAnswerRate?: number
  shopsAssistedPurchases?: string | null
  totalCardView?: string | null
  anchorEventAttributionSetting?: string | null
  anchorEventsPerformanceIndicator?: string | null
  multiEventConversionAttributionSetting?: string | null
  // v25.0
  reelsActivity?: any[] | null
}

export interface MetaAdSetInsight {
  campaignName: string
  campaignId: string
  adSetName: string
  adSetId: string
  accountCurrency?: string
  objective?: string
  optimizationGoal?: string
  buyingType?: string
  attributionSetting?: string | null
  createdTime?: string | null
  updatedTime?: string | null
  spend: number
  impressions: number
  reach: number
  frequency: number
  frequencyValue?: string | null
  clicks: number
  uniqueClicks: number
  ctr: number
  uniqueCtr: number
  cpm: number
  cpc: number
  cpp: number
  costPerInlineLinkClick: number
  costPerInlinePostEngagement: number
  costPerUniqueClick: number
  costPerUniqueInlineLinkClick: number
  costPerThruplay?: AdsActionStats[] | null
  costPerOutboundClick?: AdsActionStats[] | null
  costPerUniqueOutboundClick?: AdsActionStats[] | null
  costPerAdClick?: AdsActionStats[] | null
  costPer15SecVideoView?: AdsActionStats[] | null
  costPer2SecContinuousVideoView?: AdsActionStats[] | null
  costPerOneThousandAdImpression?: AdsActionStats[] | null
  costPerDdaCountbyConvs?: number
  costPerObjectiveResult?: AdsInsightsResult[] | null
  costPerResult?: AdsInsightsResult[] | null
  inlinePostEngagement: number
  uniqueInlineLinkClicks: number
  inlineLinkClickCtr: number
  uniqueLinkClicksCtr?: number
  outboundClicks?: AdsActionStats[] | null
  uniqueOutboundClicks?: AdsActionStats[] | null
  outboundClicksCtr?: AdsActionStats[] | null
  uniqueOutboundClicksCtr?: AdsActionStats[] | null
  websiteCtr?: AdsActionStats[] | null
  fullViewImpressions: number
  fullViewReach: number
  leads: number
  cpl: string
  videoPlays: number
  videoViews25: number
  videoViews50: number
  videoViews75: number
  videoViews95: number
  videoViews100: number
  video30SecWatched: number
  videoAvgTimeWatched: number
  videoThruplayWatched: number
  videoContinuous2SecWatched?: AdsActionStats[] | null
  videoTimeWatched?: AdsActionStats[] | null
  videoPlayCurveActions?: AdsHistogramStats[] | null
  videoPlayRetention0To15s?: AdsHistogramStats[] | null
  videoPlayRetention20To60s?: AdsHistogramStats[] | null
  videoPlayRetentionGraph?: AdsHistogramStats[] | null
  socialSpend: number
  qualityRanking?: string | null
  engagementRateRanking?: string | null
  conversionRateRanking?: string | null
  actions?: AdsActionStats[] | null
  actionValues?: AdsActionStats[] | null
  adClickActions?: AdsActionStats[] | null
  adImpressionActions?: AdsActionStats[] | null
  uniqueActions?: AdsActionStats[] | null
  conversions?: AdsActionStats[] | null
  conversionValues?: AdsActionStats[] | null
  uniqueConversions?: AdsActionStats[] | null
  costPerActionType?: AdsActionStats[] | null
  costPerConversion?: AdsActionStats[] | null
  costPerUniqueActionType?: AdsActionStats[] | null
  costPerUniqueConversion?: AdsActionStats[] | null
  purchaseRoas?: AdsActionStats[] | null
  websitePurchaseRoas?: AdsActionStats[] | null
  mobileAppPurchaseRoas?: AdsActionStats[] | null
  canvasAvgViewPercent: number
  canvasAvgViewTime: number
  instantExperienceClicksToOpen?: number
  instantExperienceClicksToStart?: number
  instantExperienceOutboundClicks?: AdsActionStats[] | null
  estimatedAdRecallRate: number
  estimatedAdRecallers: number
  catalogSegmentValue?: AdsActionStats[] | null
  catalogSegmentActions?: AdsActionStats[] | null
  catalogSegmentValueMobilePurchaseRoas?: AdsActionStats[] | null
  catalogSegmentValueOmniPurchaseRoas?: AdsActionStats[] | null
  catalogSegmentValueWebsitePurchaseRoas?: AdsActionStats[] | null
  objectiveResults?: AdsInsightsResult[] | null
  objectiveResultRate?: AdsInsightsResult[] | null
  resultRate?: AdsInsightsResult[] | null
  resultValuesPerformanceIndicator?: string | null
  ddaCountbyConvs?: number
  ddaResults?: any[] | null
  interactiveComponentTap?: AdsActionStats[] | null
  instagramUpcomingEventRemindersSet: number
  landingPageViewPerLinkClick: number
  purchasePerLandingPageView: number
  marketingMessagesDelivered: number
  marketingMessagesDeliveryRate?: number
  marketingMessagesReadRateBenchmark?: string | null
  auctionBid?: number
  auctionCompetitiveness?: number
  auctionMaxCompetitorBid?: number
  wishBid?: number
  qualifyingQuestionQualifyAnswerRate?: number
  shopsAssistedPurchases?: string | null
  totalCardView?: string | null
  anchorEventAttributionSetting?: string | null
  anchorEventsPerformanceIndicator?: string | null
  multiEventConversionAttributionSetting?: string | null
  // v25.0
  reelsActivity?: any[] | null
}

// Interface para dados de ads da conta (sem insights)
export interface MetaAdInfo {
  id: string
  name: string
  status: string
  effective_status: string
  adset_id: string
  adset: {
    id: string
    name: string
    campaign_id: string
    campaign: {
      id: string
      name: string
      account_id: string
    }
  }
}

export interface MetaApiResponse {
  data: MetaInsightData[]
  paging?: {
    cursors: { before: string; after: string }
    next?: string
  }
  error?: {
    message: string
    type: string
    code: number
    error_subcode?: number
  }
}

// ============================================================================
// INTERFACES DE RESULTADO
// ============================================================================

export interface SyncResult {
  synced: number
  errors: number
  zeroRecords?: number
}

export interface BreakdownSyncResult extends SyncResult {
  breakdowns: { type: string; synced: number; errors: number }[]
}

export interface MetaCredentials {
  adAccountId: string
  accessToken: string
  /** Id da row em Integrations — usado para gravar metaLastSync apos o sync manual. */
  integrationId: number
}

// ============================================================================
// TIPOS AUXILIARES
// ============================================================================

export type Level = 'ad' | 'adset' | 'campaign' | 'account'

export interface TimeInterval {
  start: Date
  end: Date
}

export interface UniqueItem {
  id: string
  account_id?: string
  account_name?: string
  campaign_id?: string
  campaign_name?: string
  adset_id?: string
  adset_name?: string
  ad_id?: string
  ad_name?: string
}
