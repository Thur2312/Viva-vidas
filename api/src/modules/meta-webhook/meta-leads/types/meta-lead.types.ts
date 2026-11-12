export interface MetaLeadWebhookPayload {
  object: string
  entry: MetaLeadEntry[]
}

export interface MetaLeadEntry {
  id: string // Page ID
  time: number
  changes: MetaLeadChange[]
}

export interface MetaLeadChange {
  value: MetaLeadChangeValue
  field: string // 'leadgen'
}

export interface MetaLeadChangeValue {
  created_time: number
  leadgen_id: string
  page_id: string
  form_id: string
  ad_id?: string
  adgroup_id?: string // adset_id
}

// Resposta da Graph API ao buscar o lead
export interface MetaLeadData {
  id: string
  created_time: string
  field_data: { name: string; values: string[] }[]
  ad_id?: string
  adset_id?: string
  campaign_id?: string
  form_id?: string
  page_id?: string
  ad_name?: string
  adset_name?: string
  campaign_name?: string
  platform?: string
  is_organic?: boolean
  custom_disclaimer_responses?: { checkbox_key: string; is_checked: string }[]
}

// Credenciais do webhook por empresa
export interface MetaLeadsWebhookConfig {
  accessToken: string
  verifyToken: string | null
  appSecret: string | null
}
