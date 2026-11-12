/**
 * Portas de conformidade, PURAS e que falham FECHADO. Usadas na montagem do público e de novo, por
 * destinatário, na hora do envio. O banco só fornece fatos (`LeadFacts`); a decisão é daqui.
 */

export type SkipReason =
  | 'lead_inexistente'
  | 'opt_out'
  | 'anonimizado'
  | 'marketing_revogado'
  | 'telefone_invalido'
  | 'sem_consentimento_marketing'
  | 'sem_consentimento_atendimento'
  | 'consentimento_sem_origem'
  | 'limite_frequencia'
  | 'fora_janela_24h'
  | 'variavel_vazia'
  | 'template_nao_aprovado'

export const SKIP_LABELS: Record<SkipReason, string> = {
  lead_inexistente: 'Lead não encontrado',
  opt_out: 'Pediu para sair (opt-out)',
  anonimizado: 'Lead anonimizado',
  marketing_revogado: 'Revogou o consentimento de marketing',
  telefone_invalido: 'Telefone inválido',
  sem_consentimento_marketing: 'Sem consentimento de marketing ativo',
  sem_consentimento_atendimento: 'Sem consentimento de atendimento ativo',
  consentimento_sem_origem: 'Consentimento sem origem registrada',
  limite_frequencia: 'Já recebeu marketing nos últimos 7 dias',
  fora_janela_24h: 'Sem mensagem do lead nas últimas 24h',
  variavel_vazia: 'Variável do template ficaria vazia',
  template_nao_aprovado: 'Template não aprovado',
}

export interface LeadFacts {
  id: string
  name: string | null
  phone: string | null
  opt_out: boolean
  anonymized_at: Date | string | null
  /** Consentimento ativo (revoked_at nulo) por finalidade, com a origem registrada ou não. */
  marketing_active: boolean
  marketing_active_has_source: boolean
  /** Existe registro de marketing e nenhum ativo (mesma regra de ConsentService.canContact). */
  marketing_revoked: boolean
  atendimento_active: boolean
  atendimento_active_has_source: boolean
  last_marketing_sent_at: Date | string | null
  last_inbound_at: Date | string | null
}

export interface GateContext {
  kind: 'template' | 'text_in_window'
  /** Categoria do template. MARKETING exige consentimento de marketing; UTILITY exige o de atendimento. */
  category: 'MARKETING' | 'UTILITY'
  now: Date
  /** Frequência: máximo 1 marketing por N dias, em todos os disparos. */
  frequencyDays: number
}

export const DEFAULT_FREQUENCY_DAYS = 7
export const WINDOW_24H_MS = 24 * 3600 * 1000

export function isValidBrPhone(phone: string | null | undefined): boolean {
  if (!phone || phone.startsWith('anon:')) return false
  if (!/^\d{12,13}$/.test(phone)) return false
  if (!phone.startsWith('55')) return false
  const ddd = Number(phone.slice(2, 4))
  if (ddd < 11 || ddd > 99) return false
  const local = phone.slice(4)
  return local.length === 8 ? /^[2-5]/.test(local) : /^9/.test(local)
}

const ms = (d: Date | string | null) => (d ? new Date(d).getTime() : NaN)

/** Devolve o motivo do bloqueio, ou null quando o lead PODE ser contatado. A ordem é a da gravidade. */
export function decideLead(f: LeadFacts | null | undefined, ctx: GateContext): SkipReason | null {
  if (!f) return 'lead_inexistente'
  if (f.opt_out) return 'opt_out'
  if (f.anonymized_at) return 'anonimizado'
  if (f.marketing_revoked) return 'marketing_revogado' // can_contact = false
  if (!isValidBrPhone(f.phone)) return 'telefone_invalido'

  const marketing = ctx.kind === 'template' && ctx.category === 'MARKETING'
  if (marketing) {
    if (!f.marketing_active) return 'sem_consentimento_marketing'
    if (!f.marketing_active_has_source) return 'consentimento_sem_origem'
  } else {
    if (!f.atendimento_active) return 'sem_consentimento_atendimento'
    if (!f.atendimento_active_has_source) return 'consentimento_sem_origem'
  }

  if (marketing && f.last_marketing_sent_at) {
    if (ctx.now.getTime() - ms(f.last_marketing_sent_at) < ctx.frequencyDays * 86_400_000) return 'limite_frequencia'
  }
  if (ctx.kind === 'text_in_window') {
    const last = ms(f.last_inbound_at)
    if (!Number.isFinite(last) || ctx.now.getTime() - last > WINDOW_24H_MS) return 'fora_janela_24h'
  }
  return null
}

export function summarizeReasons(reasons: (SkipReason | null)[]) {
  const skipped: Partial<Record<SkipReason, number>> = {}
  let eligible = 0
  for (const r of reasons) {
    if (!r) eligible++
    else skipped[r] = (skipped[r] ?? 0) + 1
  }
  return { total: reasons.length, eligible, skipped, skippedTotal: reasons.length - eligible }
}
