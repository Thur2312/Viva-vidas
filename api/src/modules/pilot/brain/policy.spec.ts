import { decideAction, PolicyInput } from './policy'
import * as validate from './playbook.validate'
import { testPlaybook } from './fixtures/test-playbook'
import { PlaybookData, Profile } from './types'

const clone = (): PlaybookData => JSON.parse(JSON.stringify(testPlaybook))
const entry = (valor: string | number | boolean) => ({ valor, confianca: 0.9, msgId: '1' })

function input(over: Partial<PolicyInput> = {}): PolicyInput {
  return {
    playbook: clone(),
    profile: {},
    signals: { pediuHumano: false, falouSaude: false, naoEntendeu: false, objecaoId: null, perguntaFatoId: null },
    failedUnderstandingStreak: 0,
    ...over,
  }
}

const full: Profile = { plano_atual: entry('sim'), vidas: entry(3), cidade: entry('Recife') }

describe('decideAction', () => {
  it('playbook ausente -> playbook_incompleto', () => {
    expect(decideAction(input({ playbook: null }))).toEqual({ tipo: 'repassar_humano', motivo: 'playbook_incompleto' })
  })

  it('playbook incompleto -> playbook_incompleto', () => {
    const pb = clone()
    pb.campos = []
    expect(decideAction(input({ playbook: pb }))).toEqual({ tipo: 'repassar_humano', motivo: 'playbook_incompleto' })
  })

  it('playbook incompleto vence pediuHumano', () => {
    const i = input({ playbook: null })
    i.signals.pediuHumano = true
    expect(decideAction(i)).toEqual({ tipo: 'repassar_humano', motivo: 'playbook_incompleto' })
  })

  it('pediuHumano -> pediu_humano', () => {
    const i = input()
    i.signals.pediuHumano = true
    expect(decideAction(i)).toEqual({ tipo: 'repassar_humano', motivo: 'pediu_humano' })
  })

  it('falouSaude -> saude', () => {
    const i = input()
    i.signals.falouSaude = true
    expect(decideAction(i)).toEqual({ tipo: 'repassar_humano', motivo: 'saude' })
  })

  it('streak >= 2 -> nao_entendeu', () => {
    expect(decideAction(input({ failedUnderstandingStreak: 2 }))).toEqual({ tipo: 'repassar_humano', motivo: 'nao_entendeu' })
  })

  it('streak 1 nao repassa', () => {
    expect(decideAction(input({ failedUnderstandingStreak: 1 })).tipo).toBe('perguntar_campo')
  })

  it('objecao conhecida -> tratar_objecao', () => {
    const i = input()
    i.signals.objecaoId = 'preco'
    expect(decideAction(i)).toEqual({ tipo: 'tratar_objecao', objecaoId: 'preco' })
  })

  it('objecao desconhecida -> sem_base', () => {
    const i = input()
    i.signals.objecaoId = 'inexistente'
    expect(decideAction(i)).toEqual({ tipo: 'repassar_humano', motivo: 'sem_base' })
  })

  it('perguntaFatoId conhecido -> responder_duvida', () => {
    const i = input()
    i.signals.perguntaFatoId = 'fato_a'
    expect(decideAction(i)).toEqual({ tipo: 'responder_duvida', fatoId: 'fato_a' })
  })

  it('perguntaFatoId desconhecido -> sem_base', () => {
    const i = input()
    i.signals.perguntaFatoId = 'nada'
    expect(decideAction(i)).toEqual({ tipo: 'repassar_humano', motivo: 'sem_base' })
  })

  it('desqualificado -> aguardar', () => {
    expect(decideAction(input({ profile: { ...full, vidas: entry(0) } }))).toEqual({ tipo: 'aguardar' })
  })

  it('qualificado -> propor_horario', () => {
    expect(decideAction(input({ profile: full }))).toEqual({ tipo: 'propor_horario' })
  })

  it('primeiro campo ausente por ordem -> perguntar_campo', () => {
    expect(decideAction(input())).toEqual({ tipo: 'perguntar_campo', campo: 'plano_atual' })
  })

  it('dois campos faltando devolve o de menor ordem', () => {
    const pb = clone()
    pb.campos = [...pb.campos].reverse()
    expect(decideAction(input({ playbook: pb, profile: { plano_atual: entry('sim') } }))).toEqual({
      tipo: 'perguntar_campo',
      campo: 'vidas',
    })
  })

  it('campo sensivel nunca e escolhido (defesa mesmo se o validador falhar)', () => {
    const pb = clone()
    const s = pb.campos.find((c) => c.chave === 'condicao_saude')!
    s.obrigatorio = true
    s.ordem = 0
    const spy = jest.spyOn(validate, 'validatePlaybook').mockReturnValue({ complete: true, missing: [] })
    try {
      expect(decideAction(input({ playbook: pb }))).toEqual({ tipo: 'perguntar_campo', campo: 'plano_atual' })
    } finally {
      spy.mockRestore()
    }
  })

  it('tudo coletado e criterio sem resposta -> propor_horario', () => {
    const pb = clone()
    pb.criterios = { qualificado: { campo: 'vidas', op: 'gte', valor: 99 } }
    expect(decideAction(input({ playbook: pb, profile: full }))).toEqual({ tipo: 'propor_horario' })
  })
})
