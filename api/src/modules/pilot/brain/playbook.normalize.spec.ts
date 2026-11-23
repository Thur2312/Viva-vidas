import { SalesBrain } from './brain'
import { FakeLlm } from './llm'
import { normalizePlaybook } from './playbook.normalize'
import { renderPlaybookText } from './playbook.service'
import { emptyPlaybookTemplate } from './playbook.template'
import { validatePlaybook } from './playbook.validate'
import { buildExtractSystem, buildVerifySystem, buildWriteSystem, extractSchema } from './prompts'
import { testPlaybook } from './fixtures/test-playbook'
import { Action, PlaybookData } from './types'

const clone = (): any => JSON.parse(JSON.stringify(testPlaybook))

// Entradas malformadas/parciais que chegam pela API (DTO só exige objeto) ou de linhas legadas.
const MALFORMED: unknown[] = [
  null,
  undefined,
  'texto',
  42,
  [],
  {},
  { oferta: 'x', campos: 'y', criterios: 7, objecoes: {}, fatos: null, tom: [], regrasProibidas: 'z', agenda: 1, cadencia: 'a' },
  { campos: [null, 1, 'x', { chave: 5, pergunta: {}, sensivel: 'sim' }], objecoes: [{ id: 1, nuncaDizer: 'texto' }, null] },
  { criterios: { qualificado: { all: 'x' }, desqualificado: { campo: 3, op: 'eq' } } },
  { criterios: { qualificado: { any: [null, { campo: 'a', op: 'nao_existe' }, { all: [{ campo: 'b', op: 'presente' }] }] } } },
  { tom: { formalidade: 1, frases: [1, 'ok', null] }, agenda: { duracaoMin: '20', tiposReuniao: 'x' }, cadencia: { maxTentativas: 'abc' } },
  (() => {
    // "completo" mas sem regrasProibidas, tom.frases e nuncaDizer (o caso do review)
    const p = clone()
    delete p.regrasProibidas
    delete p.tom.frases
    for (const o of p.objecoes) delete o.nuncaDizer
    return p
  })(),
]

