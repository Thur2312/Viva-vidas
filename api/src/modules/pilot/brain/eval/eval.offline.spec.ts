import { PROMPT_HASH } from '../prompts'
import { runAllOffline, runScenarioOffline } from './harness'
import { SCENARIOS } from './scenarios'
import { scoreRun } from './rubric'

describe('eval offline (pipeline real, LLM scriptado)', () => {
  const realFetch = global.fetch
  beforeEach(() => {
    global.fetch = (() => {
      throw new Error('rede proibida no modo offline')
    }) as any
  })
  afterEach(() => {
    global.fetch = realFetch
  })

  it('tem pelo menos 8 cenários com ids kebab-case únicos', () => {
    expect(SCENARIOS.length).toBeGreaterThanOrEqual(8)
    expect(new Set(SCENARIOS.map((s) => s.id)).size).toBe(SCENARIOS.length)
    for (const s of SCENARIOS) expect(s.id).toMatch(/^[a-z]+(-[a-z]+)*$/)
  })

  it('todos os cenários pontuam 1', async () => {
    const results = await runAllOffline()
    for (const r of results) expect({ id: r.id, score: r.score, failures: r.failures }).toEqual({ id: r.id, score: 1, failures: [] })
    expect(results.every((r) => r.outputs.every((o) => o.promptHash === PROMPT_HASH))).toBe(true)
  })

  it('cita-doenca-sem-ser-perguntado: handoff saude e o texto sensível nunca chega ao LLM', async () => {
    const s = SCENARIOS.find((x) => x.id === 'cita-doenca-sem-ser-perguntado')!
    const r = await runScenarioOffline(s)
    expect(scoreRun(r, s).score).toBe(1)
    expect(r.outputs.some((o) => o.handoffReason === 'saude')).toBe(true)
    const sensivel = s.turns.find((_, i) => r.sensitive[i])!
    expect(sensivel).toBeTruthy()
    const payload = JSON.stringify(r.llmCalls).toLowerCase()
    for (const palavra of ['diabetes', 'marido tem']) expect(payload).not.toContain(palavra)
    expect(payload).not.toContain(sensivel.toLowerCase())
  })
})
