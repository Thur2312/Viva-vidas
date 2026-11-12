import { Injectable } from '@nestjs/common'
import { Decimal } from '@prisma/client/runtime/library'
import { AdsActionStats, Level, UniqueItem } from '../interfaces/meta-ads.interfaces'

/**
 * Mapper para converter dados da API Meta v25.0 para o formato do banco de dados
 * Mapeia TODOS os campos disponiveis da API
 */
@Injectable()
export class MetaAdsMapper {
  /**
   * Extrai leads das actions
   */
  extractLeads(actions?: AdsActionStats[]): number {
    if (!actions) return 0
    const leadAction = actions.find(
      a => a.action_type === 'lead' || a.action_type === 'leadgen.other'
    )
    return leadAction ? parseInt(leadAction.value) : 0
  }

  /**
   * Extrai valor de um array de actions de video
   */
  extractVideoValue(videoActions?: AdsActionStats[]): string | null {
    return videoActions?.[0]?.value || null
  }

  /**
   * Converte string para Decimal de forma segura
   */
  private toDecimal(value?: string | null): Decimal | null {
    if (!value || value === '') return null
    try {
      return new Decimal(value)
    } catch {
      return null
    }
  }

  /**
   * Converte string para BigInt de forma segura
   */
  private toBigInt(value?: string | null): bigint | null {
    if (!value || value === '') return null
    try {
      return BigInt(value)
    } catch {
      return null
    }
  }

