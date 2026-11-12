/**
 * Constantes para o modulo Meta ADS
 * Documentacao: https://developers.facebook.com/docs/marketing-api/reference/ads-insights
 * Versao: v25.0 - TODOS os campos disponiveis
 *
 * CHANGELOG v24.0 -> v25.0:
 * - Attribution windows removidas: 7d_view, 28d_view (efetivo 12/jan/2026)
 * - unique_actions restrito a 4 action_types (link_click, messaging_first_reply, messaging_connection, outbound_click)
 * - Novos campos: reels_activity (Instagram Reels metrics)
 * - Depreciado: smart_promotion_type, metadata=1 parameter (remocao mai/2026)
 * - Retencao de dados: breakdowns 13 meses, frequency 6 meses, agregados 37 meses
 * - action_report_time e use_unified_attribution_setting agora ignorados pela plataforma
 * - Async reports retornam error_code/error_message/error_subcode automaticamente
 */

export const META_API_VERSION = 'v25.0'
export const META_API_VERSION_LEGACY = 'v19.0'
export const META_API_BASE = 'https://graph.facebook.com'

/**
 * Identifica o HDM como plataforma remetente nos eventos da Conversions API.
 *
 * A Meta trata isto como a forma oficial de atribuir eventos a quem os enviou:
 * "To attribute Conversions API events to your platform, use the partner_agent
 * field" (Set up Conversions API as a Platform). Vai no corpo do POST, irmao de
 * `data` -- nao e um campo do evento.
 *
 * Formato exigido: [nome]_[major]_[minor]. A Dataset Quality API normaliza o
 * valor para minusculo e corta nas versoes, entao `hdm_1_0` vira o agent `hdm`.
 * Bumpar as versoes so quando o formato do payload mudar de forma observavel.
 */
export const META_PARTNER_AGENT = 'hdm_1_0'

/**
 * Lado (em px) pedido ao Meta para o thumbnail do criativo.
 *
 * O campo `thumbnail_url` do AdCreative aceita os parametros `thumbnail_width` e
 * `thumbnail_height`. Sem eles a Meta devolve o default minusculo — medido em
 * 30/08/2026: um criativo real veio 64x64 (1,8 KB), e 32 de 40 thumbnails
 * espelhados tinham menos de 20 KB. Esticado num card de ~300x375 isso e o
 * "borrado ate passar o mouse" que o usuario relatou.
 *
 * 1080 e o lado do criativo 1:1/4:5 padrao do Meta; pedir mais nao inventa pixel.
 */
export const THUMBNAIL_TARGET_PX = 1080

/** Prefixo das chaves de thumbnail de anuncio no bucket (MinIO/S3). */
export const THUMBNAIL_STORAGE_PREFIX = 'ads-thumbnails'

/**
 * Sufixo carimbado na chave do objeto espelhado, ex.: `{sha1}-1080.jpg`.
 *
 * Carrega o tamanho na PROPRIA chave para que a correcao se auto-cure: um espelho
 * sem este sufixo foi gravado antes de pedirmos 1080px e volta para a fila de
 * enriquecimento sozinho, sem UPDATE em massa (que dispararia pg_notify por linha)
 * e sem perder a idempotencia — a chave continua derivada do sha1 do path.
 */
export const THUMBNAIL_KEY_SUFFIX = `-${THUMBNAIL_TARGET_PX}`

/**
 * Teto de anuncios que cada fase de enriquecimento cura POR SYNC, fora da janela de datas.
 *
 * As fases de thumbnail e video sempre filtraram por `report_start_date/report_end_date`
 * da janela sincronizada. Isso limita o custo — sao chamadas a Graph API em lotes de 50
 * mais o download de cada imagem — mas tambem faz com que anuncio sem entrega no periodo
 * NUNCA seja reprocessado. Na TFA isso deixou 4 de 6 criativos congelados: pararam de
 * veicular em 16/07 e o preset padrao da tela e "Este mes".
 *
 * A saida nao e remover o filtro (uma empresa com 118 mil linhas re-enriqueceria tudo a
 * cada sync), e sim deixar os ramos de AUTO-CURA escaparem dele com um teto: cada sync
 * cura um pedaco, do mais antigo para o mais novo, e a base converge sozinha.
 */
export const ENRICHMENT_SELF_HEAL_LIMIT = 200

