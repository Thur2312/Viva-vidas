import { checkDraft } from './guardrails'
import type { ApprovedFact } from './types'

const fato = (texto: string, id = 'f1'): ApprovedFact => ({ id, texto })

describe('checkDraft', () => {
  it('texto limpo com uma pergunta retorna [] e risky false', () => {
    const r = checkDraft('Oi Maria, tudo bem?', [])
    expect(r).toEqual({ violations: [], risky: false })
  })

  describe('valores', () => {
    it('valor sem fato aprovado', () => {
      const r = checkDraft('O plano sai R$ 350 por mês', [])
      expect(r.violations).toContain('valor_nao_aprovado')
      expect(r.risky).toBe(true)
    })

    it('valor aprovado nao viola mas fica risky', () => {
      const r = checkDraft('O plano sai R$ 350 por mês', [fato('Mensalidade a partir de R$ 350')])
      expect(r.violations).toEqual([])
      expect(r.risky).toBe(true)
    })

    it('formatos R$350,00 e "350 reais"', () => {
      expect(checkDraft('Custa R$350,00', []).violations).toContain('valor_nao_aprovado')
      expect(checkDraft('Custa 350 reais', []).violations).toContain('valor_nao_aprovado')
      expect(checkDraft('Custa R$350,00', [fato('valor 350')]).violations).toEqual([])
    })

    it('separador de milhar R$ 1.250,00 aprovado por fato com 1250', () => {
      expect(checkDraft('Sai R$ 1.250,00', [fato('Plano empresarial: R$ 1250 por vida')]).violations).toEqual([])
      expect(checkDraft('Sai R$ 1.250,00', [fato('valor 350')]).violations).toContain('valor_nao_aprovado')
    })

    it('valor diferente do aprovado viola', () => {
      expect(checkDraft('Sai R$ 400', [fato('R$ 350')]).violations).toContain('valor_nao_aprovado')
    })

    it('lista de fatos vazia', () => {
      expect(checkDraft('R$ 100', []).violations).toEqual(['valor_nao_aprovado'])
    })
  })

  describe('percentual', () => {
    it('sem fato', () => {
      expect(checkDraft('20% de desconto', []).violations).toContain('percentual_nao_aprovado')
      expect(checkDraft('20 por cento de desconto', []).violations).toContain('percentual_nao_aprovado')
    })
    it('com fato', () => {
      const r = checkDraft('20% de desconto', [fato('Desconto de 20% no primeiro ano')])
      expect(r.violations).toEqual([])
      expect(r.risky).toBe(true)
    })
  })

  describe('prazo', () => {
    it('sem fato', () => {
      expect(checkDraft('carência de 30 dias', []).violations).toContain('prazo_nao_aprovado')
      expect(checkDraft('em 24 horas', []).violations).toContain('prazo_nao_aprovado')
      expect(checkDraft('em 2 meses', []).violations).toContain('prazo_nao_aprovado')
    })
    it('com fato (mesma quantidade e unidade)', () => {
      expect(checkDraft('carência de 30 dias', [fato('Carência: 30 dias')]).violations).toEqual([])
      expect(checkDraft('em 2 meses', [fato('prazo de 2 meses')]).risky).toBe(true)
    })
    it('unidade diferente viola', () => {
      expect(checkDraft('em 30 meses', [fato('30 dias')]).violations).toContain('prazo_nao_aprovado')
    })
  })

  describe('cobertura', () => {
    it('sem fato', () => {
      const r = checkDraft('Cobre tudo, sem carência', [])
      expect(r.violations).toContain('cobertura_nao_aprovada')
      expect(r.risky).toBe(true)
    })
    it('aprovada por fato, insensivel a acento', () => {
      const r = checkDraft('Temos sem carencia', [fato('Plano X: sem Carência para consultas')])
      expect(r.violations).toEqual([])
      expect(r.risky).toBe(true)
    })
    it('outras frases', () => {
      expect(checkDraft('Tem cobertura total', []).violations).toContain('cobertura_nao_aprovada')
      expect(checkDraft('Reembolso integral', []).violations).toContain('cobertura_nao_aprovada')
      expect(checkDraft('Aceita todas as doenças', []).violations).toContain('cobertura_nao_aprovada')
    })
  })

  describe('urgencia', () => {
    it('detecta urgencia falsa', () => {
      expect(checkDraft('Só hoje, última chance', []).violations).toContain('urgencia_falsa')
      expect(checkDraft('Não perca!', []).violations).toContain('urgencia_falsa')
      expect(checkDraft('Últimas vagas', []).violations).toContain('urgencia_falsa')
    })
  })

  describe('pergunta de saude', () => {
    it('pergunta sobre doenca', () => {
      expect(checkDraft('Você tem alguma doença?', []).violations).toContain('pergunta_saude')
    })
    it('outros termos', () => {
      expect(checkDraft('Toma algum remédio?', []).violations).toContain('pergunta_saude')
      expect(checkDraft('Você está grávida?', []).violations).toContain('pergunta_saude')
      expect(checkDraft('Já fez cirurgia?', []).violations).toContain('pergunta_saude')
      expect(checkDraft('Tem doença pré-existente?', []).violations).toContain('pergunta_saude')
    })
    it('afirmacao sem pergunta nao marca (tradeoff documentado)', () => {
      expect(checkDraft('Não precisamos saber de doença nenhuma.', []).violations).toEqual([])
    })
  })

  it('varias perguntas', () => {
    expect(checkDraft('Qual seu nome? E sua idade?', []).violations).toContain('varias_perguntas')
  })

  it('tamanho', () => {
    expect(checkDraft('a'.repeat(601), []).violations).toContain('tamanho')
    expect(checkDraft('a'.repeat(600), []).violations).not.toContain('tamanho')
    expect(checkDraft('a'.repeat(50), [], { maxChars: 40 }).violations).toContain('tamanho')
  })
})