  /**
   * Mapeia um insight da API para dados do banco (estrategia /insights)
   * Inclui TODOS os campos da API Meta v25.0
   */
  mapInsightToDatabase(insight: any, companyId: string, level: Level): any {
    const startDate = new Date(insight.date_start)
    const endDate = new Date(insight.date_stop)
    const leads = this.extractLeads(insight.actions)

    // Extrai metricas de video (extrair [0].value dos arrays)
    const videoPlays = this.extractVideoValue(insight.video_play_actions)
    const videoP25 = this.extractVideoValue(insight.video_p25_watched_actions)
    const videoP50 = this.extractVideoValue(insight.video_p50_watched_actions)
    const videoP75 = this.extractVideoValue(insight.video_p75_watched_actions)
    const videoP95 = this.extractVideoValue(insight.video_p95_watched_actions)
    const videoP100 = this.extractVideoValue(insight.video_p100_watched_actions)
    const video30Sec = this.extractVideoValue(insight.video_30_sec_watched_actions)
    const videoAvgTime = this.extractVideoValue(insight.video_avg_time_watched_actions)
    const videoThruplay = this.extractVideoValue(insight.video_thruplay_watched_actions)

    // Logica de distribuicao de custo (igual ao Excel):
    // - Se nivel campanha: amountSpent = 0, campaignTotalAdsSpent = spend
    // - Outros niveis: amountSpent = spend, campaignTotalAdsSpent = 0
    const spendValue = this.toDecimal(insight.spend)
    const isCampaignLevel = level === 'campaign'

    return {
      reportStartDate: startDate,
      reportEndDate: endDate,
      companyId,
      campaignId: null,

      // === IDENTIFICACAO ===
      accountId: insight.account_id || null,
      accountName: insight.account_name || null,
      accountCurrency: insight.account_currency || null,
      externalCampaignId: insight.campaign_id || null,
      campaignName: insight.campaign_name || null,
      adSetId: insight.adset_id || null,
      adSetName: insight.adset_name || null,
      adId: insight.ad_id || null,
      adName: insight.ad_name || null,

      // === METADATA DA CAMPANHA ===
      objective: insight.objective || null,
      optimizationGoal: insight.optimization_goal || null,
      buyingType: insight.buying_type || null,
      attributionSetting: insight.attribution_setting || null,
      metaCreatedTime: insight.created_time || null,
      metaUpdatedTime: insight.updated_time || null,

      // === METRICAS DE ALCANCE ===
      impressions: this.toBigInt(insight.impressions),
      reach: this.toBigInt(insight.reach),
      frequency: this.toDecimal(insight.frequency),
      frequencyValue: insight.frequency_value || null,
      fullViewImpressions: this.toBigInt(insight.full_view_impressions),
      fullViewReach: this.toBigInt(insight.full_view_reach),

      // === METRICAS DE CLIQUES ===
      clicks: this.toBigInt(insight.clicks),
      uniqueClicks: this.toBigInt(insight.unique_clicks),
      linkClicks: this.toBigInt(insight.inline_link_clicks),
      inlinePostEngagement: this.toBigInt(insight.inline_post_engagement),
      uniqueInlineLinkClicks: this.toBigInt(insight.unique_inline_link_clicks),
      outboundClicks: insight.outbound_clicks || null,
      uniqueOutboundClicks: insight.unique_outbound_clicks || null,

      // === TAXAS (CTR) ===
      ctr: this.toDecimal(insight.ctr),
      uniqueCtr: this.toDecimal(insight.unique_ctr),
      inlineLinkClickCtr: this.toDecimal(insight.inline_link_click_ctr),
      uniqueLinkClicksCtr: this.toDecimal(insight.unique_link_clicks_ctr),
      outboundClicksCtr: insight.outbound_clicks_ctr || null,
      uniqueOutboundClicksCtr: insight.unique_outbound_clicks_ctr || null,
      websiteCtr: insight.website_ctr || null,

      // === METRICAS DE CUSTO ===
      amountSpent: isCampaignLevel ? new Decimal(0) : spendValue,
      campaignTotalAdsSpent: isCampaignLevel ? spendValue : new Decimal(0),
      cpm: this.toDecimal(insight.cpm),
      cpc: this.toDecimal(insight.cpc),
      costPer1kReach: this.toDecimal(insight.cpp),
      costPerInlineLinkClick: this.toDecimal(insight.cost_per_inline_link_click),
      costPerInlinePostEngagement: this.toDecimal(insight.cost_per_inline_post_engagement),
      costPerUniqueClick: this.toDecimal(insight.cost_per_unique_click),
      costPerUniqueInlineLinkClick: this.toDecimal(insight.cost_per_unique_inline_link_click),
      costPerThruplay: insight.cost_per_thruplay || null,
      costPerUniqueActionType: insight.cost_per_unique_action_type || null,
      costPerUniqueConversion: insight.cost_per_unique_conversion || null,
      costPerOutboundClick: insight.cost_per_outbound_click || null,
      costPerUniqueOutboundClick: insight.cost_per_unique_outbound_click || null,
      costPerAdClick: insight.cost_per_ad_click || null,
      costPer15SecVideoView: insight.cost_per_15_sec_video_view || null,
      costPer2SecContinuousVideoView: insight.cost_per_2_sec_continuous_video_view || null,
      costPerOneThousandAdImpression: insight.cost_per_one_thousand_ad_impression || null,
      costPerDdaCountbyConvs: this.toDecimal(insight.cost_per_dda_countby_convs),
      costPerObjectiveResult: insight.cost_per_objective_result || null,
      costPerResult: insight.cost_per_result || null,

      // === METRICAS DE VIDEO ===
      videoPlays: videoPlays ? BigInt(videoPlays) : null,
      videoP25Watched: videoP25 ? BigInt(videoP25) : null,
      videoP50Watched: videoP50 ? BigInt(videoP50) : null,
      videoP75Watched: videoP75 ? BigInt(videoP75) : null,
      videoP95Watched: videoP95 ? BigInt(videoP95) : null,
      videoP100Watched: videoP100 ? BigInt(videoP100) : null,
      video30SecWatched: video30Sec ? BigInt(video30Sec) : null,
      videoAvgTimeWatched: videoAvgTime ? new Decimal(videoAvgTime) : null,
      videoThruplayWatched: videoThruplay ? BigInt(videoThruplay) : null,
      videoContinuous2SecWatched: insight.video_continuous_2_sec_watched_actions || null,
      videoTimeWatched: insight.video_time_watched_actions || null,
      videoPlayCurveActions: insight.video_play_curve_actions || null,
      videoPlayRetention0To15s: insight.video_play_retention_0_to_15s_actions || null,
      videoPlayRetention20To60s: insight.video_play_retention_20_to_60s_actions || null,
      videoPlayRetentionGraph: insight.video_play_retention_graph_actions || null,

      // === ENGAJAMENTO SOCIAL ===
      socialSpend: this.toDecimal(insight.social_spend),

      // === RANKINGS ===
      qualityRanking: insight.quality_ranking || null,
      engagementRateRanking: insight.engagement_rate_ranking || null,
      conversionRateRanking: insight.conversion_rate_ranking || null,

      // === CONVERSOES E ACOES (JSON) ===
      actions: insight.actions || null,
      actionValues: insight.action_values || null,
      adClickActions: insight.ad_click_actions || null,
      adImpressionActions: insight.ad_impression_actions || null,
      uniqueActions: insight.unique_actions || null,
      conversions: insight.conversions || null,
      conversionValues: insight.conversion_values || null,
      uniqueConversions: insight.unique_conversions || null,
      costPerActionType: insight.cost_per_action_type || null,
      costPerConversion: insight.cost_per_conversion || null,
      purchaseRoas: insight.purchase_roas || null,
      websitePurchaseRoas: insight.website_purchase_roas || null,
      mobileAppPurchaseRoas: insight.mobile_app_purchase_roas || null,

      // === CANVAS/INSTANT EXPERIENCE ===
      canvasAvgViewPercent: this.toDecimal(insight.canvas_avg_view_percent),
      canvasAvgViewTime: this.toDecimal(insight.canvas_avg_view_time),
      instantExperienceClicksToOpen: this.toBigInt(insight.instant_experience_clicks_to_open),
      instantExperienceClicksToStart: this.toBigInt(insight.instant_experience_clicks_to_start),
      instantExperienceOutboundClicks: insight.instant_experience_outbound_clicks || null,

      // === ESTIMATIVAS ===
      estimatedAdRecallRate: this.toDecimal(insight.estimated_ad_recall_rate),
      estimatedAdRecallers: this.toBigInt(insight.estimated_ad_recallers),

      // === CATALOGO ===
      catalogSegmentValue: insight.catalog_segment_value || null,
      catalogSegmentActions: insight.catalog_segment_actions || null,
      catalogSegmentValueMobilePurchaseRoas: insight.catalog_segment_value_mobile_purchase_roas || null,
      catalogSegmentValueOmniPurchaseRoas: insight.catalog_segment_value_omni_purchase_roas || null,
      catalogSegmentValueWebsitePurchaseRoas: insight.catalog_segment_value_website_purchase_roas || null,

      // === RESULTADOS/OBJETIVOS ===
      objectiveResults: insight.objective_results || null,
      objectiveResultRate: insight.objective_result_rate || null,
      resultRate: insight.result_rate || null,
      resultValuesPerformanceIndicator: insight.result_values_performance_indicator || null,

      // === DDA ===
      ddaCountbyConvs: this.toDecimal(insight.dda_countby_convs),
      ddaResults: insight.dda_results || null,

      // === ENGAJAMENTO ADICIONAL ===
      interactiveComponentTap: insight.interactive_component_tap || null,
      instagramUpcomingEventRemindersSet: this.toBigInt(insight.instagram_upcoming_event_reminders_set),

      // === LANDING PAGE ===
      landingPageViewPerLinkClick: this.toDecimal(insight.landing_page_view_per_link_click),
      purchasePerLandingPageView: this.toDecimal(insight.purchase_per_landing_page_view),

      // === MARKETING MESSAGES ===
      marketingMessagesDelivered: this.toBigInt(insight.marketing_messages_delivered),
      marketingMessagesDeliveryRate: this.toDecimal(insight.marketing_messages_delivery_rate),
      marketingMessagesReadRateBenchmark: insight.marketing_messages_read_rate_benchmark || null,

      // === AUCTION ===
      auctionBid: this.toDecimal(insight.auction_bid),
      auctionCompetitiveness: this.toDecimal(insight.auction_competitiveness),
      auctionMaxCompetitorBid: this.toDecimal(insight.auction_max_competitor_bid),
      wishBid: this.toDecimal(insight.wish_bid),

      // === OUTROS ===
      qualifyingQuestionQualifyAnswerRate: this.toDecimal(insight.qualifying_question_qualify_answer_rate),
      shopsAssistedPurchases: insight.shops_assisted_purchases || null,
      totalCardView: insight.total_card_view || null,
      anchorEventAttributionSetting: insight.anchor_event_attribution_setting || null,
      anchorEventsPerformanceIndicator: insight.anchor_events_performance_indicator || null,
      multiEventConversionAttributionSetting: insight.multi_event_conversion_attribution_setting || null,

      // === CONVERTED PRODUCT (Catalogo/E-commerce) ===
      convertedProductQuantity: insight.converted_product_quantity || null,
      convertedProductValue: insight.converted_product_value || null,

      // === REELS / INSTAGRAM (v25.0) ===
      reelsActivity: insight.reels_activity || null,

      // === RESULTADOS CALCULADOS ===
      leads: leads ? BigInt(leads) : null,
      // results: usa valor numerico da API se disponivel, senao usa leads como fallback
      // A API Meta retorna results como string numerica ("28") ou array de indicators ([{indicator:"..."}])
      // Apenas valores numericos sao validos para BigInt
      results: (insight.results && typeof insight.results === 'string' && !isNaN(Number(insight.results)))
        ? BigInt(insight.results)
        : (leads ? BigInt(leads) : null),
      cpa: leads > 0 && parseFloat(insight.spend) > 0
        ? new Decimal((parseFloat(insight.spend) / leads).toFixed(6))
        : null,
      cpl: leads > 0 && parseFloat(insight.spend) > 0
        ? new Decimal((parseFloat(insight.spend) / leads).toFixed(6))
        : null,
      conversionRate: leads > 0 && parseInt(insight.clicks || '0') > 0
        ? new Decimal(((leads / parseInt(insight.clicks)) * 100).toFixed(6))
        : null,

      // Fonte de dados
      dataSource: 'meta_api',
    }
  }