/**
 * Largura minima aceitavel para um espelho de thumbnail parar de ser reprocessado.
 *
 * A chave do espelho carrega a largura MEDIDA (`{sha1}-1080.jpg`). Exigir exatamente
 * `THUMBNAIL_TARGET_PX` faria criativo que a Meta so tem em 800px voltar para a fila em
 * todo sync, baixando o mesmo arquivo para sempre. 600px ja cobre com folga o card de
 * ~300x375 em telas 2x, entao dai para cima o espelho e considerado final.
 */
export const THUMBNAIL_ACCEPTABLE_PX = 600

// ============================================================================
// CAMPOS DA API - DOCUMENTACAO OFICIAL META GRAPH API v25.0
// https://developers.facebook.com/docs/marketing-api/reference/ads-insights
//
// BREAKING CHANGES v25.0:
// - Attribution windows 7d_view e 28d_view REMOVIDAS (desde 12/jan/2026)
// - unique_actions so retorna dados para: link_click, onsite_conversion_messaging_first_reply,
//   onsite_conversion_total_messaging_connection, outbound_click (100+ action types depreciados)
// - action_report_time e use_unified_attribution_setting ignorados pela plataforma
// - Retencao de dados: breakdowns 13 meses, frequency 6 meses, agregados 37 meses
// ============================================================================
//
// MAPEAMENTO COMPLETO: API Meta -> Banco de Dados AdsPerformance
// ============================================================================
//
// === IDENTIFICACAO ===
// account_id          -> accountId (String)
// account_name        -> accountName (String)
// account_currency    -> accountCurrency (String)
// campaign_id         -> externalCampaignId (String)
// campaign_name       -> campaignName (String)
// adset_id            -> adSetId (String)
// adset_name          -> adSetName (String)
// ad_id               -> adId (String)
// ad_name             -> adName (String)
// date_start          -> reportStartDate (Date)
// date_stop           -> reportEndDate (Date)
//
// === METADATA DA CAMPANHA ===
// objective           -> objective (String)
// optimization_goal   -> optimizationGoal (String)
// buying_type         -> buyingType (String)
// attribution_setting -> attributionSetting (String)
// created_time        -> metaCreatedTime (String)
// updated_time        -> metaUpdatedTime (String)
//
// === METRICAS DE ALCANCE ===
// impressions         -> impressions (BigInt)
// reach               -> reach (BigInt)
// frequency           -> frequency (Decimal)
// frequency_value     -> (BREAKDOWN, nao field - usar no parametro breakdowns)
// full_view_impressions -> fullViewImpressions (BigInt)
// full_view_reach     -> fullViewReach (BigInt)
//
// === METRICAS DE CLIQUES ===
// clicks              -> clicks (BigInt)
// inline_link_clicks  -> linkClicks (BigInt)
// inline_post_engagement -> inlinePostEngagement (BigInt)
// unique_clicks       -> uniqueClicks (BigInt)
// unique_inline_link_clicks -> uniqueInlineLinkClicks (BigInt)
// outbound_clicks     -> outboundClicks (JSON)
// unique_outbound_clicks -> uniqueOutboundClicks (JSON)
//
// === TAXAS (CTR) ===
// ctr                 -> ctr (Decimal)
// unique_ctr          -> uniqueCtr (Decimal)
// inline_link_click_ctr -> inlineLinkClickCtr (Decimal)
// unique_link_clicks_ctr -> uniqueLinkClicksCtr (Decimal)
// outbound_clicks_ctr -> outboundClicksCtr (JSON)
// unique_outbound_clicks_ctr -> uniqueOutboundClicksCtr (JSON)
// website_ctr         -> websiteCtr (JSON)
//
// === METRICAS DE CUSTO ===
// spend               -> amountSpent (Decimal)
// cpc                 -> cpc (Decimal)
// cpm                 -> cpm (Decimal)
// cpp                 -> costPer1kReach (Decimal)
// cost_per_inline_link_click -> costPerInlineLinkClick (Decimal)
// cost_per_inline_post_engagement -> costPerInlinePostEngagement (Decimal)
// cost_per_unique_click -> costPerUniqueClick (Decimal)
// cost_per_unique_inline_link_click -> costPerUniqueInlineLinkClick (Decimal)
// cost_per_thruplay   -> costPerThruplay (JSON)
// cost_per_action_type -> costPerActionType (JSON)
// cost_per_conversion -> costPerConversion (JSON)
// cost_per_unique_action_type -> costPerUniqueActionType (JSON)
// cost_per_unique_conversion -> costPerUniqueConversion (JSON)
// cost_per_outbound_click -> costPerOutboundClick (JSON)
// cost_per_unique_outbound_click -> costPerUniqueOutboundClick (JSON)
// cost_per_ad_click   -> costPerAdClick (JSON)
// cost_per_15_sec_video_view -> costPer15SecVideoView (JSON)
// cost_per_2_sec_continuous_video_view -> costPer2SecContinuousVideoView (JSON)
// cost_per_one_thousand_ad_impression -> costPerOneThousandAdImpression (JSON)
// cost_per_dda_countby_convs -> costPerDdaCountbyConvs (Decimal)
// cost_per_objective_result -> costPerObjectiveResult (JSON)
// cost_per_result     -> costPerResult (JSON)
//
// === METRICAS DE VIDEO ===
// video_play_actions  -> videoPlays (BigInt - extrair [0].value)
// video_p25_watched_actions -> videoP25Watched (BigInt)
// video_p50_watched_actions -> videoP50Watched (BigInt)
// video_p75_watched_actions -> videoP75Watched (BigInt)
// video_p95_watched_actions -> videoP95Watched (BigInt)
// video_p100_watched_actions -> videoP100Watched (BigInt)
// video_30_sec_watched_actions -> video30SecWatched (BigInt)
// video_avg_time_watched_actions -> videoAvgTimeWatched (Decimal)
// video_thruplay_watched_actions -> videoThruplayWatched (BigInt)
// video_continuous_2_sec_watched_actions -> videoContinuous2SecWatched (JSON)
// video_time_watched_actions -> videoTimeWatched (JSON)
// video_play_curve_actions -> videoPlayCurveActions (JSON)
// video_play_retention_0_to_15s_actions -> videoPlayRetention0To15s (JSON)
// video_play_retention_20_to_60s_actions -> videoPlayRetention20To60s (JSON)
// video_play_retention_graph_actions -> videoPlayRetentionGraph (JSON)
//
// === ENGAJAMENTO SOCIAL ===
// social_spend        -> socialSpend (Decimal)
//
// === QUALIDADE E RANKING ===
// quality_ranking     -> qualityRanking (String)
// engagement_rate_ranking -> engagementRateRanking (String)
// conversion_rate_ranking -> conversionRateRanking (String)
//
// === CONVERSOES E ACOES (JSON) ===
// actions             -> actions (JSON)
// action_values       -> actionValues (JSON)
// ad_click_actions    -> adClickActions (JSON)
// ad_impression_actions -> adImpressionActions (JSON)
// unique_actions      -> uniqueActions (JSON)
// conversions         -> conversions (JSON)
// conversion_values   -> conversionValues (JSON)
// unique_conversions  -> uniqueConversions (JSON)
// purchase_roas       -> purchaseRoas (JSON)
// website_purchase_roas -> websitePurchaseRoas (JSON)
// mobile_app_purchase_roas -> mobileAppPurchaseRoas (JSON)
//
// === CANVAS/INSTANT EXPERIENCE ===
// canvas_avg_view_percent -> canvasAvgViewPercent (Decimal)
// canvas_avg_view_time -> canvasAvgViewTime (Decimal)
// instant_experience_clicks_to_open -> instantExperienceClicksToOpen (BigInt)
// instant_experience_clicks_to_start -> instantExperienceClicksToStart (BigInt)
// instant_experience_outbound_clicks -> instantExperienceOutboundClicks (JSON)
//
// === ESTIMATIVAS ===
// estimated_ad_recall_rate -> estimatedAdRecallRate (Decimal)
// estimated_ad_recallers -> estimatedAdRecallers (BigInt)
//
// === CATALOGO ===
// catalog_segment_value -> catalogSegmentValue (JSON)
// catalog_segment_actions -> catalogSegmentActions (JSON)
// catalog_segment_value_mobile_purchase_roas -> catalogSegmentValueMobilePurchaseRoas (JSON)
// catalog_segment_value_omni_purchase_roas -> catalogSegmentValueOmniPurchaseRoas (JSON)
// catalog_segment_value_website_purchase_roas -> catalogSegmentValueWebsitePurchaseRoas (JSON)
//
// === RESULTADOS/OBJETIVOS ===
// objective_results   -> objectiveResults (JSON)
// objective_result_rate -> objectiveResultRate (JSON)
// result_rate         -> resultRate (JSON)
// result_values_performance_indicator -> resultValuesPerformanceIndicator (String)
//
// === DDA (Data-Driven Attribution) ===
// dda_countby_convs   -> ddaCountbyConvs (Decimal)
// dda_results         -> ddaResults (JSON)
//
// === ENGAJAMENTO ADICIONAL ===
// interactive_component_tap -> interactiveComponentTap (JSON)
// instagram_upcoming_event_reminders_set -> instagramUpcomingEventRemindersSet (BigInt)
//
// === LANDING PAGE ===
// landing_page_view_per_link_click -> landingPageViewPerLinkClick (Decimal)
// purchase_per_landing_page_view -> purchasePerLandingPageView (Decimal)
//
// === MARKETING MESSAGES ===
// marketing_messages_delivered -> marketingMessagesDelivered (BigInt)
// marketing_messages_delivery_rate -> marketingMessagesDeliveryRate (Decimal)
// marketing_messages_read_rate_benchmark -> marketingMessagesReadRateBenchmark (String)
//
// === WEBSITE ===
// website_ctr         -> websiteCtr (JSON)
//
// === AUCTION ===
// auction_bid         -> auctionBid (Decimal)
// auction_competitiveness -> auctionCompetitiveness (Decimal)
// auction_max_competitor_bid -> auctionMaxCompetitorBid (Decimal)
// wish_bid            -> wishBid (Decimal)
//
// === OUTROS ===
// qualifying_question_qualify_answer_rate -> qualifyingQuestionQualifyAnswerRate (Decimal)
// shops_assisted_purchases -> shopsAssistedPurchases (String)
// total_card_view     -> totalCardView (String)
// anchor_event_attribution_setting -> anchorEventAttributionSetting (String)
// anchor_events_performance_indicator -> anchorEventsPerformanceIndicator (String)
// multi_event_conversion_attribution_setting -> multiEventConversionAttributionSetting (String)
//
// === CAMPOS CALCULADOS (nao vem da API) ===
// leads = extraido de actions onde action_type = 'lead' ou 'leadgen.other'
// results (calculado) = igual a leads
// cpa = spend / results (se results > 0)
// cpl = spend / leads (se leads > 0)
// ============================================================================

