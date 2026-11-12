import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsNotEmpty, IsOptional, IsString, IsEnum, IsBoolean, IsInt, IsIn, IsArray, ValidateNested } from 'class-validator'
import { Type } from 'class-transformer'

export enum DatePreset {
  TODAY = 'today',
  YESTERDAY = 'yesterday',
  THIS_MONTH = 'this_month',
  LAST_MONTH = 'last_month',
  THIS_QUARTER = 'this_quarter',
  MAXIMUM = 'maximum',
  DATA_MAXIMUM = 'data_maximum',
  LAST_3_DAYS = 'last_3d',
  LAST_7_DAYS = 'last_7d',
  LAST_14_DAYS = 'last_14d',
  LAST_28_DAYS = 'last_28d',
  LAST_30_DAYS = 'last_30d',
  LAST_90_DAYS = 'last_90d',
  LAST_WEEK_MON_SUN = 'last_week_mon_sun',
  LAST_WEEK_SUN_SAT = 'last_week_sun_sat',
  LAST_QUARTER = 'last_quarter',
  LAST_YEAR = 'last_year',
  THIS_WEEK_MON_TODAY = 'this_week_mon_today',
  THIS_WEEK_SUN_TODAY = 'this_week_sun_today',
  THIS_YEAR = 'this_year',
}

export enum Level {
  AD = 'ad',
  ADSET = 'adset',
  CAMPAIGN = 'campaign',
  ACCOUNT = 'account',
}

export enum ActionAttributionWindow {
  ONE_DAY_VIEW = '1d_view',
  /** @deprecated Removido na v25.0 (efetivo 12/jan/2026). Usar 1d_view como alternativa. */
  SEVEN_DAY_VIEW = '7d_view',
  /** @deprecated Removido na v25.0 (efetivo 12/jan/2026). Usar 1d_view como alternativa. */
  TWENTY_EIGHT_DAY_VIEW = '28d_view',
  ONE_DAY_CLICK = '1d_click',
  SEVEN_DAY_CLICK = '7d_click',
  TWENTY_EIGHT_DAY_CLICK = '28d_click',
  ONE_DAY_EV = '1d_ev',
  DDA = 'dda',
  DEFAULT = 'default',
  SEVEN_DAY_VIEW_FIRST_CONVERSION = '7d_view_first_conversion',
  TWENTY_EIGHT_DAY_VIEW_FIRST_CONVERSION = '28d_view_first_conversion',
  SEVEN_DAY_VIEW_ALL_CONVERSIONS = '7d_view_all_conversions',
  TWENTY_EIGHT_DAY_VIEW_ALL_CONVERSIONS = '28d_view_all_conversions',
  SKAN_VIEW = 'skan_view',
  SKAN_CLICK = 'skan_click',
  SKAN_CLICK_SECOND_POSTBACK = 'skan_click_second_postback',
  SKAN_VIEW_SECOND_POSTBACK = 'skan_view_second_postback',
  SKAN_CLICK_THIRD_POSTBACK = 'skan_click_third_postback',
  SKAN_VIEW_THIRD_POSTBACK = 'skan_view_third_postback',
}

export enum Breakdown {
  // Demografico
  AGE = 'age',
  GENDER = 'gender',

  // Geografico
  COUNTRY = 'country',
  REGION = 'region',
  DMA = 'dma',

  // Plataforma
  PUBLISHER_PLATFORM = 'publisher_platform',
  PLATFORM_POSITION = 'platform_position',
  DEVICE_PLATFORM = 'device_platform',
  IMPRESSION_DEVICE = 'impression_device',

  // Tempo
  FREQUENCY_VALUE = 'frequency_value',
  HOURLY_STATS_AGGREGATED_BY_ADVERTISER_TIME_ZONE = 'hourly_stats_aggregated_by_advertiser_time_zone',
  HOURLY_STATS_AGGREGATED_BY_AUDIENCE_TIME_ZONE = 'hourly_stats_aggregated_by_audience_time_zone',

  // Ad Extension
  AD_EXTENSION_DOMAIN = 'ad_extension_domain',
  AD_EXTENSION_URL = 'ad_extension_url',

