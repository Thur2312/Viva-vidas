import { emptyPlaybookTemplate } from './playbook.template'
import { validatePlaybook } from './playbook.validate'
import { testPlaybook } from './fixtures/test-playbook'
import { PlaybookData } from './types'

const clone = (): PlaybookData => JSON.parse(JSON.stringify(testPlaybook))

describe('validatePlaybook', () => {
  it('modelo vazio é incompleto e aponta oferta, campos e fatos', () => {
    const r = validatePlaybook(emptyPlaybookTemplate())
    expect(r.complete).toBe(false)
    for (const s of ['oferta', 'campos', 'fatos']) {
      expect(r.missing.some((m) => m.startsWith(s))).toBe(true)
    }
  })

  it('modelo vazio só tem exemplos rotulados', () => {
    const t = emptyPlaybookTemplate()
    for (const v of Object.values(t.exemplos ?? {})) expect(v).toContain('EXEMPLO (não ativo)')
  })

  it('playbook de teste fictício é completo', () => {
    expect(validatePlaybook(testPlaybook)).toEqual({ complete: true, missing: [] })
    expect(testPlaybook.oferta.descricao).toContain('EXEMPLO FICTÍCIO DE TESTE')
  })

  it('detecta chave duplicada', () => {
    const d = clone()
    d.campos.push({ ...d.campos[1], ordem: 9 })
    expect(validatePlaybook(d).missing).toContain('campos: chave duplicada (vidas)')
  })

  it('campo sensível não pode ser obrigatório', () => {
    const d = clone()
    d.campos[3].obrigatorio = true
    expect(validatePlaybook(d).missing.some((m) => m.includes('campo sensível não pode ser obrigatório'))).toBe(true)
  })

  it('predicado com campo inexistente é erro', () => {
    const d = clone()
    d.criterios.qualificado = { campo: 'inexistente', op: 'presente' }
    const r = validatePlaybook(d)
    expect(r.complete).toBe(false)
    expect(r.missing.some((m) => m.includes('campo inexistente (inexistente)'))).toBe(true)
  })
})
