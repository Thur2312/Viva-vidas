import { SalesBrain } from './brain'
import { FakeLlm } from './llm'
import { decideAction } from './policy'
import { normalizePlaybook } from './playbook.normalize'
import { validatePlaybook } from './playbook.validate'
import { renderPlaybookText } from './playbook.service'

const TEXTO = `## Oferta
A Viva Vida Seguros é corretora de planos de saúde empresariais (PME), de 1 a 250 vidas. Compara operadoras e ajuda a escolher.
## Fatos aprovados
- Atendemos empresas com CNPJ ativo, inclusive MEI.
- A reunião com o consultor dura 20 minutos.
## Nunca
- Nunca prometer desconto.`

describe('playbook em modo livre', () => {
  const pb = normalizePlaybook({ livre: TEXTO })

  it('normaliza, valida como completo e renderiza o próprio texto', () => {
    expect(pb.livre).toBe(TEXTO.trim())
    expect(validatePlaybook(pb)).toEqual({ complete: true, missing: [] })
    expect(renderPlaybookText(pb)).toBe(TEXTO.trim())
  })

  it('texto curto demais não é completo', () => {
    expect(validatePlaybook(normalizePlaybook({ livre: 'curto' })).complete).toBe(false)
  })

  it('a política conversa, mas ainda repassa pedido de humano e saúde', () => {
    const base = { playbook: pb, profile: {}, failedUnderstandingStreak: 0 }
    const sig = { pediuHumano: false, falouSaude: false, naoEntendeu: false, objecaoId: null, perguntaFatoId: null }
    expect(decideAction({ ...base, signals: sig })).toEqual({ tipo: 'conversar' })
    expect(decideAction({ ...base, signals: { ...sig, pediuHumano: true } })).toMatchObject({ tipo: 'repassar_humano', motivo: 'pediu_humano' })
    expect(decideAction({ ...base, signals: { ...sig, falouSaude: true } })).toMatchObject({ tipo: 'repassar_humano', motivo: 'saude' })
  })

  it('pergunta sem fato NÃO repassa: o agente responde com base no texto', async () => {
    const llm = new FakeLlm([
      { campos: {}, objecao_id: null, pergunta_fato_id: null, pergunta_sem_fato: true, pediu_humano: false, nao_entendeu: false },
      { texto: 'Atendemos empresas com CNPJ ativo, inclusive MEI. Quantas vidas vocês teriam?' },
    ])
    const out = await new SalesBrain(llm).decide({
      playbook: pb, playbookVersion: 2, profile: {}, summary: null, examples: [], failedUnderstandingStreak: 0, triggerMessageId: 1,
      history: [{ author: 'lead', body: 'Vocês atendem MEI?', sensitive: false, id: 1 }],
    })
    expect(out.action.tipo).toBe('conversar')
    expect(out.handoffReason).toBeNull()
    expect(out.draft).toContain('MEI')
  })

  it('o guarda-corpo continua barrando valor que não está no texto do dono', async () => {
    const ruim = { texto: 'O plano sai por R$ 350 por mês.' }
    const llm = new FakeLlm([
      { campos: {}, objecao_id: null, pergunta_fato_id: null, pergunta_sem_fato: false, pediu_humano: false, nao_entendeu: false },
      ruim,
      ruim,
    ])
    const out = await new SalesBrain(llm).decide({
      playbook: pb, playbookVersion: 2, profile: {}, summary: null, examples: [], failedUnderstandingStreak: 0, triggerMessageId: 1,
      history: [{ author: 'lead', body: 'Quanto custa?', sensitive: false, id: 1 }],
    })
    expect(out.guardEvents).toContain('valor_nao_aprovado')
    expect(out.action).toMatchObject({ tipo: 'repassar_humano', motivo: 'guardacorpo' })
  })
})