  // Creative Assets
  AD_FORMAT_ASSET = 'ad_format_asset',
  BODY_ASSET = 'body_asset',
  CALL_TO_ACTION_ASSET = 'call_to_action_asset',
  CREATIVE_AUTOMATION_ASSET_ID = 'creative_automation_asset_id',
  CREATIVE_RELAXATION_ASSET_TYPE = 'creative_relaxation_asset_type',
  DESCRIPTION_ASSET = 'description_asset',
  FLEXIBLE_FORMAT_ASSET_TYPE = 'flexible_format_asset_type',
  GEN_AI_ASSET_TYPE = 'gen_ai_asset_type',
  IMAGE_ASSET = 'image_asset',
  LINK_URL_ASSET = 'link_url_asset',
  MEDIA_ASSET_URL = 'media_asset_url',
  MEDIA_CREATOR = 'media_creator',
  MEDIA_DESTINATION_URL = 'media_destination_url',
  MEDIA_FORMAT = 'media_format',
  MEDIA_ORIGIN_URL = 'media_origin_url',
  MEDIA_TEXT_CONTENT = 'media_text_content',
  MEDIA_TYPE = 'media_type',
  TITLE_ASSET = 'title_asset',
  VIDEO_ASSET = 'video_asset',

  // Reporting
  APP_ID = 'app_id',
  BREAKDOWN_AD_OBJECTIVE = 'breakdown_ad_objective',
  BREAKDOWN_REPORTING_AD_ID = 'breakdown_reporting_ad_id',

  // Conversion
  COARSE_CONVERSION_VALUE = 'coarse_conversion_value',
  CONVERSION_DESTINATION = 'conversion_destination',
  SIGNAL_SOURCE_BUCKET = 'signal_source_bucket',
  STANDARD_EVENT_CONTENT_TYPE = 'standard_event_content_type',
  FIDELITY_TYPE = 'fidelity_type',
  POSTBACK_SEQUENCE_INDEX = 'postback_sequence_index',
  REDOWNLOAD = 'redownload',

  // SKAdNetwork
  SKAN_CAMPAIGN_ID = 'skan_campaign_id',
  SKAN_CONVERSION_ID = 'skan_conversion_id',
  SKAN_VERSION = 'skan_version',

  // CRM / Advertiser
  COMSCOREMARKET = 'comscore_market',
  CRM_ADVERTISER_L12_TERRITORY_IDS = 'crm_advertiser_l12_territory_ids',
  CRM_ADVERTISER_SUBVERTICAL_ID = 'crm_advertiser_subvertical_id',
  CRM_ADVERTISER_VERTICAL_ID = 'crm_advertiser_vertical_id',
  CRM_ULT_ADVERTISER_ID = 'crm_ult_advertiser_id',
  HSID = 'hsid',

  // Product
  PRODUCT_BRAND_BREAKDOWN = 'product_brand_breakdown',
  PRODUCT_CATEGORY_BREAKDOWN = 'product_category_breakdown',
  PRODUCT_CUSTOM_LABEL_0_BREAKDOWN = 'product_custom_label_0_breakdown',
  PRODUCT_CUSTOM_LABEL_1_BREAKDOWN = 'product_custom_label_1_breakdown',
  PRODUCT_CUSTOM_LABEL_2_BREAKDOWN = 'product_custom_label_2_breakdown',
  PRODUCT_CUSTOM_LABEL_3_BREAKDOWN = 'product_custom_label_3_breakdown',
  PRODUCT_CUSTOM_LABEL_4_BREAKDOWN = 'product_custom_label_4_breakdown',
  PRODUCT_GROUP_CONTENT_ID_BREAKDOWN = 'product_group_content_id_breakdown',
  PRODUCT_ID = 'product_id',

  // Landing / Destination
  LANDING_DESTINATION = 'landing_destination',
  MDSA_LANDING_DESTINATION = 'mdsa_landing_destination',

  // Persona
  USER_PERSONA_ID = 'user_persona_id',
  USER_PERSONA_NAME = 'user_persona_name',

  // SOT (Source of Truth)
  SOT_ATTRIBUTION_MODEL_TYPE = 'sot_attribution_model_type',
  SOT_ATTRIBUTION_WINDOW = 'sot_attribution_window',
  SOT_CHANNEL = 'sot_channel',
  SOT_EVENT_TYPE = 'sot_event_type',
  SOT_SOURCE = 'sot_source',

