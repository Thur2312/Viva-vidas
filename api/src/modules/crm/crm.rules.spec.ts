import { backoffMs, dealTitle, isTransient, parseStageMap, planFor, safeError } from './crm.rules'
import { CrmApiError } from './crm.types'

const lead = (o: any = {}) => ({ name: 'Maria Souza', opt_out: false, anonymized_at: null, ...o })
const MAP = { qualificado: 12, reuniao_marcada: 13, compareceu: 14 }

describe('planFor', () => {
  it('qualificado e reuniao criam pessoa e negocio na etapa mapeada, com nota sem dado pessoal', () => {
    const p = planFor('reuniao_marcada', null, lead(), {}, MAP)
    expect(p).toMatchObject({ ensurePerson: true, ensureDeal: true, stageId: 13 })
    expect(p.note).not.toMatch(/Maria|Souza|\d{8}/)
  })
  it('contatado e respondeu nao vao para o CRM (minimizacao)', () => {
    expect(planFor('contatado', null, lead(), {}, MAP).skip).toBe('etapa_nao_sincronizada')
    expect(planFor('respondeu', null, lead(), {}, MAP).skip).toBe('etapa_nao_sincronizada')
  })
  it('sem etapa mapeada nao inventa etapa', () => {
    expect(planFor('qualificado', null, lead(), {}, {}).skip).toBe('sem_etapa_mapeada')
  })
  it('venda marca como ganho com o valor; perdido so age se ja ha negocio', () => {
    expect(planFor('venda', 1500, lead(), {}, MAP)).toMatchObject({ status: 'won', value: 1500, ensureDeal: true })
    expect(planFor('perdido', null, lead(), {}, MAP).skip).toBe('perdido_sem_negocio')
    expect(planFor('perdido', null, lead(), { person_id: 1, deal_id: 2 }, MAP)).toMatchObject({ status: 'lost' })
  })
  it('anonimizado e opt-out nunca criam registro no CRM', () => {
    expect(planFor('qualificado', null, lead({ anonymized_at: new Date() }), {}, MAP).skip).toBe('anonimizado')
    expect(planFor('qualificado', null, lead({ opt_out: true }), {}, MAP).skip).toBe('opt_out')
    expect(planFor('opt_out', null, lead({ opt_out: true }), {}, MAP).skip).toBe('opt_out_sem_registro')
  })
  it('opt-out de quem ja esta no CRM deixa uma nota e encerra o negocio', () => {
    const p = planFor('opt_out', null, lead({ opt_out: true }), { person_id: 1, deal_id: 2 }, MAP)
    expect(p).toMatchObject({ status: 'lost' })
    expect(p.note).toMatch(/opt-out/)
    expect(p.ensurePerson).toBeFalsy()
  })
})

describe('regras de fila', () => {
  it('espera cresce de 30s ate o teto de 1h', () => {
    expect(backoffMs(1)).toBe(30_000)
    expect(backoffMs(2)).toBe(60_000)
    expect(backoffMs(20)).toBe(3_600_000)
  })
  it('so rede, 429 e 5xx valem nova tentativa', () => {
    expect(isTransient(new CrmApiError(0))).toBe(true)
    expect(isTransient(new CrmApiError(429))).toBe(true)
    expect(isTransient(new CrmApiError(503))).toBe(true)
    expect(isTransient(new CrmApiError(401))).toBe(false)
    expect(isTransient(new CrmApiError(400))).toBe(false)
    expect(isTransient(new Error('x'))).toBe(false)
  })
  it('parseStageMap aceita so inteiros positivos das etapas conhecidas', () => {
    expect(parseStageMap('{"qualificado":12,"reuniao_marcada":"13","venda":99,"compareceu":-1}')).toEqual({ qualificado: 12 })
    expect(parseStageMap('nao e json')).toEqual({})
    expect(parseStageMap(undefined)).toEqual({})
  })
  it('titulo do negocio leva so o primeiro nome', () => {
    expect(dealTitle('Maria Souza Lima')).toBe('WhatsApp · Maria')
    expect(dealTitle(null)).toBe('WhatsApp · Lead')
  })
  it('safeError nunca devolve corpo de resposta', () => {
    expect(safeError(new CrmApiError(400, 'POST /persons'))).toBe('POST /persons: HTTP 400')
    expect(safeError(new Error('telefone 5583999991234'))).toBe('Error')
  })
})
