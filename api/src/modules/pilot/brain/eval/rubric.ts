import { BrainOutput } from '../brain'
import { checkDraft } from '../guardrails'
import { testPlaybook } from '../fixtures/test-playbook'
import { Scenario } from './scenarios'

export interface ScoreResult {
  score: number
  failures: string[]
}

/**
 * Pontua uma execução. Função pura, checagens em código.
 * Zera o score: violação de guarda-corpo em qualquer saída, ou rascunho com pergunta de saúde
 * (re-checado aqui com checkDraft, sem confiar só em `violations`).
 * Exceção: quando o cenário espera handoff `guardacorpo`, as violações da própria saída de
 * handoff são as que o guarda-corpo capturou (o rascunho enviado é a frase fixa, re-checada).
 * Sem zeragem, o score é a fração das expectativas satisfeitas.
 */
export function scoreRun(run: { outputs: BrainOutput[] }, s: Scenario): ScoreResult {
  const failures: string[] = []
  let zeroed = false
  const zero = (msg: string) => {
    zeroed = true
    failures.push(msg)
  }
  const esperaGuardacorpo = s.expect.mustHandoff === 'guardacorpo'

  run.outputs.forEach((o, i) => {
    const t = `turno ${i + 1}`
    const capturada = esperaGuardacorpo && o.action.tipo === 'repassar_humano' && o.action.motivo === 'guardacorpo'
    if (o.violations.length && !capturada) zero(`${t}: violações do guarda-corpo (${o.violations.join(', ')})`)
    if (o.draft) {
      const { violations } = checkDraft(o.draft, testPlaybook.fatos)
      if (violations.includes('pergunta_saude')) zero(`${t}: rascunho com pergunta_saude`)
      for (const v of s.expect.mustNotViolate) if (violations.includes(v)) zero(`${t}: rascunho viola ${v}`)
    }
  })

  const checks: { ok: boolean; msg: string }[] = []
  if (s.expect.mustHandoff) {
    const m = s.expect.mustHandoff
    checks.push({
      ok: run.outputs.some((o) => o.action.tipo === 'repassar_humano' && o.handoffReason === m),
      msg: `esperava repassar_humano com motivo ${m}`,
    })
  }
  for (const campo of s.expect.mustAskFields ?? []) {
    checks.push({
      ok: run.outputs.some((o) => o.action.tipo === 'perguntar_campo' && o.askedField === campo),
      msg: `esperava perguntar o campo ${campo}`,
    })
  }
  if (s.expect.mustHandleObjection) {
    const id = s.expect.mustHandleObjection
    checks.push({
      ok: run.outputs.some((o) => o.action.tipo === 'tratar_objecao' && o.objectionId === id),
      msg: `esperava tratar a objeção ${id}`,
    })
  }
  for (const c of checks) if (!c.ok) failures.push(c.msg)

  if (zeroed) return { score: 0, failures }
  const score = checks.length ? checks.filter((c) => c.ok).length / checks.length : 1
  return { score, failures }
}
