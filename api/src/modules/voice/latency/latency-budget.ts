import { DELTA_STAGES, LatencyReport, Stage } from './latency-tracker'

/**
 * Orçamento de latência do agente de voz (ms). São METAS de projeto, não medições:
 * valem como teto no p95 por estágio e para o total. Os tetos por estágio somam mais que o total de
 * propósito: os p95 não se somam, e o que manda é o total (p50 800 ms, p95 1200 ms). Revisar com os números reais da primeira ligação de teste.
 */
export interface LatencyBudget {
  /** Teto por estágio (p95), em ms, medido contra o estágio anterior. */
  stageP95: Record<Exclude<Stage, 'speech_end'>, number>
  totalP50: number
  totalP95: number
}

export const DEFAULT_BUDGET: LatencyBudget = {
  stageP95: {
    endpoint: 400, // silêncio até declarar fim de fala (VAD + detector de fim de turno)
    stt_final: 250, // do fim de fala ao texto final
    llm_first_token: 600, // primeiro token do modelo
    first_chunk: 150, // juntar a primeira frase falável
    tts_first_audio: 350, // primeiro áudio sintetizado (em voz nativa, inclui a geração do modelo)
    playback: 80, // do áudio pronto até tocar na linha
  },
  totalP50: 800,
  totalP95: 1200,
}

export interface BudgetViolation { scope: 'total_p50' | 'total_p95' | Stage; limit: number; actual: number }

export interface BudgetVerdict {
  ok: boolean
  violations: BudgetViolation[]
  /** Estágios sem nenhuma amostra: o veredicto não cobre esses. */
  unmeasured: Stage[]
}

export function evaluateBudget(report: LatencyReport, budget: LatencyBudget = DEFAULT_BUDGET): BudgetVerdict {
  const violations: BudgetViolation[] = []
  const unmeasured: Stage[] = []
  if (!report.total) {
    return { ok: false, violations: [], unmeasured: [...DELTA_STAGES] }
  }
  if (report.total.p50 > budget.totalP50) violations.push({ scope: 'total_p50', limit: budget.totalP50, actual: report.total.p50 })
  if (report.total.p95 > budget.totalP95) violations.push({ scope: 'total_p95', limit: budget.totalP95, actual: report.total.p95 })
  for (const s of DELTA_STAGES) {
    const sum = report.stages[s]
    if (!sum) { unmeasured.push(s); continue }
    const limit = budget.stageP95[s as keyof LatencyBudget['stageP95']]
    if (sum.p95 > limit) violations.push({ scope: s, limit, actual: sum.p95 })
  }
  return { ok: violations.length === 0, violations, unmeasured }
}