/**
 * TODOS os campos disponiveis na API Meta v25.0 para endpoint /insights
 * Excluindo: breakdowns, assets/criativos, SKAdNetwork, e campos que requerem breakdown especifico
 *
 * NOTAS v25.0:
 * - unique_actions e cost_per_unique_action_type mantidos mas so retornam dados para 4 action_types
 * - reels_activity NAO e valido em `fields` de Ads Insights (erro #100); nao pedir. Coluna reelsActivity segue no banco, sem dados novos.
 * - Campos existentes (reach, impressions) continuam funcionando - "views" e para Page/Post Insights, nao Ads Insights
 */
export const FULL_INSIGHTS_FIELDS = [
  // === IDENTIFICACAO ===
  'account_id',
  'account_name',
  'account_currency',
  'campaign_id',
  'campaign_name',
  'adset_id',
  'adset_name',
  'ad_id',
  'ad_name',

  // === METADATA DA CAMPANHA ===
  'objective',
  'optimization_goal',
  'buying_type',
  'attribution_setting',
  'created_time',
  'updated_time',

  // === METRICAS DE ALCANCE ===
  'impressions',
  'reach',
  'frequency',
  // frequency_value e um breakdown, nao um field - usar no parametro breakdowns
  'full_view_impressions',
  'full_view_reach',

  // === METRICAS DE CLIQUES ===
  'clicks',
  'unique_clicks',
  'inline_link_clicks',
  'inline_post_engagement',
  'unique_inline_link_clicks',
  'outbound_clicks',
  'unique_outbound_clicks',

  // === TAXAS (CTR) ===
  'ctr',
  'unique_ctr',
  'inline_link_click_ctr',
  'unique_link_clicks_ctr',
  'outbound_clicks_ctr',
  'unique_outbound_clicks_ctr',
  'website_ctr',

  // === METRICAS DE CUSTO ===
  'spend',
  'cpc',
  'cpm',
  'cpp',
  'cost_per_inline_link_click',
  'cost_per_inline_post_engagement',
  'cost_per_unique_click',
  'cost_per_unique_inline_link_click',
  'cost_per_thruplay',
  'cost_per_action_type',
  'cost_per_conversion',
  'cost_per_unique_action_type',
  'cost_per_unique_conversion',
  'cost_per_outbound_click',
  'cost_per_unique_outbound_click',
  'cost_per_ad_click',
  'cost_per_15_sec_video_view',
  'cost_per_2_sec_continuous_video_view',
  'cost_per_one_thousand_ad_impression',
  'cost_per_dda_countby_convs',
  'cost_per_objective_result',
  'cost_per_result',

  // === METRICAS DE VIDEO ===
  'video_play_actions',
  'video_p25_watched_actions',
  'video_p50_watched_actions',
  'video_p75_watched_actions',
  'video_p95_watched_actions',
  'video_p100_watched_actions',
  'video_30_sec_watched_actions',
  'video_avg_time_watched_actions',
  'video_thruplay_watched_actions',
  'video_continuous_2_sec_watched_actions',
  'video_time_watched_actions',
  'video_play_curve_actions',
  'video_play_retention_0_to_15s_actions',
  'video_play_retention_20_to_60s_actions',
  'video_play_retention_graph_actions',

  // === ENGAJAMENTO SOCIAL ===
  'social_spend',

  // === QUALIDADE E RANKING ===
  'quality_ranking',
  'engagement_rate_ranking',
  'conversion_rate_ranking',

  // === CONVERSOES E ACOES (JSON) ===
  'actions',
  'action_values',
  'ad_click_actions',
  'ad_impression_actions',
  'unique_actions',
  'conversions',
  'conversion_values',
  'unique_conversions',
  'purchase_roas',
  'website_purchase_roas',
  'mobile_app_purchase_roas',

  // === CANVAS/INSTANT EXPERIENCE ===
  'canvas_avg_view_percent',
  'canvas_avg_view_time',
  'instant_experience_clicks_to_open',
  'instant_experience_clicks_to_start',
  'instant_experience_outbound_clicks',

  // === ESTIMATIVAS ===
  'estimated_ad_recall_rate',
  'estimated_ad_recallers',

  // === CATALOGO ===
  'catalog_segment_value',
  'catalog_segment_actions',
  'catalog_segment_value_mobile_purchase_roas',
  'catalog_segment_value_omni_purchase_roas',
  'catalog_segment_value_website_purchase_roas',

  // === RESULTADOS/OBJETIVOS ===
  'objective_results',
  'objective_result_rate',
  'result_rate',
  'result_values_performance_indicator',

  // === DDA (Data-Driven Attribution) ===
  'dda_countby_convs',
  'dda_results',

  // === ENGAJAMENTO ADICIONAL ===
  'interactive_component_tap',
  'instagram_upcoming_event_reminders_set',

  // === LANDING PAGE ===
  'landing_page_view_per_link_click',
  'purchase_per_landing_page_view',

  // === MARKETING MESSAGES ===
  'marketing_messages_delivered',
  'marketing_messages_delivery_rate',
  'marketing_messages_read_rate_benchmark',

  // === AUCTION ===
  'auction_bid',
  'auction_competitiveness',
  'auction_max_competitor_bid',
  'wish_bid',

  // === RESULTADOS ===
  'results',

  // === CONVERTED PRODUCT (Catalogo/E-commerce) ===
  'converted_product_quantity',
  'converted_product_value',

  // === OUTROS ===
  // activity_recency - aparece na doc mas a API rejeita como field
  'qualifying_question_qualify_answer_rate',
  'shops_assisted_purchases',
  'total_card_view',
  // user_segment_key - aparece na doc mas a API rejeita como field
  'anchor_event_attribution_setting',
  'anchor_events_performance_indicator',
  'multi_event_conversion_attribution_setting',

  // reels_activity NAO entra: a Graph API rejeita ((#100) not valid for fields param) e derruba o sync inteiro.
]

