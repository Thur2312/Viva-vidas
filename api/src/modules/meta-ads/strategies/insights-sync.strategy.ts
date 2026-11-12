import { Injectable } from '@nestjs/common'
import { PrismaService } from 'src/database/prisma.service'
import { MetaAdsMapper } from '../mappers/meta-ads.mapper'
import { MetaVideoSourceService } from '../services/meta-video-source.service'
import { BaseSyncStrategy } from './base-sync.strategy'
import { SyncResult, Level } from '../interfaces/meta-ads.interfaces'
import { FULL_INSIGHTS_FIELDS, ESSENTIAL_INSIGHT_FIELDS } from '../constants/meta-ads.constants'

export interface InsightsSyncOptions {
  level?: Level
  timeIncrement?: string | number
  actionAttributionWindows?: string[]
  breakdowns?: string[]
  actionBreakdowns?: string[]
  actionReportTime?: string
  filtering?: { field: string; operator: string; value: string }[]
  sort?: string[]
  useAccountAttributionSetting?: boolean
  useUnifiedAttributionSetting?: boolean
}

/**
 * Estrategia de sincronizacao usando o endpoint /insights
 * Usado para: account, campaign, adset, ou ad sem granularidade diaria
 */
@Injectable()
export class InsightsSyncStrategy extends BaseSyncStrategy {
  constructor(
    prisma: PrismaService,
    mapper: MetaAdsMapper,
    videoSource: MetaVideoSourceService
  ) {
    super(prisma, mapper, videoSource, 'InsightsSyncStrategy')
  }

