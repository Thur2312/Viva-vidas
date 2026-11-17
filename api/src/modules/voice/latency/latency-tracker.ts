/**
 * Medição de latência de um turno de voz.
 *
 * Latência percebida = do instante em que o lead PARA de falar até o primeiro áudio do agente tocar.
 * Cada estágio recebe um carimbo em ms (relógio monotônico injetado; em testes, virtual).
 */
export const STAGES = ['speech_end', 'endpoint', 'stt_final', 'llm_first_token', 'first_chunk', 'tts_first_audio', 'playback'] as const
export type Stage = (typeof STAGES)[number]

/** Estágios cujo tempo é o intervalo desde o estágio anterior (speech_end é a origem). */
export const DELTA_STAGES = STAGES.slice(1) as readonly Stage[]

export class TurnTimeline {
  private readonly marks: Partial<Record<Stage, number>> = {}

  /** Só o primeiro carimbo de cada estágio vale (o primeiro token/áudio é o que o lead percebe). */
  mark(stage: Stage, at: number): this {
    if (this.marks[stage] === undefined) this.marks[stage] = at
    return this
  }

  at(stage: Stage): number | undefined { return this.marks[stage] }

  has(stage: Stage): boolean { return this.marks[stage] !== undefined }

  /** Tempo do estágio em relação ao anterior que tenha carimbo. Nulo se faltar ele ou a origem. */
  delta(stage: Stage): number | null {
    const i = STAGES.indexOf(stage)
    const here = this.marks[stage]
    if (i <= 0 || here === undefined) return null
    for (let j = i - 1; j >= 0; j--) {
      const prev = this.marks[STAGES[j]]
      if (prev !== undefined) return Math.max(0, here - prev)
    }
    return null
  }

  /** Latência percebida (fim de fala → áudio tocando). Nulo se o turno não chegou a tocar. */
  total(): number | null {
    const a = this.marks.speech_end
    const b = this.marks.playback
    return a === undefined || b === undefined ? null : Math.max(0, b - a)
  }
}

export interface Summary { n: number; min: number; p50: number; p95: number; p99: number; max: number; mean: number }

/** Percentil por posto mais próximo (nearest-rank) sobre lista ORDENADA. */
export function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return NaN
  const rank = Math.ceil((p / 100) * sorted.length)
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1]
}

export function summarize(values: number[]): Summary | null {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b)
  if (!v.length) return null
  const sum = v.reduce((a, b) => a + b, 0)
  return { n: v.length, min: v[0], p50: percentile(v, 50), p95: percentile(v, 95), p99: percentile(v, 99), max: v[v.length - 1], mean: sum / v.length }
}

export interface LatencyReport {
  turns: number
  completed: number
  total: Summary | null
  stages: Partial<Record<Stage, Summary | null>>
}

export class LatencyRecorder {
  private readonly timelines: TurnTimeline[] = []

  add(t: TurnTimeline): void { this.timelines.push(t) }

  get size(): number { return this.timelines.length }

  report(): LatencyReport {
    const totals = this.timelines.map((t) => t.total()).filter((x): x is number => x !== null)
    const stages: LatencyReport['stages'] = {}
    for (const s of DELTA_STAGES) {
      stages[s] = summarize(this.timelines.map((t) => t.delta(s)).filter((x): x is number => x !== null))
    }
    return { turns: this.timelines.length, completed: totals.length, total: summarize(totals), stages }
  }
}