/**
 * Campos para endpoint /insights em tempo real (sem salvar no banco)
 * Subconjunto otimizado para consultas rapidas
 */
export const REALTIME_INSIGHT_FIELDS = [
  'account_id', 'account_name', 'account_currency',
  'campaign_id', 'campaign_name',
  'adset_id', 'adset_name',
  'ad_id', 'ad_name',
  'objective',
  'impressions', 'reach', 'frequency',
  'clicks', 'unique_clicks', 'inline_link_clicks',
  'ctr', 'unique_ctr',
  'spend', 'cpm', 'cpc', 'cpp',
  'quality_ranking', 'engagement_rate_ranking', 'conversion_rate_ranking',
  'actions', 'action_values',
  'video_play_actions', 'video_thruplay_watched_actions',
]

/**
 * Campos essenciais para queries pesadas (ad + daily + periodo longo)
 * ~40 campos vs 100+ do FULL_INSIGHTS_FIELDS
 * Cobre todas as metricas usadas no dashboard e analytics
 */
export const ESSENTIAL_INSIGHT_FIELDS = [
  // Identificacao
  'account_id', 'account_name', 'account_currency',
  'campaign_id', 'campaign_name',
  'adset_id', 'adset_name',
  'ad_id', 'ad_name',

  // Metadata
  'objective', 'optimization_goal', 'buying_type',

  // Alcance
  'impressions', 'reach', 'frequency',
  'full_view_impressions', 'full_view_reach',

  // Cliques
  'clicks', 'unique_clicks', 'inline_link_clicks',
  'inline_post_engagement', 'unique_inline_link_clicks',
  'outbound_clicks', 'unique_outbound_clicks',

  // Taxas
  'ctr', 'unique_ctr', 'inline_link_click_ctr',

  // Custo
  'spend', 'cpc', 'cpm', 'cpp',
  'cost_per_inline_link_click', 'cost_per_unique_click',
  'cost_per_thruplay', 'cost_per_action_type', 'cost_per_conversion',

  // Video (essenciais)
  'video_play_actions', 'video_p25_watched_actions',
  'video_p50_watched_actions', 'video_p75_watched_actions',
  'video_p100_watched_actions', 'video_thruplay_watched_actions',
  'video_avg_time_watched_actions',

  // Social
  'social_spend',

  // Qualidade
  'quality_ranking', 'engagement_rate_ranking', 'conversion_rate_ranking',

  // Conversoes (essenciais)
  'actions', 'action_values',
  'conversions', 'conversion_values',
  'purchase_roas', 'website_purchase_roas',

  // Estimativas
  'estimated_ad_recall_rate', 'estimated_ad_recallers',
]