  async sync(
    companyId: string,
    adAccountId: string,
    accessToken: string,
    datePreset: string,
    options?: InsightsSyncOptions
  ): Promise<SyncResult> {
    const level = options?.level || 'ad'

    this.logger.log(`=== INSIGHTS SYNC STRATEGY ===`)
    this.logger.log(`Company ID: ${companyId}`)
    this.logger.log(`Level: ${level}`)
    this.logger.log(`Date Preset: ${datePreset}`)
    this.logger.log(`Time Increment: ${options?.timeIncrement || 'all_days'}`)
    this.logger.log(`Breakdowns: ${options?.breakdowns?.join(', ') || 'none'}`)

    // Queries pesadas: daily increment com muitos registros usa campos essenciais (~55 vs 124)
    // para evitar erro 99 (timeout/reduce data) na API Meta
    const hasBreakdowns = options?.breakdowns && options.breakdowns.length > 0
    const isDaily = options?.timeIncrement && options.timeIncrement !== 'all_days' && options.timeIncrement !== 'monthly'
    const isHeavyQuery = !!isDaily

    const fields = isHeavyQuery ? ESSENTIAL_INSIGHT_FIELDS : FULL_INSIGHTS_FIELDS
    let limit = 500
    if (hasBreakdowns && isDaily) {
      limit = 50
    } else if (hasBreakdowns || isHeavyQuery) {
      limit = 200
    }
    this.logger.log(`Limit: ${limit}, Fields: ${fields.length} campos (${isHeavyQuery ? 'essential' : 'full'})`)

    // Monta os parametros da requisicao
    const params = new URLSearchParams({
      level,
      fields: fields.join(','),
      access_token: accessToken,
      limit: String(limit),
    })

    // Adiciona filtro de data
    params.append('date_preset', datePreset)

    // Time increment
    if (options?.timeIncrement) {
      params.append('time_increment', String(options.timeIncrement))
    }

    // Action attribution windows
    if (options?.actionAttributionWindows && options.actionAttributionWindows.length > 0) {
      params.append('action_attribution_windows', options.actionAttributionWindows.join(','))
    }

    // Breakdowns - limitado a 1 para evitar combinacoes invalidas
    if (options?.breakdowns && options.breakdowns.length > 0) {
      const validBreakdown = options.breakdowns[0]
      params.append('breakdowns', validBreakdown)
      this.logger.warn(`Breakdowns limitado a 1 para evitar combinacoes invalidas: ${validBreakdown}`)
    }

    // Action breakdowns (default da API: ["action_type"])
    if (options?.actionBreakdowns && options.actionBreakdowns.length > 0) {
      params.append('action_breakdowns', options.actionBreakdowns.join(','))
    }

    // Action report time (impression, conversion, mixed, lifetime)
    if (options?.actionReportTime) {
      params.append('action_report_time', options.actionReportTime)
    }

    // Filtering - array de objetos {field, operator, value}
    if (options?.filtering && options.filtering.length > 0) {
      params.append('filtering', JSON.stringify(options.filtering))
    }

    // Sort (ex: ["reach_descending"])
    if (options?.sort && options.sort.length > 0) {
      params.append('sort', JSON.stringify(options.sort))
    }

    // Use account attribution setting
    if (options?.useAccountAttributionSetting) {
      params.append('use_account_attribution_setting', 'true')
    }

    // Use unified attribution setting (ignora useAccountAttributionSetting)
    if (options?.useUnifiedAttributionSetting) {
      params.append('use_unified_attribution_setting', 'true')
    }

    const url = `${this.META_API_BASE}/${this.META_API_VERSION}/${adAccountId}/insights?${params.toString()}`
    this.logger.log(`URL (sem token): ${this.redactToken(url)}`)

    let allInsights: any[]

    if (isHeavyQuery) {
      // Queries pesadas (daily increment): usar DIRETO o async POST (AdReportRun)
      // GET com time_increment + muitos campos causa erro 99 em contas grandes
      this.logger.log(`Query pesada detectada - usando async report (POST) diretamente`)
      allInsights = await this.fetchWithAsyncReportOrSplit(
        adAccountId,
        accessToken,
        params,
        datePreset,
        level,
        fields,
        options
      )
    } else {
      // Queries leves: usar GET normal com fallback para async
      allInsights = await this.fetchAllPagesWithAsyncFallback(
        url,
        adAccountId,
        accessToken,
        params
      )
    }
    this.logger.log(`=== TOTAL: ${allInsights.length} registros da API Meta ===`)

    if (allInsights.length === 0) {
      this.logger.log(`Nenhum insight retornado. Sync finalizado.`)
      return { synced: 0, errors: 0, zeroRecords: 0 }
    }

    // === FASE 1: Batch sync dos insights ===
    const { start: periodStart, end: periodEnd } = this.getDateRangeFromPreset(datePreset)

    // 1. Batch fetch existing records (1 query)
    const existingMap = await this.batchFetchExisting(companyId, level, periodStart, periodEnd)

    // 2. Classify insights into creates vs updates
    const toCreate: any[] = []
    const toUpdate: { idRecord: bigint; data: any }[] = []
    let errors = 0

    for (const insight of allInsights) {
      try {
        const startDate = new Date(insight.date_start)
        const endDate = new Date(insight.date_stop)

        const data = this.mapper.mapInsightToDatabase(insight, companyId, level)

        const lookupKey = this.buildLookupKey(level, companyId, startDate, endDate, {
          adId: insight.ad_id,
          adSetId: insight.adset_id,
          externalCampaignId: insight.campaign_id,
          accountId: insight.account_id,
        })

        const existingId = existingMap.get(lookupKey)

        if (existingId) {
          // Preserva o campaignId existente — nao sobrescreve vinculos ja feitos
          const { campaignId, ...updateData } = data
          toUpdate.push({ idRecord: existingId, data: updateData })
        } else {
          toCreate.push(data)
        }
      } catch (error) {
        this.logger.error(`Erro ao processar insight: ${error.message}`)
        errors++
      }
    }

    // 3. Batch save (createMany + chunked updates)
    const { created, updated } = await this.batchSave(toCreate, toUpdate)
    const synced = created + updated

    // === FASE 2: Batch create zero records ===
    let zeroRecords = 0
    if ((level === 'ad' || level === 'adset' || level === 'campaign') && allInsights.length > 0) {
      zeroRecords = await this.batchCreateZeroRecords(
        allInsights,
        level,
        companyId,
        datePreset,
        existingMap,
        options?.timeIncrement
      )
    }

    // === FASE 3: Atualizar delivery_status via endpoint de objetos ===
    await this.fetchAndUpdateDeliveryStatuses(
      companyId,
      adAccountId,
      accessToken,
      level,
      periodStart,
      periodEnd
    )

    // === FASE 4: Enriquecer registros com TODOS os campos (FULL_INSIGHTS_FIELDS) ===
    // Queries diarias usam campos essenciais (~55) para evitar erro 99.
    // Esta fase faz uma segunda chamada SEM time_increment (periodo completo = 1 registro por entidade),
    // que e leve o suficiente para usar todos os 124 campos sem travar.
    let enriched = 0
    if (isHeavyQuery && allInsights.length > 0) {
      enriched = await this.enrichWithFullFields(
        companyId,
        adAccountId,
        accessToken,
        datePreset,
        level,
        periodStart,
        periodEnd
      )
    }

    // === FASE 5: Enriquecer thumbnails dos anuncios ===
    if (level === 'ad' && allInsights.length > 0) {
      await this.enrichThumbnails(companyId, adAccountId, accessToken, periodStart, periodEnd)
      await this.enrichVideoUrls(companyId, adAccountId, accessToken, periodStart, periodEnd)
    }

    this.logger.log(`Insights sync completed: ${synced} synced (${created} new, ${updated} updated), ${zeroRecords} zero records, ${enriched} enriched, ${errors} errors`)
    return { synced, errors, zeroRecords }
  }