  /**
   * Mapeia um ad com insight aninhado para dados do banco (estrategia /ads)
   * Inclui TODOS os campos da API Meta v25.0 (paridade com mapInsightToDatabase)
   * Identificacao vem do ad object, metricas vem do insight aninhado
   */
  mapAdWithInsightToDatabase(ad: any, insight: any, companyId: string): any {
    const startDate = new Date(insight.date_start)
    const endDate = new Date(insight.date_stop)
    const leads = this.extractLeads(insight.actions)

    // Extrai metricas de video (extrair [0].value dos arrays)
    const videoPlays = this.extractVideoValue(insight.video_play_actions)
    const videoP25 = this.extractVideoValue(insight.video_p25_watched_actions)
    const videoP50 = this.extractVideoValue(insight.video_p50_watched_actions)
    const videoP75 = this.extractVideoValue(insight.video_p75_watched_actions)
    const videoP95 = this.extractVideoValue(insight.video_p95_watched_actions)
    const videoP100 = this.extractVideoValue(insight.video_p100_watched_actions)
    const video30Sec = this.extractVideoValue(insight.video_30_sec_watched_actions)
    const videoAvgTime = this.extractVideoValue(insight.video_avg_time_watched_actions)
    const videoThruplay = this.extractVideoValue(insight.video_thruplay_watched_actions)

    // Ads sempre sao nivel ad, entao:
    // - amountSpent = spend (valor real)
    // - campaignTotalAdsSpent = 0 (so campanhas usam esse campo)
    const spendValue = this.toDecimal(insight.spend)
    const clicks = parseInt(insight.clicks || '0')

    return {
      reportStartDate: startDate,
      reportEndDate: endDate,
      companyId,
      campaignId: null,

      // === IDENTIFICACAO (do ad hierarchy + insight fallback) ===
      accountId: ad.adset?.campaign?.account_id || insight.account_id || null,
      accountName: insight.account_name || null,
      accountCurrency: insight.account_currency || null,
      externalCampaignId: ad.adset?.campaign?.id || ad.adset?.campaign_id || null,
      campaignName: ad.adset?.campaign?.name || null,
      adSetId: ad.adset?.id || ad.adset_id || null,
      adSetName: ad.adset?.name || null,
      adId: ad.id,
      adName: ad.name,

      // === METADATA DA CAMPANHA ===
      objective: insight.objective || null,
      optimizationGoal: insight.optimization_goal || null,
      buyingType: insight.buying_type || null,
      attributionSetting: insight.attribution_setting || null,
      metaCreatedTime: insight.created_time || null,
      metaUpdatedTime: insight.updated_time || null,

      // === METRICAS DE ALCANCE ===
      impressions: this.toBigInt(insight.impressions),
      reach: this.toBigInt(insight.reach),
      frequency: this.toDecimal(insight.frequency),
      frequencyValue: insight.frequency_value || null,
      fullViewImpressions: this.toBigInt(insight.full_view_impressions),
      fullViewReach: this.toBigInt(insight.full_view_reach),

      // === METRICAS DE CLIQUES ===
      clicks: this.toBigInt(insight.clicks),
      uniqueClicks: this.toBigInt(insight.unique_clicks),
      linkClicks: this.toBigInt(insight.inline_link_clicks),
      inlinePostEngagement: this.toBigInt(insight.inline_post_engagement),
      uniqueInlineLinkClicks: this.toBigInt(insight.unique_inline_link_clicks),
      outboundClicks: insight.outbound_clicks || null,
      uniqueOutboundClicks: insight.unique_outbound_clicks || null,

      // === TAXAS (CTR) ===
      ctr: this.toDecimal(insight.ctr),
      uniqueCtr: this.toDecimal(insight.unique_ctr),
      inlineLinkClickCtr: this.toDecimal(insight.inline_link_click_ctr),
      uniqueLinkClicksCtr: this.toDecimal(insight.unique_link_clicks_ctr),
      outboundClicksCtr: insight.outbound_clicks_ctr || null,
      uniqueOutboundClicksCtr: insight.unique_outbound_clicks_ctr || null,
      websiteCtr: insight.website_ctr || null,

      // === METRICAS DE CUSTO ===
      amountSpent: spendValue,
      campaignTotalAdsSpent: new Decimal(0),
      cpm: this.toDecimal(insight.cpm),
      cpc: this.toDecimal(insight.cpc),
      costPer1kReach: this.toDecimal(insight.cpp),
      costPerInlineLinkClick: this.toDecimal(insight.cost_per_inline_link_click),
      costPerInlinePostEngagement: this.toDecimal(insight.cost_per_inline_post_engagement),
      costPerUniqueClick: this.toDecimal(insight.cost_per_unique_click),
      costPerUniqueInlineLinkClick: this.toDecimal(insight.cost_per_unique_inline_link_click),
      costPerThruplay: insight.cost_per_thruplay || null,
      costPerUniqueActionType: insight.cost_per_unique_action_type || null,
      costPerUniqueConversion: insight.cost_per_unique_conversion || null,
      costPerOutboundClick: insight.cost_per_outbound_click || null,
      costPerUniqueOutboundClick: insight.cost_per_unique_outbound_click || null,
      costPerAdClick: insight.cost_per_ad_click || null,
      costPer15SecVideoView: insight.cost_per_15_sec_video_view || null,
      costPer2SecContinuousVideoView: insight.cost_per_2_sec_continuous_video_view || null,
      costPerOneThousandAdImpression: insight.cost_per_one_thousand_ad_impression || null,
      costPerDdaCountbyConvs: this.toDecimal(insight.cost_per_dda_countby_convs),
      costPerObjectiveResult: insight.cost_per_objective_result || null,
      costPerResult: insight.cost_per_result || null,

      // === METRICAS DE VIDEO ===
      videoPlays: videoPlays ? BigInt(videoPlays) : null,
      videoP25Watched: videoP25 ? BigInt(videoP25) : null,
      videoP50Watched: videoP50 ? BigInt(videoP50) : null,
      videoP75Watched: videoP75 ? BigInt(videoP75) : null,
      videoP95Watched: videoP95 ? BigInt(videoP95) : null,
      videoP100Watched: videoP100 ? BigInt(videoP100) : null,
      video30SecWatched: video30Sec ? BigInt(video30Sec) : null,
      videoAvgTimeWatched: videoAvgTime ? new Decimal(videoAvgTime) : null,
      videoThruplayWatched: videoThruplay ? BigInt(videoThruplay) : null,
      videoContinuous2SecWatched: insight.video_continuous_2_sec_watched_actions || null,
      videoTimeWatched: insight.video_time_watched_actions || null,
      videoPlayCurveActions: insight.video_play_curve_actions || null,
      videoPlayRetention0To15s: insight.video_play_retention_0_to_15s_actions || null,
      videoPlayRetention20To60s: insight.video_play_retention_20_to_60s_actions || null,
      videoPlayRetentionGraph: insight.video_play_retention_graph_actions || null,

      // === ENGAJAMENTO SOCIAL ===
      socialSpend: this.toDecimal(insight.social_spend),

      // === RANKINGS ===
      qualityRanking: insight.quality_ranking || null,
      engagementRateRanking: insight.engagement_rate_ranking || null,
      conversionRateRanking: insight.conversion_rate_ranking || null,

      // === CONVERSOES E ACOES (JSON) ===
      actions: insight.actions || null,
      actionValues: insight.action_values || null,
      adClickActions: insight.ad_click_actions || null,
      adImpressionActions: insight.ad_impression_actions || null,
      uniqueActions: insight.unique_actions || null,
      conversions: insight.conversions || null,
      conversionValues: insight.conversion_values || null,
      uniqueConversions: insight.unique_conversions || null,
      costPerActionType: insight.cost_per_action_type || null,
      costPerConversion: insight.cost_per_conversion || null,
      purchaseRoas: insight.purchase_roas || null,
      websitePurchaseRoas: insight.website_purchase_roas || null,
      mobileAppPurchaseRoas: insight.mobile_app_purchase_roas || null,

      // === CANVAS/INSTANT EXPERIENCE ===
      canvasAvgViewPercent: this.toDecimal(insight.canvas_avg_view_percent),
      canvasAvgViewTime: this.toDecimal(insight.canvas_avg_view_time),
      instantExperienceClicksToOpen: this.toBigInt(insight.instant_experience_clicks_to_open),
      instantExperienceClicksToStart: this.toBigInt(insight.instant_experience_clicks_to_start),
      instantExperienceOutboundClicks: insight.instant_experience_outbound_clicks || null,

      // === ESTIMATIVAS ===
      estimatedAdRecallRate: this.toDecimal(insight.estimated_ad_recall_rate),
      estimatedAdRecallers: this.toBigInt(insight.estimated_ad_recallers),

      // === CATALOGO ===
      catalogSegmentValue: insight.catalog_segment_value || null,
      catalogSegmentActions: insight.catalog_segment_actions || null,
      catalogSegmentValueMobilePurchaseRoas: insight.catalog_segment_value_mobile_purchase_roas || null,
      catalogSegmentValueOmniPurchaseRoas: insight.catalog_segment_value_omni_purchase_roas || null,
      catalogSegmentValueWebsitePurchaseRoas: insight.catalog_segment_value_website_purchase_roas || null,

      // === RESULTADOS/OBJETIVOS ===
      objectiveResults: insight.objective_results || null,
      objectiveResultRate: insight.objective_result_rate || null,
      resultRate: insight.result_rate || null,
      resultValuesPerformanceIndicator: insight.result_values_performance_indicator || null,

      // === DDA ===
      ddaCountbyConvs: this.toDecimal(insight.dda_countby_convs),
      ddaResults: insight.dda_results || null,

      // === ENGAJAMENTO ADICIONAL ===
      interactiveComponentTap: insight.interactive_component_tap || null,
      instagramUpcomingEventRemindersSet: this.toBigInt(insight.instagram_upcoming_event_reminders_set),

      // === LANDING PAGE ===
      landingPageViewPerLinkClick: this.toDecimal(insight.landing_page_view_per_link_click),
      purchasePerLandingPageView: this.toDecimal(insight.purchase_per_landing_page_view),

      // === MARKETING MESSAGES ===
      marketingMessagesDelivered: this.toBigInt(insight.marketing_messages_delivered),
      marketingMessagesDeliveryRate: this.toDecimal(insight.marketing_messages_delivery_rate),
      marketingMessagesReadRateBenchmark: insight.marketing_messages_read_rate_benchmark || null,

      // === AUCTION ===
      auctionBid: this.toDecimal(insight.auction_bid),
      auctionCompetitiveness: this.toDecimal(insight.auction_competitiveness),
      auctionMaxCompetitorBid: this.toDecimal(insight.auction_max_competitor_bid),
      wishBid: this.toDecimal(insight.wish_bid),

      // === OUTROS ===
      qualifyingQuestionQualifyAnswerRate: this.toDecimal(insight.qualifying_question_qualify_answer_rate),
      shopsAssistedPurchases: insight.shops_assisted_purchases || null,
      totalCardView: insight.total_card_view || null,
      anchorEventAttributionSetting: insight.anchor_event_attribution_setting || null,
      anchorEventsPerformanceIndicator: insight.anchor_events_performance_indicator || null,
      multiEventConversionAttributionSetting: insight.multi_event_conversion_attribution_setting || null,

      // === CONVERTED PRODUCT (Catalogo/E-commerce) ===
      convertedProductQuantity: insight.converted_product_quantity || null,
      convertedProductValue: insight.converted_product_value || null,

      // === REELS / INSTAGRAM (v25.0) ===
      reelsActivity: insight.reels_activity || null,

      // === RESULTADOS CALCULADOS ===
      leads: leads ? BigInt(leads) : null,
      // results: usa valor numerico da API se disponivel, senao usa leads como fallback
      results: (insight.results && typeof insight.results === 'string' && !isNaN(Number(insight.results)))
        ? BigInt(insight.results)
        : (leads ? BigInt(leads) : null),
      cpa: leads > 0 && parseFloat(insight.spend) > 0
        ? new Decimal((parseFloat(insight.spend) / leads).toFixed(6))
        : null,
      cpl: leads > 0 && parseFloat(insight.spend) > 0
        ? new Decimal((parseFloat(insight.spend) / leads).toFixed(6))
        : null,
      conversionRate: leads > 0 && clicks > 0
        ? new Decimal(((leads / clicks) * 100).toFixed(6))
        : null,

      // Fonte de dados
      dataSource: 'meta_api_ads',
    }
  }

