import { OmitType } from '@nestjs/swagger'
import { IsString, IsOptional, IsNotEmpty } from 'class-validator'

export class CreateTrackingDto {
  @IsString()
  @IsOptional()
  ip?: string

  @IsString()
  @IsOptional()
  url?: string

  @IsString()
  @IsNotEmpty()
  action: string

  @IsString()
  @IsOptional()
  campaignId?: string

  @IsString()
  companyId: string

  @IsString()
  @IsOptional()
  email?: string

  @IsString()
  @IsOptional()
  name?: string

  @IsString()
  @IsOptional()
  phone?: string

  @IsString()
  @IsOptional()
  sessionId?: string

  @IsString()
  @IsOptional()
  referral?: string

  @IsString()
  @IsOptional()
  device?: string

  @IsString()
  @IsOptional()
  tag?: string

  @IsString()
  @IsOptional()
  timestamp?: string

  @IsString()
  @IsOptional()
  utms?: string

  @IsString()
  @IsOptional()
  utm_source?: string

  @IsString()
  @IsOptional()
  utm_medium?: string

  @IsString()
  @IsOptional()
  utm_campaign?: string

  @IsString()
  @IsOptional()
  utm_term?: string

  @IsString()
  @IsOptional()
  utm_content?: string

  @IsString()
  @IsOptional()
  utm_var1?: string

  @IsString()
  @IsOptional()
  fbc?: string

  @IsString()
  @IsOptional()
  gclid?: string

  @IsString()
  @IsOptional()
  trackingTitle?: string

  @IsString()
  @IsOptional()
  trackingIconUrl?: string

  @IsString()
  @IsOptional()
  timestamp_2?: string

  @IsString()
  @IsOptional()
  adset_id : string

  @IsString()
  @IsOptional()
  adset_name : string

  @IsString()
  @IsOptional()
  ad_id : string

  @IsString()
  @IsOptional()
  ad_name : string

  @IsString()
  @IsOptional()
  page_id: string

  @IsString()
  @IsOptional()
  page_name: string

  @IsString()
  @IsOptional()
  form_id: string

  @IsString()
  @IsOptional()
  form_name : string
  
  @IsString()
  @IsOptional()
  form_locale: string 

  @IsString()
  @IsOptional()
  form_status: string
}

export class CreateTrackingEventDto extends OmitType(CreateTrackingDto, ['companyId'] as const) {}

// DTO para o endpoint /collect do tracker v5
export class CollectEventDto {
  @IsString()
  @IsNotEmpty()
  client_hash: string

  @IsString()
  @IsOptional()
  campaign_id?: string

  @IsString()
  @IsOptional()
  form_config_id?: string

  @IsString()
  @IsNotEmpty()
  visitor_id: string

  @IsString()
  @IsNotEmpty()
  session_id: string

  @IsString()
  @IsNotEmpty()
  event: string

  @IsString()
  @IsOptional()
  page?: string

  @IsString()
  @IsOptional()
  url?: string

  @IsString()
  @IsOptional()
  referrer?: string

  // Clique
  @IsString()
  @IsOptional()
  button_text?: string

  @IsString()
  @IsOptional()
  button_tag?: string

  @IsString()
  @IsOptional()
  button_href?: string

  @IsString()
  @IsOptional()
  button_id?: string

  @IsString()
  @IsOptional()
  button_classes?: string

  // Tempo
  @IsOptional()
  time_on_page_ms?: number

  // Formulário
  @IsString()
  @IsOptional()
  form_nome?: string

  @IsString()
  @IsOptional()
  form_email?: string

  @IsString()
  @IsOptional()
  form_telefone?: string

  @IsString()
  @IsOptional()
  form_id?: string

  @IsString()
  @IsOptional()
  form_action?: string

  // Clique - data-hdm-track
  @IsString()
  @IsOptional()
  button_track?: string

  // Clique - coordenadas (heatmap)
  @IsOptional()
  click_x?: number

  @IsOptional()
  click_y?: number

  @IsOptional()
  page_x?: number

  @IsOptional()
  page_y?: number

  @IsOptional()
  viewport_w?: number

  @IsOptional()
  viewport_h?: number

  @IsOptional()
  scroll_y?: number

  // Scroll depth
  @IsOptional()
  scroll_pct?: number

  // Meta CAPI
  @IsString()
  @IsOptional()
  fbc?: string

  @IsString()
  @IsOptional()
  fbclid?: string

  @IsString()
  @IsOptional()
  fbp?: string

  // UTMs
  @IsString()
  @IsOptional()
  utm_source?: string

  @IsString()
  @IsOptional()
  utm_medium?: string

  @IsString()
  @IsOptional()
  utm_campaign?: string

  @IsString()
  @IsOptional()
  utm_content?: string

  @IsString()
  @IsOptional()
  utm_term?: string

  // Meta
  @IsString()
  @IsOptional()
  ua?: string

  @IsString()
  @IsOptional()
  timestamp?: string

  // Todos os campos do formulário (JSON string)
  @IsString()
  @IsOptional()
  form_data?: string

  // IP injetado pelo proxy Next.js
  @IsString()
  @IsOptional()
  server_ip?: string
}