  // Outros
  IS_AUTO_ADVANCE = 'is_auto_advance',
  IS_CONVERSION_ID_MODELED = 'is_conversion_id_modeled',
  IS_RENDERED_AS_DELAYED_SKIP_AD = 'is_rendered_as_delayed_skip_ad',
  MMM = 'mmm',
  PLACE_PAGE_ID = 'place_page_id',
  RULE_SET_ID = 'rule_set_id',
  RULE_SET_NAME = 'rule_set_name',
  RTA_UGC_TOPIC = 'rta_ugc_topic',
  REELS_TRENDING_TOPIC = 'reels_trending_topic',
  MARKETING_MESSAGES_BTN_NAME = 'marketing_messages_btn_name',
  IMPRESSION_VIEW_TIME_ADVERTISER_HOUR_V2 = 'impression_view_time_advertiser_hour_v2',
}

export enum ActionBreakdown {
  ACTION_DEVICE = 'action_device',
  CONVERSION_DESTINATION = 'conversion_destination',
  MATCHED_PERSONA_ID = 'matched_persona_id',
  MATCHED_PERSONA_NAME = 'matched_persona_name',
  SIGNAL_SOURCE_BUCKET = 'signal_source_bucket',
  STANDARD_EVENT_CONTENT_TYPE = 'standard_event_content_type',
  ACTION_CANVAS_COMPONENT_NAME = 'action_canvas_component_name',
  ACTION_CAROUSEL_CARD_ID = 'action_carousel_card_id',
  ACTION_CAROUSEL_CARD_NAME = 'action_carousel_card_name',
  ACTION_DESTINATION = 'action_destination',
  ACTION_REACTION = 'action_reaction',
  ACTION_TARGET_ID = 'action_target_id',
  ACTION_TYPE = 'action_type',
  ACTION_VIDEO_SOUND = 'action_video_sound',
  ACTION_VIDEO_TYPE = 'action_video_type',
  IS_BUSINESS_AI_ASSISTED = 'is_business_ai_assisted',
}

export enum ActionReportTime {
  IMPRESSION = 'impression',
  CONVERSION = 'conversion',
  MIXED = 'mixed',
  LIFETIME = 'lifetime',
}

export enum FilterOperator {
  EQUAL = 'EQUAL',
  NOT_EQUAL = 'NOT_EQUAL',
  GREATER_THAN = 'GREATER_THAN',
  GREATER_THAN_OR_EQUAL = 'GREATER_THAN_OR_EQUAL',
  LESS_THAN = 'LESS_THAN',
  LESS_THAN_OR_EQUAL = 'LESS_THAN_OR_EQUAL',
  IN_RANGE = 'IN_RANGE',
  NOT_IN_RANGE = 'NOT_IN_RANGE',
  CONTAIN = 'CONTAIN',
  NOT_CONTAIN = 'NOT_CONTAIN',
  CONTAINS_ANY = 'CONTAINS_ANY',
  CONTAINS_ALL = 'CONTAINS_ALL',
  NOT_CONTAINS_ANY = 'NOT_CONTAINS_ANY',
  STEM_MATCH = 'STEM_MATCH',
  IN = 'IN',
  NOT_IN = 'NOT_IN',
  STARTS_WITH = 'STARTS_WITH',
  ENDS_WITH = 'ENDS_WITH',
  ANY = 'ANY',
  ALL = 'ALL',
  AFTER = 'AFTER',
  BEFORE = 'BEFORE',
  ON_OR_AFTER = 'ON_OR_AFTER',
  ON_OR_BEFORE = 'ON_OR_BEFORE',
  NONE = 'NONE',
  TOP = 'TOP',
}

export class InsightFilterObject {
  @ApiProperty({ description: 'Campo para filtrar' })
  @IsString()
  @IsNotEmpty()
  field: string

  @ApiProperty({ description: 'Operador de comparacao', enum: FilterOperator })
  @IsEnum(FilterOperator)
  operator: FilterOperator

  @ApiProperty({ description: 'Valor do filtro' })
  @IsString()
  @IsNotEmpty()
  value: string
}

