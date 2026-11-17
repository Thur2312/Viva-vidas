import { DEFAULT_BUDGET, LatencyBudget, evaluateBudget } from './latency-budget'
import { DELTA_STAGES, LatencyRecorder, LatencyReport, Stage, TurnTimeline } from './latency-tracker'

/**
 * Simulador de latência com tempo VIRTUAL (nada dorme, nada chama rede).
 *
 * Serve para comparar arquiteturas e achar o estágio dominante ANTES de ter provedor real.
 * Os perfis abaixo são SUPOSIÇÕES de ordem de grandeza (faixas típicas de mercado), não medições nossas:
 * cada estágio é lognormal com mediana e dispersão. Substituir pelos números reais do `LatencyRecorder`
 * na primeira ligação de teste; só a medição real vale para dizer que a meta foi atingida.
 */
export interface StageDist { median: number; sigma: number }
export type LatencyProfile = Record<Exclude<Stage, 'speech_end'>, StageDist>

export const PROFILES: Record<string, { description: string; profile: LatencyProfile }> = {
  'cascata-br': {
    description: 'STT + LLM + TTS em streaming, tudo com baixa distância da VPS (suposição otimista)',
    profile: {
      endpoint: { median: 240, sigma: 0.25 },
      stt_final: { median: 110, sigma: 0.35 },
      llm_first_token: { median: 320, sigma: 0.4 },
      first_chunk: { median: 60, sigma: 0.5 },
      tts_first_audio: { median: 170, sigma: 0.35 },
      playback: { median: 30, sigma: 0.3 },
    },
  },
  'cascata-eua': {
    description: 'Mesma cascata, mas STT/LLM/TTS nos EUA: cada ida e volta soma ~150 a 250 ms',
    profile: {
      endpoint: { median: 240, sigma: 0.25 },
      stt_final: { median: 260, sigma: 0.35 },
      llm_first_token: { median: 520, sigma: 0.4 },
      first_chunk: { median: 60, sigma: 0.5 },
      tts_first_audio: { median: 330, sigma: 0.35 },
      playback: { median: 30, sigma: 0.3 },
    },
  },
  'voz-nativa': {
    description: 'Modelo de voz nativa (áudio entra e sai do mesmo modelo): sem STT/LLM/TTS separados',
    profile: {
      endpoint: { median: 250, sigma: 0.25 },
      stt_final: { median: 1, sigma: 0.1 },
      llm_first_token: { median: 1, sigma: 0.1 },
      first_chunk: { median: 1, sigma: 0.1 },
      tts_first_audio: { median: 330, sigma: 0.4 },
      playback: { median: 40, sigma: 0.3 },
    },
  },
}

/** PRNG determinístico (mulberry32): mesma semente, mesmo resultado. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function lognormal(rand: () => number, d: StageDist): number {
  const u1 = Math.max(rand(), 1e-12)
  const u2 = rand()
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
  return d.median * Math.exp(d.sigma * z)
}

export function simulateTurn(profile: LatencyProfile, rand: () => number, startAt = 0): TurnTimeline {
  const t = new TurnTimeline()
  let now = startAt
  t.mark('speech_end', now)
  for (const s of DELTA_STAGES) {
    now += lognormal(rand, profile[s as keyof LatencyProfile])
    t.mark(s, now)
  }
  return t
}

export interface ScenarioResult { name: string; description: string; report: LatencyReport; dominantStage: Stage | null; verdict: ReturnType<typeof evaluateBudget> }

export function runScenario(name: string, opts: { turns?: number; seed?: number; budget?: LatencyBudget } = {}): ScenarioResult {
  const def = PROFILES[name]
  if (!def) throw new Error(`Perfil desconhecido: ${name}. Disponíveis: ${Object.keys(PROFILES).join(', ')}`)
  const turns = opts.turns ?? 1000
  const rand = seededRandom(opts.seed ?? 1)
  const rec = new LatencyRecorder()
  for (let i = 0; i < turns; i++) rec.add(simulateTurn(def.profile, rand))
  const report = rec.report()
  let dominant: Stage | null = null
  let worst = -1
  for (const s of DELTA_STAGES) {
    const p95 = report.stages[s]?.p95 ?? -1
    if (p95 > worst) { worst = p95; dominant = s }
  }
  return { name, description: def.description, report, dominantStage: dominant, verdict: evaluateBudget(report, opts.budget ?? DEFAULT_BUDGET) }
}