describe('normalizePlaybook', () => {
  it('playbook completo e válido sai igual (sem exemplos)', () => {
    expect(normalizePlaybook(testPlaybook)).toEqual(testPlaybook)
    const comExemplos = { ...clone(), exemplos: { oferta: 'EXEMPLO (não ativo): x' } }
    expect(normalizePlaybook(comExemplos)).not.toHaveProperty('exemplos')
  })

  it('copia só chaves conhecidas e preenche padrões', () => {
    const n = normalizePlaybook({ lixo: 1, oferta: { descricao: 'd', extra: 'y' } })
    expect(n).not.toHaveProperty('lixo')
    expect(n.oferta).toEqual({ descricao: 'd', publico: '' })
    expect(n.campos).toEqual([])
    expect(n.criterios).toEqual({})
    expect(n.tom).toEqual({ formalidade: '', tamanho: '', emoji: '', frases: [] })
    expect(n.regrasProibidas).toEqual([])
    expect(n.passagemHumano).toEqual({ quando: [] })
    expect(n.agenda).toEqual({ tiposReuniao: [], duracaoMin: 0, janelas: '', prometer: '' })
    expect(n.cadencia).toEqual({ maxTentativas: 0, mensagem: '' })
  })

  it('coage tipos: listas de string, números, booleanos; campo sensível nunca obrigatório', () => {
    const n = normalizePlaybook({
      campos: [null, { chave: 'c', pergunta: 'p?', obrigatorio: 1, sensivel: true, ordem: '3', valores: ['a', 2, 'b'] }],
      objecoes: [{ id: 'o', gatilho: 'g', resposta: 'r', nuncaDizer: 'x' }],
      tom: { frases: ['oi', 3] },
      agenda: { duracaoMin: '20' },
      cadencia: { maxTentativas: 'abc' },
    })
    expect(n.campos).toEqual([{ chave: 'c', pergunta: 'p?', porque: '', obrigatorio: false, ordem: 3, sensivel: true, valores: ['a', 'b'] }])
    expect(n.objecoes).toEqual([{ id: 'o', gatilho: 'g', resposta: 'r', nuncaDizer: [] }])
    expect(n.tom.frases).toEqual(['oi'])
    expect(n.agenda.duracaoMin).toBe(20)
    expect(n.cadencia.maxTentativas).toBe(0)
  })

  it('critérios: mantém predicados válidos e descarta os inválidos', () => {
    const n = normalizePlaybook({
      criterios: {
        qualificado: { all: [{ campo: 'vidas', op: 'gte', valor: 1 }, { campo: 'x', op: 'nao_existe' }, null, { any: [{ campo: 'cidade', op: 'presente', valor: {} }] }] },
        desqualificado: { campo: 3, op: 'eq' },
      },
    })
    expect(n.criterios).toEqual({
      qualificado: { all: [{ campo: 'vidas', op: 'gte', valor: 1 }, { any: [{ campo: 'cidade', op: 'presente' }] }] },
    })
  })

  it.each(MALFORMED.map((m, i) => [i, m]))('entrada malformada #%i: nada lança (normalize, validate, render, prompts, decide)', async (_i, raw) => {
    const n = normalizePlaybook(raw)
    expect(() => validatePlaybook(n)).not.toThrow()
    expect(() => renderPlaybookText(n)).not.toThrow()
    const actions: Action[] = [
      { tipo: 'perguntar_campo', campo: 'x' },
      { tipo: 'tratar_objecao', objecaoId: n.objecoes[0]?.id ?? 'x' },
      { tipo: 'responder_duvida', fatoId: 'x' },
      { tipo: 'propor_horario' },
    ]
    expect(() => buildExtractSystem(n, {})).not.toThrow()
    expect(() => extractSchema(n)).not.toThrow()
    for (const action of actions) {
      expect(() => buildWriteSystem({ playbook: n, playbookVersion: 1, profile: {}, action })).not.toThrow()
      expect(() => buildVerifySystem(n, action)).not.toThrow()
    }
    if (validatePlaybook(n).complete) return // o caso "completo" é exercitado no teste seguinte
    const out = await new SalesBrain(new FakeLlm([])).decide({
      playbook: raw as PlaybookData,
      playbookVersion: 1,
      profile: {},
      history: [{ author: 'lead', body: 'oi', sensitive: false, id: 1 }],
      summary: null,
      examples: [],
      failedUnderstandingStreak: 0,
      triggerMessageId: 1,
    })
    expect(out.handoffReason).toBe('playbook_incompleto')
  })

  it('decide com playbook "completo" sem regrasProibidas/tom.frases/nuncaDizer não lança e redige', async () => {
    const raw = MALFORMED[MALFORMED.length - 1] as PlaybookData
    const llm = new FakeLlm([
      { campos: {}, objecao_id: 'preco', pergunta_fato_id: null, pergunta_sem_fato: false, pediu_humano: false, nao_entendeu: false },
      { texto: 'Entendo! Posso te mostrar opções?' },
    ])
    const out = await new SalesBrain(llm).decide({
      playbook: raw,
      playbookVersion: 1,
      profile: {},
      history: [{ author: 'lead', body: 'tá caro', sensitive: false, id: 1 }],
      summary: null,
      examples: [],
      failedUnderstandingStreak: 0,
      triggerMessageId: 1,
    })
    expect(out.action).toEqual({ tipo: 'tratar_objecao', objecaoId: 'preco' })
    expect(out.draft).toBe('Entendo! Posso te mostrar opções?')
  })
})

describe('validatePlaybook robusto', () => {
  it.each(MALFORMED.map((m, i) => [i, m]))('entrada crua malformada #%i: nunca lança, devolve incompleto ou completo', (_i, raw) => {
    let r: ReturnType<typeof validatePlaybook> | undefined
    expect(() => {
      r = validatePlaybook(raw as PlaybookData)
    }).not.toThrow()
    expect(typeof r!.complete).toBe('boolean')
  })

  it('texto não-string não lança (vazio)', () => {
    const p = clone()
    p.oferta.descricao = 123
    p.campos[0].chave = { x: 1 }
    p.objecoes[0].gatilho = ['a']
    p.fatos[0].texto = 5
    p.tom.formalidade = true
    const r = validatePlaybook(p)
    expect(r.complete).toBe(false)
    expect(r.missing).toContain('oferta: descreva o que a corretora vende')
  })

  it('modelo vazio continua incompleto', () => {
    expect(validatePlaybook(emptyPlaybookTemplate()).complete).toBe(false)
  })
})