  /**
   * Fase 4: Enriquece registros diarios com campos extras do FULL_INSIGHTS_FIELDS.
   * Faz uma query SEM time_increment (periodo completo), que retorna 1 registro por entidade.
   * Depois atualiza TODOS os registros diarios daquela entidade com os campos que faltam.
   * Isso e seguro porque campos como attribution_setting, buying_type, created_time, etc.
   * sao os mesmos para todos os dias de uma mesma entidade.
   */
  private async enrichWithFullFields(
    companyId: string,
    adAccountId: string,
    accessToken: string,
    datePreset: string,
    level: string,
    periodStart: Date,
    periodEnd: Date
  ): Promise<number> {
    this.logger.log(`=== FASE 4: Enriquecendo registros com campos completos ===`)

    // Campos extras que nao estao no ESSENTIAL mas estao no FULL
    const essentialSet = new Set(ESSENTIAL_INSIGHT_FIELDS)
    const extraFields = FULL_INSIGHTS_FIELDS.filter(f => !essentialSet.has(f))

    // Precisamos dos campos de identificacao + os extras
    const identificationFields = [
      'account_id', 'campaign_id', 'adset_id', 'ad_id',
    ]
    const fieldsToFetch = [...new Set([...identificationFields, ...extraFields])]

    this.logger.log(`Buscando ${extraFields.length} campos extras para nivel ${level}`)

    const params = new URLSearchParams({
      level,
      fields: fieldsToFetch.join(','),
      access_token: accessToken,
      limit: '500',
      date_preset: datePreset,
      // SEM time_increment = 1 registro por entidade (leve)
    })

    const url = `${this.META_API_BASE}/${this.META_API_VERSION}/${adAccountId}/insights?${params.toString()}`

    try {
      const enrichData = await this.fetchAllPagesWithAsyncFallback(
        url,
        adAccountId,
        accessToken,
        params
      )

      this.logger.log(`Fase 4: ${enrichData.length} registros agregados recebidos`)

      if (enrichData.length === 0) return 0

      let totalEnriched = 0

      for (const insight of enrichData) {
        try {
          // Monta o WHERE para encontrar todos os registros diarios desta entidade
          const whereClause: any = {
            companyId,
            reportStartDate: { gte: periodStart, lte: periodEnd },
          }

          // Filtra por entidade conforme o nivel
          if (level === 'ad' && insight.ad_id) {
            whereClause.adId = insight.ad_id
          } else if (level === 'adset' && insight.adset_id) {
            whereClause.adSetId = insight.adset_id
            whereClause.adId = null
          } else if (level === 'campaign' && insight.campaign_id) {
            whereClause.externalCampaignId = insight.campaign_id
            whereClause.adSetId = null
            whereClause.adId = null
          } else if (level === 'account' && insight.account_id) {
            whereClause.accountId = insight.account_id
            whereClause.externalCampaignId = null
            whereClause.adSetId = null
            whereClause.adId = null
          }

          // Monta os dados extras para update (so campos que nao estao no essential)
          const updateData: any = {}

          // Metadata
          if (insight.attribution_setting) updateData.attributionSetting = insight.attribution_setting
          if (insight.created_time) updateData.metaCreatedTime = insight.created_time
          if (insight.updated_time) updateData.metaUpdatedTime = insight.updated_time

          // CTR extras
          if (insight.unique_link_clicks_ctr) updateData.uniqueLinkClicksCtr = this.mapper['toDecimal'](insight.unique_link_clicks_ctr)
          if (insight.outbound_clicks_ctr) updateData.outboundClicksCtr = insight.outbound_clicks_ctr
          if (insight.unique_outbound_clicks_ctr) updateData.uniqueOutboundClicksCtr = insight.unique_outbound_clicks_ctr
          if (insight.website_ctr) updateData.websiteCtr = insight.website_ctr

          // Custo extras
          if (insight.cost_per_inline_post_engagement) updateData.costPerInlinePostEngagement = this.mapper['toDecimal'](insight.cost_per_inline_post_engagement)
          if (insight.cost_per_unique_inline_link_click) updateData.costPerUniqueInlineLinkClick = this.mapper['toDecimal'](insight.cost_per_unique_inline_link_click)
          if (insight.cost_per_unique_action_type) updateData.costPerUniqueActionType = insight.cost_per_unique_action_type
          if (insight.cost_per_unique_conversion) updateData.costPerUniqueConversion = insight.cost_per_unique_conversion
          if (insight.cost_per_outbound_click) updateData.costPerOutboundClick = insight.cost_per_outbound_click
          if (insight.cost_per_unique_outbound_click) updateData.costPerUniqueOutboundClick = insight.cost_per_unique_outbound_click
          if (insight.cost_per_ad_click) updateData.costPerAdClick = insight.cost_per_ad_click
          if (insight.cost_per_15_sec_video_view) updateData.costPer15SecVideoView = insight.cost_per_15_sec_video_view
          if (insight.cost_per_2_sec_continuous_video_view) updateData.costPer2SecContinuousVideoView = insight.cost_per_2_sec_continuous_video_view
          if (insight.cost_per_one_thousand_ad_impression) updateData.costPerOneThousandAdImpression = insight.cost_per_one_thousand_ad_impression
          if (insight.cost_per_dda_countby_convs) updateData.costPerDdaCountbyConvs = this.mapper['toDecimal'](insight.cost_per_dda_countby_convs)
          if (insight.cost_per_objective_result) updateData.costPerObjectiveResult = insight.cost_per_objective_result
          if (insight.cost_per_result) updateData.costPerResult = insight.cost_per_result

          // Video extras
          if (insight.video_p95_watched_actions) updateData.videoP95Watched = this.mapper['extractVideoValue'](insight.video_p95_watched_actions) ? BigInt(this.mapper['extractVideoValue'](insight.video_p95_watched_actions)) : null
          if (insight.video_30_sec_watched_actions) updateData.video30SecWatched = this.mapper['extractVideoValue'](insight.video_30_sec_watched_actions) ? BigInt(this.mapper['extractVideoValue'](insight.video_30_sec_watched_actions)) : null
          if (insight.video_continuous_2_sec_watched_actions) updateData.videoContinuous2SecWatched = insight.video_continuous_2_sec_watched_actions
          if (insight.video_time_watched_actions) updateData.videoTimeWatched = insight.video_time_watched_actions
          if (insight.video_play_curve_actions) updateData.videoPlayCurveActions = insight.video_play_curve_actions
          if (insight.video_play_retention_0_to_15s_actions) updateData.videoPlayRetention0To15s = insight.video_play_retention_0_to_15s_actions
          if (insight.video_play_retention_20_to_60s_actions) updateData.videoPlayRetention20To60s = insight.video_play_retention_20_to_60s_actions
          if (insight.video_play_retention_graph_actions) updateData.videoPlayRetentionGraph = insight.video_play_retention_graph_actions

          // Conversoes extras
          if (insight.ad_click_actions) updateData.adClickActions = insight.ad_click_actions
          if (insight.ad_impression_actions) updateData.adImpressionActions = insight.ad_impression_actions
          if (insight.unique_actions) updateData.uniqueActions = insight.unique_actions
          if (insight.unique_conversions) updateData.uniqueConversions = insight.unique_conversions
          if (insight.mobile_app_purchase_roas) updateData.mobileAppPurchaseRoas = insight.mobile_app_purchase_roas

          // Canvas/Instant Experience
          if (insight.canvas_avg_view_percent) updateData.canvasAvgViewPercent = this.mapper['toDecimal'](insight.canvas_avg_view_percent)
          if (insight.canvas_avg_view_time) updateData.canvasAvgViewTime = this.mapper['toDecimal'](insight.canvas_avg_view_time)
          if (insight.instant_experience_clicks_to_open) updateData.instantExperienceClicksToOpen = this.mapper['toBigInt'](insight.instant_experience_clicks_to_open)
          if (insight.instant_experience_clicks_to_start) updateData.instantExperienceClicksToStart = this.mapper['toBigInt'](insight.instant_experience_clicks_to_start)
          if (insight.instant_experience_outbound_clicks) updateData.instantExperienceOutboundClicks = insight.instant_experience_outbound_clicks

          // Estimativas
          if (insight.estimated_ad_recall_rate) updateData.estimatedAdRecallRate = this.mapper['toDecimal'](insight.estimated_ad_recall_rate)
          if (insight.estimated_ad_recallers) updateData.estimatedAdRecallers = this.mapper['toBigInt'](insight.estimated_ad_recallers)

          // Catalogo
          if (insight.catalog_segment_value) updateData.catalogSegmentValue = insight.catalog_segment_value
          if (insight.catalog_segment_actions) updateData.catalogSegmentActions = insight.catalog_segment_actions
          if (insight.catalog_segment_value_mobile_purchase_roas) updateData.catalogSegmentValueMobilePurchaseRoas = insight.catalog_segment_value_mobile_purchase_roas
          if (insight.catalog_segment_value_omni_purchase_roas) updateData.catalogSegmentValueOmniPurchaseRoas = insight.catalog_segment_value_omni_purchase_roas
          if (insight.catalog_segment_value_website_purchase_roas) updateData.catalogSegmentValueWebsitePurchaseRoas = insight.catalog_segment_value_website_purchase_roas

          // Resultados/Objetivos
          if (insight.objective_results) updateData.objectiveResults = insight.objective_results
          if (insight.objective_result_rate) updateData.objectiveResultRate = insight.objective_result_rate
          if (insight.result_rate) updateData.resultRate = insight.result_rate
          if (insight.result_values_performance_indicator) updateData.resultValuesPerformanceIndicator = insight.result_values_performance_indicator

          // DDA
          if (insight.dda_countby_convs) updateData.ddaCountbyConvs = this.mapper['toDecimal'](insight.dda_countby_convs)
          if (insight.dda_results) updateData.ddaResults = insight.dda_results

          // Engajamento adicional
          if (insight.interactive_component_tap) updateData.interactiveComponentTap = insight.interactive_component_tap
          if (insight.instagram_upcoming_event_reminders_set) updateData.instagramUpcomingEventRemindersSet = this.mapper['toBigInt'](insight.instagram_upcoming_event_reminders_set)

          // Landing Page
          if (insight.landing_page_view_per_link_click) updateData.landingPageViewPerLinkClick = this.mapper['toDecimal'](insight.landing_page_view_per_link_click)
          if (insight.purchase_per_landing_page_view) updateData.purchasePerLandingPageView = this.mapper['toDecimal'](insight.purchase_per_landing_page_view)

          // Marketing Messages
          if (insight.marketing_messages_delivered) updateData.marketingMessagesDelivered = this.mapper['toBigInt'](insight.marketing_messages_delivered)
          if (insight.marketing_messages_delivery_rate) updateData.marketingMessagesDeliveryRate = this.mapper['toDecimal'](insight.marketing_messages_delivery_rate)
          if (insight.marketing_messages_read_rate_benchmark) updateData.marketingMessagesReadRateBenchmark = insight.marketing_messages_read_rate_benchmark

          // Auction
          if (insight.auction_bid) updateData.auctionBid = this.mapper['toDecimal'](insight.auction_bid)
          if (insight.auction_competitiveness) updateData.auctionCompetitiveness = this.mapper['toDecimal'](insight.auction_competitiveness)
          if (insight.auction_max_competitor_bid) updateData.auctionMaxCompetitorBid = this.mapper['toDecimal'](insight.auction_max_competitor_bid)
          if (insight.wish_bid) updateData.wishBid = this.mapper['toDecimal'](insight.wish_bid)

          // Outros
          if (insight.qualifying_question_qualify_answer_rate) updateData.qualifyingQuestionQualifyAnswerRate = this.mapper['toDecimal'](insight.qualifying_question_qualify_answer_rate)
          if (insight.shops_assisted_purchases) updateData.shopsAssistedPurchases = insight.shops_assisted_purchases
          if (insight.total_card_view) updateData.totalCardView = insight.total_card_view
          if (insight.anchor_event_attribution_setting) updateData.anchorEventAttributionSetting = insight.anchor_event_attribution_setting
          if (insight.anchor_events_performance_indicator) updateData.anchorEventsPerformanceIndicator = insight.anchor_events_performance_indicator
          if (insight.multi_event_conversion_attribution_setting) updateData.multiEventConversionAttributionSetting = insight.multi_event_conversion_attribution_setting

          // So faz update se tem campos extras para atualizar
          if (Object.keys(updateData).length > 0) {
            const result = await this.prisma.adsPerformance.updateMany({
              where: whereClause,
              data: updateData,
            })
            totalEnriched += result.count
          }
        } catch (error) {
          this.logger.error(`Erro ao enriquecer insight: ${error.message}`)
        }
      }

      this.logger.log(`Fase 4 concluida: ${totalEnriched} registros enriquecidos com campos extras`)
      return totalEnriched
    } catch (error) {
      this.rethrowIfMetaAuthError(error)
      this.logger.warn(`Fase 4 falhou (nao critico): ${error.message}`)
      return 0
    }
  }

