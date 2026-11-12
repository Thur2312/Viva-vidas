/**
 * Nomes aceitos para a coluna de "ganho" de um Template de Jornada (GenericDndColumnSet).
 * O matching precisa ser tolerante — templates criados pelos usuários usam variações.
 */
export const WIN_COLUMN_NAMES = ['Win', 'WIN', 'win', 'Ganhou', 'ganhou']

/**
 * Códigos de erro da transformação Lead → Oportunidade.
 * O frontend diferencia esses códigos via `err.response.data.code` para
 * decidir entre toast, seletor de template (fallback manual) ou link.
 */
export const LEAD_TRANSFORM_ERROR_CODES = {
  LEAD_ALREADY_CONVERTED: 'LEAD_ALREADY_CONVERTED',
  LEAD_NOT_FOUND: 'LEAD_NOT_FOUND',
  INVALID_COLUMN_SET: 'INVALID_COLUMN_SET',
  JOURNEY_TEMPLATE_NOT_RESOLVED: 'JOURNEY_TEMPLATE_NOT_RESOLVED',
  WIN_COLUMN_NOT_FOUND: 'WIN_COLUMN_NOT_FOUND',
  CARD_POSITION_NOT_FOUND: 'CARD_POSITION_NOT_FOUND',
} as const

export type LeadTransformErrorCode = keyof typeof LEAD_TRANSFORM_ERROR_CODES

/**
 * Códigos de erro da movimentação de um lead no Kanban.
 * Mesmo contrato do acima: o frontend lê `err.response.data.code` e `.message`.
 */
export const LEAD_MOVE_ERROR_CODES = {
  /** O card não pertence à empresa da URL. Responde 404 para não confirmar existência. */
  LEAD_NOT_IN_COMPANY: 'LEAD_NOT_IN_COMPANY',
  /** Vendedor tentando mexer em lead de outro vendedor. */
  LEAD_NOT_VISIBLE: 'LEAD_NOT_VISIBLE',
  /** Vendedor sem Seller APPROVED tentando puxar lead da recepção — viraria lead órfão. */
  SELLER_NOT_APPROVED: 'SELLER_NOT_APPROVED',
} as const

export type LeadMoveErrorCode = keyof typeof LEAD_MOVE_ERROR_CODES

/**
 * Códigos de erro da atribuição manual de um lead a um vendedor (gestor comercial).
 * Mesmo contrato dos demais: o frontend lê `err.response.data.code` e `.message`.
 */
export const LEAD_ASSIGN_ERROR_CODES = {
  /** Quem chamou não é gestor NESTA empresa (pode ser gestor em outra). */
  NOT_LEAD_MANAGER: 'NOT_LEAD_MANAGER',
  /** Lead inexistente ou de outra empresa. 404 nos dois casos, para não confirmar existência. */
  LEAD_NOT_IN_COMPANY: 'LEAD_NOT_IN_COMPANY',
  /** Lead sem campanha: `Seller.campaignId` é NOT NULL, então não existe vendedor elegível. */
  LEAD_WITHOUT_CAMPAIGN: 'LEAD_WITHOUT_CAMPAIGN',
  /** O vendedor destino não participa da campanha do lead, ou é de outra empresa. */
  SELLER_NOT_IN_CAMPAIGN: 'SELLER_NOT_IN_CAMPAIGN',
  /** O vendedor destino existe na campanha mas ainda não foi aprovado nela. */
  SELLER_NOT_APPROVED: 'SELLER_NOT_APPROVED',
} as const

export type LeadAssignErrorCode = keyof typeof LEAD_ASSIGN_ERROR_CODES