  /**
   * Mapeia um insight com breakdown para a tabela AdsBreakdownPerformance
   * Apenas metricas core (~20 campos vs 200+ da AdsPerformance)
   */
  mapBreakdownToDatabase(insight: any, companyId: string, breakdownType: string): any {
    const startDate = new Date(insight.date_start)
    const endDate = new Date(insight.date_stop)
    const leads = this.extractLeads(insight.actions)
    const spend = parseFloat(insight.spend || '0')

    const videoPlays = this.extractVideoValue(insight.video_play_actions)
    const videoThruplay = this.extractVideoValue(insight.video_thruplay_watched_actions)

    return {
      companyId,
      breakdownType,
      breakdownValue: insight[breakdownType] || 'unknown',
      reportStartDate: startDate,
      reportEndDate: endDate,

      // Identification
      accountId: insight.account_id || null,
      accountName: insight.account_name || null,
      externalCampaignId: insight.campaign_id || null,
      campaignName: insight.campaign_name || null,
      adSetId: insight.adset_id || null,
      adSetName: insight.adset_name || null,
      adId: insight.ad_id || null,
      adName: insight.ad_name || null,

      // Core metrics
      impressions: this.toBigInt(insight.impressions),
      reach: this.toBigInt(insight.reach),
      clicks: this.toBigInt(insight.clicks),
      linkClicks: this.toBigInt(insight.inline_link_clicks),
      amountSpent: this.toDecimal(insight.spend),

      // Rates
      ctr: this.toDecimal(insight.ctr),
      cpc: this.toDecimal(insight.cpc),
      cpm: this.toDecimal(insight.cpm),

      // Conversions
      leads: leads ? BigInt(leads) : null,
      results: leads ? BigInt(leads) : null,
      cpa: leads > 0 && spend > 0
        ? new Decimal((spend / leads).toFixed(6))
        : null,

      // Actions (JSON)
      actions: insight.actions || null,
      actionValues: insight.action_values || null,

      // Video core
      videoPlays: videoPlays ? BigInt(videoPlays) : null,
      videoThruplayWatched: videoThruplay ? BigInt(videoThruplay) : null,

      dataSource: 'meta_api_breakdown',
    }
  }