  /**
   * Para queries pesadas: tenta async report (POST), se falhar divide o periodo em chunks semanais.
   * Isso evita completamente o erro 99 da API Meta.
   */
  private async fetchWithAsyncReportOrSplit(
    adAccountId: string,
    accessToken: string,
    params: URLSearchParams,
    datePreset: string,
    level: string,
    fields: string[],
    options?: InsightsSyncOptions
  ): Promise<any[]> {
    // 1. Tenta async report (POST) diretamente
    try {
      this.logger.log(`Tentando async report (POST /insights)...`)
      return await this.executeAsyncReport(adAccountId, accessToken, params)
    } catch (asyncError) {
      // Sem esta guarda, token morto caia no split semanal e virava 105 chunks de nada.
      this.rethrowIfMetaAuthError(asyncError)
      this.logger.warn(`Async report falhou: ${asyncError.message}`)
      this.logger.log(`Fallback: dividindo periodo em chunks semanais...`)
    }

    // 2. Fallback: dividir o periodo em chunks semanais e fazer GET de cada chunk
    return await this.fetchBySplittingPeriod(
      adAccountId,
      accessToken,
      datePreset,
      level,
      fields,
      options
    )
  }

  /**
   * Divide o periodo em chunks semanais e faz GET separado para cada um.
   * Cada chunk e pequeno o suficiente para o GET normal funcionar.
   */
  private async fetchBySplittingPeriod(
    adAccountId: string,
    accessToken: string,
    datePreset: string,
    level: string,
    fields: string[],
    options?: InsightsSyncOptions
  ): Promise<any[]> {
    const { start, end } = this.getDateRangeFromPreset(datePreset)
    const allInsights: any[] = []

    // Gera chunks de 7 dias
    const chunks: { since: string; until: string }[] = []
    const current = new Date(start)
    while (current <= end) {
      const chunkStart = new Date(current)
      const chunkEnd = new Date(current)
      chunkEnd.setDate(chunkEnd.getDate() + 6) // 7 dias por chunk
      if (chunkEnd > end) chunkEnd.setTime(end.getTime())

      chunks.push({
        since: chunkStart.toISOString().split('T')[0],
        until: chunkEnd.toISOString().split('T')[0],
      })

      current.setDate(current.getDate() + 7)
    }

    this.logger.log(`Periodo dividido em ${chunks.length} chunks semanais`)

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i]
      this.logger.log(`  Chunk ${i + 1}/${chunks.length}: ${chunk.since} a ${chunk.until}`)

