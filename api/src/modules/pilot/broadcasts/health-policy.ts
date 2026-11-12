/**
 * Política de saúde do número (qualidade da Meta). PURA e fail closed:
 * desconhecido é inseguro. Quem decide pausar/bloquear é esta função; o worker só executa.
 */

export const QUALITY_RANK: Record<string, number> = { GREEN: 3, YELLOW: 2, RED: 1, UNKNOWN: 0 }
export const TIER_RANK: Record<string, number> = { TIER_50: 1, TIER_250: 2, TIER_1K: 3, TIER_10K: 4, TIER_100K: 5, TIER_UNLIMITED: 6 }
export const TIER_LIMIT: Record<string, number | null> = { TIER_50: 50, TIER_250: 250, TIER_1K: 1000, TIER_10K: 10000, TIER_100K: 100000, TIER_UNLIMITED: null }
export const HEALTH_STALE_MS = 60 * 60_000
export const HEALTH_POLL_MS = 15 * 60_000

export type HealthReason =
  | 'sem_leitura' | 'leitura_antiga' | 'qualidade_vermelha' | 'qualidade_caiu' | 'limite_caiu' | 'numero_nao_conectado' | 'conta_em_revisao' | 'qualidade_amarela' | 'qualidade_desconhecida'

export const HEALTH_REASON_LABELS: Record<HealthReason, string> = {
  sem_leitura: 'Ainda não há leitura da qualidade do número',
  leitura_antiga: 'A última leitura da qualidade tem mais de 60 minutos',
  qualidade_vermelha: 'Qualidade do número está VERMELHA',
  qualidade_caiu: 'A qualidade do número caiu desde a leitura anterior',
  limite_caiu: 'O limite diário de mensagens do número diminuiu',
  numero_nao_conectado: 'O número não está conectado na Meta',
  conta_em_revisao: 'Conta do WhatsApp Business em revisão ou reprovada',
  qualidade_amarela: 'Qualidade AMARELA: velocidade reduzida pela metade',
  qualidade_desconhecida: 'Qualidade ainda não classificada pela Meta: velocidade reduzida',
}

export interface HealthSnapshot {
  checked_at: Date | string
  quality_rating: string
  limit_tier: string
  daily_limit: number | null
  status: string | null
  account_review_status?: string | null
}

export interface HealthVerdict {
  state: 'ok' | 'warn' | 'block'
  reasons: HealthReason[]
  /** Multiplicador da velocidade (0.5 em amarelo). */
  rateFactor: number
  /** Limite diário real do número, quando conhecido. O daily_cap nunca passa disto. */
  dailyLimit: number | null
}

export function dailyLimitOf(tier: string | null | undefined, reported?: number | null): number | null {
  if (typeof reported === 'number' && reported > 0) return reported
  return tier && tier in TIER_LIMIT ? TIER_LIMIT[tier] : null
}

/**
 * @param strict true quando há disparo rodando ou prestes a começar: leitura ausente/antiga bloqueia.
 */
export function evaluateHealth(input: { latest: HealthSnapshot | null; previous: HealthSnapshot | null; now: Date; strict: boolean }): HealthVerdict {
  const { latest, previous, now, strict } = input
  const reasons: HealthReason[] = []
  const block = (r: HealthReason) => { if (!reasons.includes(r)) reasons.push(r) }

  if (!latest) {
    if (strict) block('sem_leitura')
    return { state: strict ? 'block' : 'ok', reasons, rateFactor: 1, dailyLimit: null }
  }
  const age = now.getTime() - new Date(latest.checked_at).getTime()
  if (strict && !(age <= HEALTH_STALE_MS)) block('leitura_antiga')

  const q = latest.quality_rating?.toUpperCase() || 'UNKNOWN'
  if (q === 'RED') block('qualidade_vermelha')
  if (previous) {
    const pq = previous.quality_rating?.toUpperCase() || 'UNKNOWN'
    if (QUALITY_RANK[pq] > 0 && QUALITY_RANK[q] !== undefined && QUALITY_RANK[q] > 0 && QUALITY_RANK[q] < QUALITY_RANK[pq]) block('qualidade_caiu')
    const pt = TIER_RANK[previous.limit_tier] ?? 0
    const lt = TIER_RANK[latest.limit_tier] ?? 0
    if (pt > 0 && lt > 0 && lt < pt) block('limite_caiu')
  }
  if ((latest.status ?? '').toUpperCase() !== 'CONNECTED') block('numero_nao_conectado')
  const review = (latest.account_review_status ?? '').toUpperCase()
  if (review && review !== 'APPROVED') block('conta_em_revisao')

  const dailyLimit = dailyLimitOf(latest.limit_tier, latest.daily_limit)
  if (reasons.length) return { state: 'block', reasons, rateFactor: 1, dailyLimit }
  if (q === 'YELLOW') return { state: 'warn', reasons: ['qualidade_amarela'], rateFactor: 0.5, dailyLimit }
  if (q === 'UNKNOWN') return { state: 'warn', reasons: ['qualidade_desconhecida'], rateFactor: 0.5, dailyLimit }
  return { state: 'ok', reasons: [], rateFactor: 1, dailyLimit }
}

/** daily_cap efetivo: nunca acima do limite real do número. */
export function effectiveDailyCap(dailyCap: number, dailyLimit: number | null): number {
  return dailyLimit == null ? dailyCap : Math.min(dailyCap, dailyLimit)
}

export function effectiveRate(rate: number, factor: number): number {
  return Math.max(1, Math.floor(rate * factor))
}
