import {
  MetaLeadWebhookPayload,
  MetaLeadChangeValue,
  MetaLeadData,
} from '../types/meta-lead.types'

// ===== Webhook Payload Factories =====

export function makeChangeValue(overrides?: Partial<MetaLeadChangeValue>): MetaLeadChangeValue {
  return {
    created_time: 1712567890,
    leadgen_id: 'lg_test_001',
    page_id: 'page_123',
    form_id: 'form_456',
    ...overrides,
  }
}

export function makeWebhookPayload(overrides?: Partial<MetaLeadWebhookPayload>): MetaLeadWebhookPayload {
  return {
    object: 'page',
    entry: [
      {
        id: 'page_123',
        time: 1712567890,
        changes: [
          {
            field: 'leadgen',
            value: makeChangeValue(),
          },
        ],
      },
    ],
    ...overrides,
  }
}

export function makeMultiEntryPayload(entryCount: number, changesPerEntry: number): MetaLeadWebhookPayload {
  const entries = Array.from({ length: entryCount }, (_, i) => ({
    id: `page_${i}`,
    time: 1712567890 + i,
    changes: Array.from({ length: changesPerEntry }, (_, j) => ({
      field: 'leadgen',
      value: makeChangeValue({ leadgen_id: `lg_${i}_${j}` }),
    })),
  }))

  return { object: 'page', entry: entries }
}

// ===== Graph API Response Factories =====

export function makeGraphApiLeadResponse(overrides?: Partial<MetaLeadData>): MetaLeadData {
  return {
    id: 'lg_test_001',
    created_time: '2024-04-08T12:00:00+0000',
    field_data: [
      { name: 'full_name', values: ['John Doe'] },
      { name: 'email', values: ['john@example.com'] },
      { name: 'phone_number', values: ['+5511999887766'] },
      { name: 'city', values: ['Sao Paulo'] },
      { name: 'state', values: ['SP'] },
      { name: 'company_name', values: ['Acme Corp'] },
      { name: 'job_title', values: ['Developer'] },
    ],
    form_id: 'form_456',
    page_id: 'page_123',
    ad_id: 'ad_789',
    adset_id: 'adset_012',
    campaign_id: 'camp_345',
    ad_name: 'Ad Test',
    adset_name: 'Adset Test',
    campaign_name: 'Campaign Test',
    platform: 'facebook',
    is_organic: false,
    ...overrides,
  }
}

export function makeMinimalLeadResponse(): MetaLeadData {
  return {
    id: 'lg_minimal_001',
    created_time: '2024-04-08T12:00:00+0000',
    field_data: [],
  }
}

export function makePtBrLeadResponse(): MetaLeadData {
  return {
    id: 'lg_ptbr_001',
    created_time: '2024-04-08T12:00:00+0000',
    field_data: [
      { name: 'nome_completo', values: ['Joao Silva'] },
      { name: 'e-mail', values: ['joao@exemplo.com'] },
      { name: 'telefone', values: ['+5521988776655'] },
      { name: 'cidade', values: ['Rio de Janeiro'] },
      { name: 'estado', values: ['RJ'] },
      { name: 'empresa', values: ['Empresa Teste'] },
      { name: 'cargo', values: ['Gerente'] },
      { name: 'endereco', values: ['Rua Test 123'] },
      { name: 'cep', values: ['01001-000'] },
      { name: 'pais', values: ['Brasil'] },
      { name: 'data_nascimento', values: ['1990-01-15'] },
      { name: 'genero', values: ['Masculino'] },
      { name: 'cpf', values: ['123.456.789-00'] },
      { name: 'estado_civil', values: ['Solteiro'] },
      { name: 'email_comercial', values: ['joao@empresa.com'] },
      { name: 'telefone_comercial', values: ['+552133334444'] },
      { name: 'status_militar', values: ['N/A'] },
      { name: 'relacionamento', values: ['Solteiro'] },
    ],
    form_id: 'form_ptbr',
    page_id: 'page_ptbr',
  }
}

export function makeOrganicLeadResponse(): MetaLeadData {
  return {
    id: 'lg_organic_001',
    created_time: '2024-04-08T12:00:00+0000',
    field_data: [
      { name: 'full_name', values: ['Organic User'] },
      { name: 'email', values: ['organic@example.com'] },
      { name: 'phone_number', values: ['+5511988887777'] },
    ],
    form_id: 'form_organic',
    page_id: 'page_organic',
    is_organic: true,
    platform: 'instagram',
  }
}

export function makeLeadResponseWithUtms(): MetaLeadData {
  return {
    id: 'lg_utm_001',
    created_time: '2024-04-08T12:00:00+0000',
    field_data: [
      { name: 'full_name', values: ['UTM User'] },
      { name: 'email', values: ['utm@example.com'] },
      { name: 'utm_campaign', values: ['black_friday'] },
      { name: 'utm_source', values: ['facebook'] },
      { name: 'utm_medium', values: ['cpc'] },
      { name: 'utm_content', values: ['banner_v2'] },
      { name: 'utm_term', values: ['comprar'] },
    ],
    form_id: 'form_utm',
    page_id: 'page_utm',
  }
}

export function makeLeadResponseWithCustomFields(): MetaLeadData {
  return {
    id: 'lg_custom_001',
    created_time: '2024-04-08T12:00:00+0000',
    field_data: [
      { name: 'full_name', values: ['Custom User'] },
      { name: 'email', values: ['custom@example.com'] },
      { name: 'como_conheceu_nos', values: ['Instagram'] },
      { name: 'qual_seu_objetivo', values: ['Emagrecer'] },
    ],
    form_id: 'form_custom',
    page_id: 'page_custom',
  }
}

export function makeLeadResponseWithDisclaimers(): MetaLeadData {
  return {
    id: 'lg_disc_001',
    created_time: '2024-04-08T12:00:00+0000',
    field_data: [
      { name: 'full_name', values: ['Disclaimer User'] },
      { name: 'email', values: ['disc@example.com'] },
    ],
    custom_disclaimer_responses: [
      { checkbox_key: 'privacy_policy', is_checked: 'true' },
      { checkbox_key: 'terms_of_service', is_checked: 'false' },
    ],
    form_id: 'form_disc',
    page_id: 'page_disc',
  }
}

// ===== Graph API Error Factories =====

export function makeGraphApiErrorResponse(code: number, message: string) {
  return {
    error: {
      message,
      type: 'OAuthException',
      code,
    },
  }
}

export const GRAPH_API_ERRORS = {
  INVALID_PARAM: makeGraphApiErrorResponse(100, '(#100) Invalid parameter'),
  EXPIRED_TOKEN: makeGraphApiErrorResponse(190, 'Error validating access token: Session has expired'),
  LEAD_NOT_FOUND: makeGraphApiErrorResponse(100, '(#100) Unsupported get request'),
  RATE_LIMITED: makeGraphApiErrorResponse(32, '(#32) Rate limit exceeded'),
  SERVER_ERROR: makeGraphApiErrorResponse(1, 'An unknown error occurred'),
} as const

// ===== Default Meta =====

export const DEFAULT_META = {
  companyId: 'test-company-meta-001',
  pageId: 'page_123',
  formId: 'form_456',
  adId: 'ad_789',
  adsetId: 'adset_012',
} as const