/**
 * Campos para endpoint /ads com insights aninhados
 * Derivado de FULL_INSIGHTS_FIELDS, removendo campos de identificacao
 * que ja vem do objeto ad (ad_id, ad_name, adset_id, adset_name, campaign_id, campaign_name)
 * O endpoint /ads usa limit=50 + paginacao para evitar timeout
 */
const ADS_EXCLUDED_FIELDS = new Set([
  'ad_id', 'ad_name',
  'adset_id', 'adset_name',
  'campaign_id', 'campaign_name',
])
export const ADS_ENDPOINT_INSIGHT_FIELDS = FULL_INSIGHTS_FIELDS.filter(
  field => !ADS_EXCLUDED_FIELDS.has(field)
)

/**
 * Status de ads a serem buscados no endpoint /ads
 */
export const ADS_EFFECTIVE_STATUSES = [
  'ACTIVE',
  'PAUSED',
  'PENDING_REVIEW',
  'DISAPPROVED',
  'PREAPPROVED',
  'PENDING_BILLING_INFO',
  'CAMPAIGN_PAUSED',
  'ARCHIVED',
  'ADSET_PAUSED',
]

/**
 * Campos COMPLETOS para buscar campanhas (todos os campos disponiveis v25.0)
 */
export const CAMPAIGN_INSIGHT_FIELDS = [
  // Identificacao
  'account_id',
  'account_name',
  'account_currency',
  'campaign_name',
  'campaign_id',

  // Metadata
  'objective',
  'optimization_goal',
  'buying_type',
  'attribution_setting',
  'created_time',
  'updated_time',

  // Metricas de alcance
  'impressions',
  'reach',
  'frequency',
  // frequency_value e um breakdown, nao um field - usar no parametro breakdowns
  'full_view_impressions',
  'full_view_reach',

  // Metricas de cliques
  'clicks',
  'unique_clicks',
  'inline_link_clicks',
  'inline_post_engagement',
  'unique_inline_link_clicks',
  'outbound_clicks',
  'unique_outbound_clicks',

  // Taxas (CTR)
  'ctr',
  'unique_ctr',
  'inline_link_click_ctr',
  'unique_link_clicks_ctr',
  'outbound_clicks_ctr',
  'unique_outbound_clicks_ctr',
  'website_ctr',

  // Metricas de custo
  'spend',
  'cpc',
  'cpm',
  'cpp',
  'cost_per_inline_link_click',
  'cost_per_inline_post_engagement',
  'cost_per_unique_click',
  'cost_per_unique_inline_link_click',
  'cost_per_thruplay',
  'cost_per_action_type',
  'cost_per_conversion',
  'cost_per_unique_action_type',
  'cost_per_unique_conversion',
  'cost_per_outbound_click',
  'cost_per_unique_outbound_click',
  'cost_per_ad_click',
  'cost_per_15_sec_video_view',
  'cost_per_2_sec_continuous_video_view',
  'cost_per_one_thousand_ad_impression',
  'cost_per_dda_countby_convs',
  'cost_per_objective_result',
  'cost_per_result',

  // Metricas de video
  'video_play_actions',
  'video_p25_watched_actions',
  'video_p50_watched_actions',
  'video_p75_watched_actions',
  'video_p95_watched_actions',
  'video_p100_watched_actions',
  'video_30_sec_watched_actions',
  'video_avg_time_watched_actions',
  'video_thruplay_watched_actions',
  'video_continuous_2_sec_watched_actions',
  'video_time_watched_actions',
  'video_play_curve_actions',
  'video_play_retention_0_to_15s_actions',
  'video_play_retention_20_to_60s_actions',
  'video_play_retention_graph_actions',

  // Engajamento social
  'social_spend',

  // Qualidade e ranking
  'quality_ranking',
  'engagement_rate_ranking',
  'conversion_rate_ranking',

  // Conversoes e acoes (JSON)
  'actions',
  'action_values',
  'ad_click_actions',
  'ad_impression_actions',
  'unique_actions',
  'conversions',
  'conversion_values',
  'unique_conversions',
  'purchase_roas',
  'website_purchase_roas',
  'mobile_app_purchase_roas',

  // Canvas/Instant Experience
  'canvas_avg_view_percent',
  'canvas_avg_view_time',
  'instant_experience_clicks_to_open',
  'instant_experience_clicks_to_start',
  'instant_experience_outbound_clicks',

  // Estimativas
  'estimated_ad_recall_rate',
  'estimated_ad_recallers',

  // Catalogo
  'catalog_segment_value',
  'catalog_segment_actions',
  'catalog_segment_value_mobile_purchase_roas',
  'catalog_segment_value_omni_purchase_roas',
  'catalog_segment_value_website_purchase_roas',

  // Resultados/Objetivos
  'objective_results',
  'objective_result_rate',
  'result_rate',
  'result_values_performance_indicator',

  // DDA
  'dda_countby_convs',
  'dda_results',

  // Engajamento adicional
  'interactive_component_tap',
  'instagram_upcoming_event_reminders_set',

  // Landing Page
  'landing_page_view_per_link_click',
  'purchase_per_landing_page_view',

  // Marketing Messages
  'marketing_messages_delivered',
  'marketing_messages_delivery_rate',
  'marketing_messages_read_rate_benchmark',

  // Auction
  'auction_bid',
  'auction_competitiveness',
  'auction_max_competitor_bid',
  'wish_bid',

  // Resultados
  'results',

  // Converted Product
  'converted_product_quantity',
  'converted_product_value',

  // Outros
  // activity_recency - aparece na doc mas a API rejeita como field
  'qualifying_question_qualify_answer_rate',
  'shops_assisted_purchases',
  'total_card_view',
  // user_segment_key - aparece na doc mas a API rejeita como field
  'anchor_event_attribution_setting',
  'anchor_events_performance_indicator',
  'multi_event_conversion_attribution_setting',

]

