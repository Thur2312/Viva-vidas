import { testPlaybook } from './fixtures/test-playbook'
import { renderPlaybookText } from './playbook.service'
import { emptyPlaybookTemplate } from './playbook.template'

describe('renderPlaybookText', () => {
  it('renderiza as seções do playbook de teste', () => {
    const t = renderPlaybookText(testPlaybook)
    expect(t).toContain('EXEMPLO FICTÍCIO DE TESTE')
    expect(t).toContain('plano_atual')
    expect(t).toContain('tá caro')
    expect(t).toContain('FATO FICTÍCIO A')
    expect(t).toContain('Nunca prometer desconto')
    expect(t).toContain('Lead pede um humano')
    expect(t).toContain('20')
    expect(t).toContain('Oi! Ainda posso ajudar?')
  })

  it('nunca inclui os blocos EXEMPLO (não ativo) e omite seções vazias', () => {
    const t = renderPlaybookText({ ...emptyPlaybookTemplate(), oferta: { descricao: 'Vendemos planos', publico: '' } })
    expect(t).not.toContain('EXEMPLO (não ativo)')
    expect(t).toContain('Vendemos planos')
    expect(t).not.toMatch(/Objeções|Fatos|Campos|Cadência|Agenda/)
    expect(renderPlaybookText(emptyPlaybookTemplate())).toBe('')
  })

  it('não quebra com dados malformados', () => {
    expect(() => renderPlaybookText({ campos: 'x', fatos: null } as any)).not.toThrow()
  })
})
