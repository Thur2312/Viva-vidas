import { BrainInput, BrainOutput, SalesBrain } from '../brain'
import { testPlaybook } from '../fixtures/test-playbook'
import { FakeLlm, LlmCall, StructuredLlm } from '../llm'
import { PlaybookData } from '../types'
import { flagSensitive } from '../../compliance/redaction'
import { scoreRun } from './rubric'
import { SCENARIOS, Scenario, ScriptedTurn } from './scenarios'

export interface RunResult {
  id: string
  outputs: BrainOutput[]
  /** Por turno: a fala do lead foi marcada como sensível (flagSensitive). */
  sensitive: boolean[]
  /** Chamadas feitas ao LLM (só offline). */
  llmCalls: LlmCall[]
  score: number
  failures: string[]
}

export interface RunOptions {
  playbook?: PlaybookData
  /** Chamado após cada turno (o modo live usa para contar tokens). Retorne false para parar. */
  onTurn?: (o: BrainOutput) => boolean | void
}

type ScenarioRun = Omit<RunResult, 'llmCalls'> & { stopped: boolean }

const clonePlaybook = (): PlaybookData => JSON.parse(JSON.stringify(testPlaybook))

/**
 * Roda os turnos do lead em ordem com a história construída aos poucos.
 * `brainFor` devolve o cérebro de cada turno (offline: um LLM scriptado por turno).
 */
export async function runScenario(brainFor: (turnIndex: number) => SalesBrain, s: Scenario, opts: RunOptions = {}): Promise<ScenarioRun> {
  const playbook = opts.playbook ?? clonePlaybook()
  const history: BrainInput['history'] = []
  const outputs: BrainOutput[] = []
  const sensitive: boolean[] = []
  let profile: BrainInput['profile'] = {}
  let streak = 0
  let id = 0
  let stopped = false

  for (let i = 0; i < s.turns.length; i++) {
    const body = s.turns[i]
    const isSensitive = flagSensitive(body).containsSensitive
    const triggerMessageId = ++id
    history.push({ author: 'lead', body, sensitive: isSensitive, id: triggerMessageId })
    sensitive.push(isSensitive)
    const o = await brainFor(i).decide({
      playbook,
      playbookVersion: 1,
      profile,
      history: [...history],
      summary: null,
      examples: [],
      failedUnderstandingStreak: streak,
      triggerMessageId,
    })
    outputs.push(o)
    profile = o.profile
    streak = o.notUnderstood ? streak + 1 : 0
    if (o.draft.trim()) history.push({ author: 'agente', body: o.draft, sensitive: false, id: ++id })
    if (opts.onTurn?.(o) === false) {
      stopped = true
      break
    }
  }
  const { score, failures } = scoreRun({ outputs }, s)
  return { id: s.id, outputs, sensitive, score, failures, stopped }
}

/** LLM fake que responde por nome de schema, na ordem roteirizada do turno. */
export function scriptedLlm(t: ScriptedTurn | undefined): FakeLlm {
  const q: Record<string, unknown[]> = {
    extrair: t?.extract !== undefined ? [t.extract] : [],
    redigir: (t?.write ?? []).map((texto) => ({ texto })),
    verificar: (t?.verify ?? []).map((v) => ({ aprovado: v.aprovado, motivo: v.motivo ?? '' })),
  }
  const total = Object.values(q).reduce((n, a) => n + a.length, 0)
  const take = (c: LlmCall) => {
    const next = q[c.schemaName]?.shift()
    if (next === undefined) throw new Error(`cenário sem resposta roteirizada para ${c.schemaName}`)
    return next
  }
  return new FakeLlm(Array.from({ length: total }, () => take))
}

export async function runScenarioOffline(s: Scenario, opts: RunOptions = {}): Promise<RunResult> {
  const llms: FakeLlm[] = []
  const r = await runScenario(
    (i) => {
      const llm = scriptedLlm(s.scripted?.[i])
      llms.push(llm)
      return new SalesBrain(llm)
    },
    s,
    opts,
  )
  return { ...r, llmCalls: llms.flatMap((l) => l.calls) }
}

export const runAllOffline = (scenarios: Scenario[] = SCENARIOS): Promise<RunResult[]> => Promise.all(scenarios.map((s) => runScenarioOffline(s)))

export interface LiveSummary {
  results: ScenarioRun[]
  inputTokens: number
  outputTokens: number
  stoppedAt: { scenario: string; turn: number } | null
}

/** Roda contra o modelo real (só com --live). Para quando os tokens somados passam de maxTokens. */
export async function runAllLive(llm: StructuredLlm, scenarios: Scenario[], maxTokens: number): Promise<LiveSummary> {
  const brain = new SalesBrain(llm)
  const results: ScenarioRun[] = []
  let inputTokens = 0
  let outputTokens = 0
  let stoppedAt: LiveSummary['stoppedAt'] = null
  for (const s of scenarios) {
    let turn = 0
    const r = await runScenario(() => brain, s, {
      onTurn: (o) => {
        turn++
        inputTokens += o.inputTokens
        outputTokens += o.outputTokens
        if (inputTokens + outputTokens > maxTokens) {
          stoppedAt = { scenario: s.id, turn }
          return false
        }
      },
    })
    results.push(r)
    if (stoppedAt) break
  }
  return { results, inputTokens, outputTokens, stoppedAt }
}
