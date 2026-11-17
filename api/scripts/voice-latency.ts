/**
 * Simula a latência do agente de voz (tempo virtual, sem rede, sem chave).
 * Uso: npm run voice:latency -- [--turns 1000] [--seed 1] [--profile cascata-br]
 * Os perfis são suposições; o resultado serve para comparar arquiteturas, não para atestar a meta.
 */
import { PROFILES, runScenario } from '../src/modules/voice/latency/latency-harness'
import { DELTA_STAGES } from '../src/modules/voice/latency/latency-tracker'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i > -1 ? process.argv[i + 1] : undefined
}

const turns = Number(arg('turns') ?? 1000)
const seed = Number(arg('seed') ?? 1)
const only = arg('profile')
const names = only ? [only] : Object.keys(PROFILES)
const ms = (n: number | undefined) => (n === undefined || Number.isNaN(n) ? '   -' : String(Math.round(n)).padStart(5))

for (const name of names) {
  const r = runScenario(name, { turns, seed })
  console.log(`\n== ${name}: ${r.description}`)
  console.log('estágio              p50    p95    p99')
  for (const s of DELTA_STAGES) {
    const x = r.report.stages[s]
    console.log(`${s.padEnd(18)} ${ms(x?.p50)}  ${ms(x?.p95)}  ${ms(x?.p99)}`)
  }
  const t = r.report.total
  console.log(`${'TOTAL'.padEnd(18)} ${ms(t?.p50)}  ${ms(t?.p95)}  ${ms(t?.p99)}`)
  console.log(`dominante (p95): ${r.dominantStage} | meta: ${r.verdict.ok ? 'dentro' : 'FORA'}`)
  for (const v of r.verdict.violations) console.log(`  - ${v.scope}: ${Math.round(v.actual)} > ${v.limit} ms`)
}
console.log('\nAviso: perfis são SUPOSIÇÕES. Meta só vale com medição real (LatencyRecorder).')
