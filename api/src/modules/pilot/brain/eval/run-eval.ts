/**
 * Banco de testes do agente de vendas.
 * Uso: npm run eval            (offline: pipeline real com LLM scriptado, sem rede nem chave)
 *      npm run eval -- --live  (modelo real; custa dinheiro; exige chave; limite EVAL_MAX_TOKENS)
 */
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { createStructuredLlm } from '../llm'
import { PROMPT_HASH } from '../prompts'
import { runAllLive, runAllOffline } from './harness'
import { SCENARIOS } from './scenarios'

const pad = (s: string, n: number) => s.padEnd(n)

function printTable(rows: { id: string; score: number; failures: string[] }[]) {
  console.log(`${pad('cenário', 34)}${pad('score', 8)}falhas`)
  for (const r of rows) console.log(`${pad(r.id, 34)}${pad(r.score.toFixed(2), 8)}${r.failures.join('; ') || '-'}`)
}

const stamp = (d = new Date()) => {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`
}

async function offline(): Promise<number> {
  console.log('modo offline: pipeline real com LLM scriptado (sem chave)')
  const results = await runAllOffline()
  printTable(results)
  return results.some((r) => r.score < 1 || r.failures.length) ? 1 : 0
}

async function live(): Promise<number> {
  const llm = createStructuredLlm(process.env)
  if (!llm.enabled) {
    console.log('sem chave: --live indisponível')
    return 2
  }
  const raw = Number(process.env.EVAL_MAX_TOKENS)
  const maxTokens = Number.isFinite(raw) && raw > 0 ? raw : 200000
  console.log(`modo live: provedor ${llm.provider}, limite de ${maxTokens} tokens`)
  const sum = await runAllLive(llm, SCENARIOS, maxTokens)
  printTable(sum.results)
  let model = 'none'
  for (const r of sum.results) for (const o of r.outputs) if (o.model !== 'none') model = o.model
  // Nunca grava o texto do lead: só índices, ações, motivos, violações e contagens.
  const file = {
    promptHash: PROMPT_HASH,
    provider: llm.provider,
    model,
    maxTokens,
    tokens: { input: sum.inputTokens, output: sum.outputTokens },
    stoppedAt: sum.stoppedAt,
    scenarios: sum.results.map((r) => ({
      id: r.id,
      score: r.score,
      failures: r.failures,
      turns: r.outputs.map((o, i) => ({
        turn: i + 1,
        sensitive: r.sensitive[i],
        action: o.action,
        handoffReason: o.handoffReason,
        violations: o.violations,
        guardEvents: o.guardEvents,
        intendedAction: o.intendedAction,
        inputTokens: o.inputTokens,
        outputTokens: o.outputTokens,
      })),
    })),
  }
  const dir = join(process.cwd(), 'eval-results')
  mkdirSync(dir, { recursive: true })
  const path = join(dir, `${PROMPT_HASH}-${stamp()}.json`)
  writeFileSync(path, JSON.stringify(file, null, 2))
  console.log(`resultado gravado em ${path}`)
  if (sum.stoppedAt) {
    console.log(`parou em ${sum.stoppedAt.scenario} (turno ${sum.stoppedAt.turn}): EVAL_MAX_TOKENS excedido`)
    return 3
  }
  return sum.results.some((r) => r.score < 1 || r.failures.length) ? 1 : 0
}

;(process.argv.includes('--live') ? live() : offline()).then(
  (code) => process.exit(code),
  (e) => {
    console.error(e instanceof Error ? e.message : 'erro inesperado')
    process.exit(1)
  },
)