      // Monta params para este chunk (usa time_range ao inves de date_preset)
      const chunkParams = new URLSearchParams({
        level,
        fields: fields.join(','),
        access_token: accessToken,
        limit: '200',
        time_range: JSON.stringify({ since: chunk.since, until: chunk.until }),
      })

      // Time increment
      if (options?.timeIncrement) {
        chunkParams.append('time_increment', String(options.timeIncrement))
      }

      // Breakdowns
      if (options?.breakdowns && options.breakdowns.length > 0) {
        chunkParams.append('breakdowns', options.breakdowns[0])
      }

      // Action attribution windows
      if (options?.actionAttributionWindows && options.actionAttributionWindows.length > 0) {
        chunkParams.append('action_attribution_windows', options.actionAttributionWindows.join(','))
      }

      // Action breakdowns
      if (options?.actionBreakdowns && options.actionBreakdowns.length > 0) {
        chunkParams.append('action_breakdowns', options.actionBreakdowns.join(','))
      }

      // Action report time
      if (options?.actionReportTime) {
        chunkParams.append('action_report_time', options.actionReportTime)
      }

      // Filtering
      if (options?.filtering && options.filtering.length > 0) {
        chunkParams.append('filtering', JSON.stringify(options.filtering))
      }

      // Attribution settings
      if (options?.useAccountAttributionSetting) {
        chunkParams.append('use_account_attribution_setting', 'true')
      }
      if (options?.useUnifiedAttributionSetting) {
        chunkParams.append('use_unified_attribution_setting', 'true')
      }