describe('checkDraft - correcoes round 1', () => {
  it.each(['12x de 29,90', '29,90 mensais', '350/mês', 'mensalidade de 350', '$350', '1 real', 'mil reais'])(
    'preco sem R$ "%s" sem fato viola e fica risky',
    (txt) => {
      const r = checkDraft(`O plano sai ${txt}`, [])
      expect(r.violations).toContain('valor_nao_aprovado')
      expect(r.risky).toBe(true)
    },
  )

  it('preco aprovado por fato com formato de dinheiro', () => {
    expect(checkDraft('Sai 350/mês', [fato('Mensalidade R$ 350 por mês')]).violations).toEqual([])
    expect(checkDraft('Sai mil reais', [fato('Taxa de 1000 reais')]).violations).toEqual([])
  })

  it('numero de fato que nao e dinheiro nao aprova valor', () => {
    expect(checkDraft('R$ 30', [fato('carência de 30 dias')]).violations).toContain('valor_nao_aprovado')
    expect(checkDraft('R$ 20', [fato('20% de desconto')]).violations).toContain('valor_nao_aprovado')
  })

  it.each(['em 24h', 'em 48h', 'em 30d', 'em dois meses', 'em um mês'])('prazo curto "%s"', (txt) => {
    expect(checkDraft(`Fica pronto ${txt}`, []).violations).toContain('prazo_nao_aprovado')
  })

  it('prazo por extenso aprovado por fato', () => {
    expect(checkDraft('em dois meses', [fato('prazo de 2 meses')]).violations).toEqual([])
  })

  it.each(['Você usa alguma medicação?', 'Está doente?', 'Maria, você tem alguma doença', 'Tem diabetes?'])(
    'pergunta de saude indireta "%s"',
    (txt) => {
      expect(checkDraft(txt, []).violations).toContain('pergunta_saude')
    },
  )

  it('nao gera falso positivo em perguntas comuns', () => {
    expect(checkDraft('Oi, tudo bem?', [])).toEqual({ violations: [], risky: false })
    expect(checkDraft('Qual o melhor horário para conversarmos?', []).violations).toEqual([])
    expect(checkDraft('Você já tem plano de saúde?', []).violations).toEqual([])
  })
})