/**
 * Breakdowns suportados para sincronizacao em tabela separada (ads_breakdown_performance)
 * Cada breakdown gera rows separados com dimension type + value
 *
 * NOTA v25.0: hourly_stats tem retencao de apenas 13 meses
 * NOTA v25.0: frequency_value tem retencao de apenas 6 meses
 */
export const SUPPORTED_BREAKDOWNS = [
  'age',
  'gender',
  'publisher_platform',
  'platform_position',
  'device_platform',
  'impression_device',
  'country',
  'region',
] as const

/**
 * Campos leves para buscar insights com breakdowns (~22 campos)
 * Apenas metricas core + identificacao + actions + video essencial
 */
export const BREAKDOWN_INSIGHT_FIELDS = [
  // Identificacao
  'account_id',
  'account_name',
  'campaign_id',
  'campaign_name',
  'adset_id',
  'adset_name',
  'ad_id',
  'ad_name',

  // Metricas de alcance
  'impressions',
  'reach',

  // Cliques
  'clicks',
  'inline_link_clicks',

  // Custo
  'spend',
  'cpc',
  'cpm',

  // Taxas
  'ctr',

  // Conversoes
  'actions',
  'action_values',

  // Video core
  'video_play_actions',
  'video_thruplay_watched_actions',
]