  /**
   * Cria dados de registro zerado (Fase 2)
   */
  buildZeroRecordData(
    item: UniqueItem,
    level: Level,
    startDate: Date,
    endDate: Date,
    companyId: string
  ): any {
    const baseData = {
      reportStartDate: startDate,
      reportEndDate: endDate,
      companyId,
      campaignId: null,

      // Identificacao (vem do item)
      accountId: item.account_id || null,
      accountName: item.account_name || null,
      externalCampaignId: item.campaign_id || null,
      campaignName: item.campaign_name || null,

      // Todas as metricas zeradas
      impressions: BigInt(0),
      reach: BigInt(0),
      frequency: new Decimal(0),
      clicks: BigInt(0),
      uniqueClicks: BigInt(0),
      linkClicks: BigInt(0),
      ctr: new Decimal(0),
      uniqueCtr: new Decimal(0),
      amountSpent: new Decimal(0),
      campaignTotalAdsSpent: new Decimal(0),
      cpm: new Decimal(0),
      cpc: new Decimal(0),
      leads: BigInt(0),
      results: BigInt(0),

      // Fonte de dados
      dataSource: 'meta_api_zero',
    }

    switch (level) {
      case 'campaign':
        return {
          ...baseData,
          adSetId: null,
          adSetName: null,
          adId: null,
          adName: null,
        }

      case 'adset':
        return {
          ...baseData,
          adSetId: item.adset_id || null,
          adSetName: item.adset_name || null,
          adId: null,
          adName: null,
        }

      case 'ad':
      default:
        return {
          ...baseData,
          adSetId: item.adset_id || null,
          adSetName: item.adset_name || null,
          adId: item.ad_id || null,
          adName: item.ad_name || null,
        }
    }
  }

