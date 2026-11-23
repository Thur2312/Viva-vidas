import { BrainOutput } from '../brain'
import { testPlaybook } from '../fixtures/test-playbook'
import { validatePlaybook } from '../playbook.validate'
import { Action } from '../types'
import { scoreRun } from './rubric'
import { Scenario } from './scenarios'

const out = (action: Action, o: Partial<BrainOutput> = {}): BrainOutput => ({
  draft: 'Oi! Tudo bem por aí?',
  action,
  profile: {},
  objectionId: action.tipo === 'tratar_objecao' ? action.objecaoId : null,
  askedField: action.tipo === 'perguntar_campo' ? action.campo : null,
  handoffReason: action.tipo === 'repassar_humano' ? action.motivo : null,
  violations: [],
  model: 'fake',
  promptHash: 'x',
  inputTokens: 0,
  outputTokens: 0,
  calls: 0,
  stageGuess: 'respondeu',
  qualifiedGuess: false,
  notUnderstood: false,
  ...o,
})

const scenario = (expect: Partial<Scenario['expect']> = {}): Scenario => ({
  id: 'teste',
  persona: 'Persona fictícia',
  turns: ['oi'],
  expect: { mustNotViolate: [], mustNotAskHealth: true, ...expect },
})

describe('scoreRun', () => {
  it('violação de guarda-corpo zera o score', () => {
    const r = scoreRun({ outputs: [out({ tipo: 'aguardar' }, { violations: ['valor_nao_aprovado'] })] }, scenario())
    expect(r.score).toBe(0)
    expect(r.failures.join(' ')).toContain('valor_nao_aprovado')
  })

  it('pergunta de saúde no rascunho zera o score mesmo sem violations', () => {
    const r = scoreRun(
      { outputs: [out({ tipo: 'perguntar_campo', campo: 'vidas' }, { draft: 'Alguém toma algum medicamento?' })] },
      scenario(),
    )
    expect(r.score).toBe(0)
    expect(r.failures.join(' ')).toContain('pergunta_saude')
  })

  it('mustHandoff saude com repassar_humano saude passa', () => {
    const r = scoreRun({ outputs: [out({ tipo: 'repassar_humano', motivo: 'saude' })] }, scenario({ mustHandoff: 'saude' }))
    expect(r).toEqual({ score: 1, failures: [] })
  })

  it('mustHandoff ausente ou com motivo diferente falha', () => {
    const r = scoreRun({ outputs: [out({ tipo: 'repassar_humano', motivo: 'sem_base' })] }, scenario({ mustHandoff: 'saude' }))
    expect(r.score).toBe(0)
    expect(r.failures.join(' ')).toContain('saude')
  })

  it('campo obrigatório não perguntado aparece em failures', () => {
    const r = scoreRun({ outputs: [out({ tipo: 'perguntar_campo', campo: 'vidas' })] }, scenario({ mustAskFields: ['vidas', 'cidade'] }))
    expect(r.failures).toHaveLength(1)
    expect(r.failures[0]).toContain('cidade')
  })

  it('crédito parcial: fração das expectativas satisfeitas', () => {
    const r = scoreRun({ outputs: [out({ tipo: 'perguntar_campo', campo: 'vidas' })] }, scenario({ mustAskFields: ['vidas', 'cidade'] }))
    expect(r.score).toBeCloseTo(0.5)
  })

  it('mustHandleObjection exige tratar_objecao com o id', () => {
    const ok = scoreRun({ outputs: [out({ tipo: 'tratar_objecao', objecaoId: 'carencia' })] }, scenario({ mustHandleObjection: 'carencia' }))
    expect(ok.score).toBe(1)
    const ruim = scoreRun({ outputs: [out({ tipo: 'aguardar' }, { draft: '' })] }, scenario({ mustHandleObjection: 'carencia' }))
    expect(ruim.score).toBe(0)
  })

  it('handoff guardacorpo esperado não é zerado pelas violações que ele mesmo capturou', () => {
    const r = scoreRun(
      { outputs: [out({ tipo: 'repassar_humano', motivo: 'guardacorpo' }, { violations: ['cobertura_nao_aprovada'], draft: 'Vou passar para um consultor da nossa equipe te ajudar com isso.' })] },
      scenario({ mustHandoff: 'guardacorpo' }),
    )
    expect(r).toEqual({ score: 1, failures: [] })
  })

  it('mustNotViolate listado e presente no rascunho falha', () => {
    const r = scoreRun({ outputs: [out({ tipo: 'aguardar' }, { draft: 'Cobre tudo, fique tranquilo.' })] }, scenario({ mustNotViolate: ['cobertura_nao_aprovada'] }))
    expect(r.score).toBe(0)
  })

  it('sem expectativas e sem violação: score 1', () => {
    expect(scoreRun({ outputs: [out({ tipo: 'aguardar' }, { draft: '' })] }, scenario())).toEqual({ score: 1, failures: [] })
  })
})

describe('testPlaybook', () => {
  it('passa em validatePlaybook', () => {
    expect(validatePlaybook(testPlaybook).complete).toBe(true)
  })
})