/**
 * Campos COMPLETOS para buscar adsets (todos os campos disponiveis v25.0)
 */
export const ADSET_INSIGHT_FIELDS = [
  // Identificacao
  'account_id',
  'account_name',
  'account_currency',
  'campaign_name',
  'campaign_id',
  'adset_name',
  'adset_id',

  // Metadata
  'objective',
  'optimization_goal',
  'buying_type',
  'attribution_setting',
  'created_time',
  'updated_time',

  // Metricas de alcance
  'impressions',
  'reach',
  'frequency',
  // frequency_value e um breakdown, nao um field - usar no parametro breakdowns
  'full_view_impressions',
  'full_view_reach',

  // Metricas de cliques
  'clicks',
  'unique_clicks',
  'inline_link_clicks',
  'inline_post_engagement',
  'unique_inline_link_clicks',
  'outbound_clicks',
  'unique_outbound_clicks',

  // Taxas (CTR)
  'ctr',
  'unique_ctr',
  'inline_link_click_ctr',
  'unique_link_clicks_ctr',
  'outbound_clicks_ctr',
  'unique_outbound_clicks_ctr',
  'website_ctr',

  // Metricas de custo
  'spend',
  'cpc',
  'cpm',
  'cpp',
  'cost_per_inline_link_click',
  'cost_per_inline_post_engagement',
  'cost_per_unique_click',
  'cost_per_unique_inline_link_click',
  'cost_per_thruplay',
  'cost_per_action_type',
  'cost_per_conversion',
  'cost_per_unique_action_type',
  'cost_per_unique_conversion',
  'cost_per_outbound_click',
  'cost_per_unique_outbound_click',
  'cost_per_ad_click',
  'cost_per_15_sec_video_view',
  'cost_per_2_sec_continuous_video_view',
  'cost_per_one_thousand_ad_impression',
  'cost_per_dda_countby_convs',
  'cost_per_objective_result',
  'cost_per_result',

  // Metricas de video
  'video_play_actions',
  'video_p25_watched_actions',
  'video_p50_watched_actions',
  'video_p75_watched_actions',
  'video_p95_watched_actions',
  'video_p100_watched_actions',
  'video_30_sec_watched_actions',
  'video_avg_time_watched_actions',
  'video_thruplay_watched_actions',
  'video_continuous_2_sec_watched_actions',
  'video_time_watched_actions',
  'video_play_curve_actions',
  'video_play_retention_0_to_15s_actions',
  'video_play_retention_20_to_60s_actions',
  'video_play_retention_graph_actions',

  // Engajamento social
  'social_spend',

  // Qualidade e ranking
  'quality_ranking',
  'engagement_rate_ranking',
  'conversion_rate_ranking',

  // Conversoes e acoes (JSON)
  'actions',
  'action_values',
  'ad_click_actions',
  'ad_impression_actions',
  'unique_actions',
  'conversions',
  'conversion_values',
  'unique_conversions',
  'purchase_roas',
  'website_purchase_roas',
  'mobile_app_purchase_roas',

  // Canvas/Instant Experience
  'canvas_avg_view_percent',
  'canvas_avg_view_time',
  'instant_experience_clicks_to_open',
  'instant_experience_clicks_to_start',
  'instant_experience_outbound_clicks',

  // Estimativas
  'estimated_ad_recall_rate',
  'estimated_ad_recallers',

  // Catalogo
  'catalog_segment_value',
  'catalog_segment_actions',
  'catalog_segment_value_mobile_purchase_roas',
  'catalog_segment_value_omni_purchase_roas',
  'catalog_segment_value_website_purchase_roas',

  // Resultados/Objetivos
  'objective_results',
  'objective_result_rate',
  'result_rate',
  'result_values_performance_indicator',

  // DDA
  'dda_countby_convs',
  'dda_results',

  // Engajamento adicional
  'interactive_component_tap',
  'instagram_upcoming_event_reminders_set',

  // Landing Page
  'landing_page_view_per_link_click',
  'purchase_per_landing_page_view',

  // Marketing Messages
  'marketing_messages_delivered',
  'marketing_messages_delivery_rate',
  'marketing_messages_read_rate_benchmark',

  // Auction
  'auction_bid',
  'auction_competitiveness',
  'auction_max_competitor_bid',
  'wish_bid',

  // Resultados
  'results',

  // Converted Product
  'converted_product_quantity',
  'converted_product_value',

  // Outros
  // activity_recency - aparece na doc mas a API rejeita como field
  'qualifying_question_qualify_answer_rate',
  'shops_assisted_purchases',
  'total_card_view',
  // user_segment_key - aparece na doc mas a API rejeita como field
  'anchor_event_attribution_setting',
  'anchor_events_performance_indicator',
  'multi_event_conversion_attribution_setting',

]