      const chunkUrl = `${this.META_API_BASE}/${this.META_API_VERSION}/${adAccountId}/insights?${chunkParams.toString()}`

      try {
        const chunkData = await this.fetchAllPages(chunkUrl, 300)
        allInsights.push(...chunkData)
        this.logger.log(`  Chunk ${i + 1}: ${chunkData.length} registros (total: ${allInsights.length})`)
      } catch (chunkError) {
        this.rethrowIfMetaAuthError(chunkError)
        this.logger.error(`  Chunk ${i + 1} falhou: ${chunkError.message}`)
        // Tenta async report para este chunk individual
        try {
          this.logger.log(`  Tentando async report para chunk ${i + 1}...`)
          const chunkData = await this.executeAsyncReport(adAccountId, accessToken, chunkParams)
          allInsights.push(...chunkData)
          this.logger.log(`  Chunk ${i + 1} (async): ${chunkData.length} registros (total: ${allInsights.length})`)
        } catch (asyncChunkError) {
          this.rethrowIfMetaAuthError(asyncChunkError)
          this.logger.error(`  Chunk ${i + 1} falhou mesmo com async: ${asyncChunkError.message}`)
        }
      }

      // Delay entre chunks para evitar rate limiting
      if (i < chunks.length - 1) {
        await this.sleep(1000)
      }
    }

    return allInsights
  }
}