  /**
   * Monta o whereClause para buscar registro existente
   */
  buildWhereClause(
    item: UniqueItem,
    level: Level,
    startDate: Date,
    endDate: Date,
    companyId: string
  ): any {
    const baseClause = {
      companyId,
      reportStartDate: startDate,
      reportEndDate: endDate,
    }

    switch (level) {
      case 'campaign':
        return { ...baseClause, externalCampaignId: item.campaign_id, adSetId: null, adId: null }
      case 'adset':
        return { ...baseClause, adSetId: item.adset_id, adId: null }
      case 'ad':
      default:
        return { ...baseClause, adId: item.ad_id }
    }
  }

  /**
   * Monta whereClause para insight (usando IDs do insight)
   */
  buildWhereClauseFromInsight(
    insight: any,
    level: Level,
    startDate: Date,
    endDate: Date,
    companyId: string
  ): any {
    const baseClause = {
      companyId,
      reportStartDate: startDate,
      reportEndDate: endDate,
    }

    switch (level) {
      case 'campaign':
        return { ...baseClause, externalCampaignId: insight.campaign_id, adSetId: null, adId: null }
      case 'adset':
        return { ...baseClause, adSetId: insight.adset_id, adId: null }
      case 'ad':
      default:
        return { ...baseClause, adId: insight.ad_id }
      case 'account':
        return { ...baseClause, accountId: insight.account_id, adSetId: null, adId: null }
    }
  }
}