export class FetchMetaInsightsDto {
  @ApiProperty({ description: 'ID da empresa' })
  @IsString()
  @IsNotEmpty()
  companyId: string

  @ApiPropertyOptional({ description: 'Filtro de data preset', enum: DatePreset })
  @IsEnum(DatePreset)
  @IsOptional()
  datePreset?: DatePreset

  @ApiPropertyOptional({ description: 'Data inicial (YYYY-MM-DD)' })
  @IsString()
  @IsOptional()
  startDate?: string

  @ApiPropertyOptional({ description: 'Data final (YYYY-MM-DD)' })
  @IsString()
  @IsOptional()
  endDate?: string
}

export class SyncMetaInsightsDto {
  @ApiProperty({ description: 'ID da empresa' })
  @IsString()
  @IsNotEmpty()
  companyId: string

  @ApiPropertyOptional({ description: 'Filtro de data preset', enum: DatePreset, default: DatePreset.LAST_7_DAYS })
  @IsEnum(DatePreset)
  @IsOptional()
  datePreset?: DatePreset

  @ApiPropertyOptional({ description: 'ID da campanha HDM para vincular' })
  @IsString()
  @IsOptional()
  campaignId?: string

  @ApiPropertyOptional({ description: 'Nivel de agregacao', enum: Level, default: Level.AD })
  @IsEnum(Level)
  @IsOptional()
  level?: Level

  @ApiPropertyOptional({ description: 'Incremento de tempo (monthly, all_days, ou numero 1-90 dias)', default: 'all_days' })
  @IsOptional()
  timeIncrement?: string | number

  @ApiPropertyOptional({ description: 'Janelas de atribuicao', enum: ActionAttributionWindow, isArray: true })
  @IsArray()
  @IsOptional()
  actionAttributionWindows?: ActionAttributionWindow[]

  @ApiPropertyOptional({ description: 'Breakdowns para segmentacao', enum: Breakdown, isArray: true })
  @IsArray()
  @IsOptional()
  breakdowns?: Breakdown[]

  @ApiPropertyOptional({ description: 'Action breakdowns (default: ["action_type"])', enum: ActionBreakdown, isArray: true })
  @IsArray()
  @IsOptional()
  actionBreakdowns?: ActionBreakdown[]

  @ApiPropertyOptional({ description: 'Tempo de report das acoes (impression, conversion, mixed, lifetime)', enum: ActionReportTime })
  @IsEnum(ActionReportTime)
  @IsOptional()
  actionReportTime?: ActionReportTime

  @ApiPropertyOptional({ description: 'Filtros na API Meta', type: [InsightFilterObject] })
  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => InsightFilterObject)
  filtering?: InsightFilterObject[]

  @ApiPropertyOptional({ description: 'Ordenacao (ex: "reach_descending", "actions:link_click_ascending")', isArray: true })
  @IsArray()
  @IsOptional()
  sort?: string[]

  @ApiPropertyOptional({ description: 'Usar config de atribuicao da conta', default: false })
  @IsBoolean()
  @IsOptional()
  useAccountAttributionSetting?: boolean

  @ApiPropertyOptional({ description: 'Usar config de atribuicao unificada do adset (ignora useAccountAttributionSetting)', default: false })
  @IsBoolean()
  @IsOptional()
  useUnifiedAttributionSetting?: boolean
}

export class SyncBreakdownsDto {
  @ApiProperty({ description: 'ID da empresa' })
  @IsString()
  @IsNotEmpty()
  companyId: string

  @ApiPropertyOptional({ description: 'Filtro de data preset', enum: DatePreset, default: DatePreset.THIS_MONTH })
  @IsEnum(DatePreset)
  @IsOptional()
  datePreset?: DatePreset
}

export class UpdateCronSettingsDto {
  @ApiProperty({ description: 'Ativar/desativar cron job' })
  @IsBoolean()
  enabled: boolean

  @ApiProperty({ description: 'Intervalo em horas (1, 2, 3, 5, 12, 24)', enum: [1, 2, 3, 5, 12, 24] })
  @IsInt()
  @IsIn([1, 2, 3, 5, 12, 24])
  interval: number
}
