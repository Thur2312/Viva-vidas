import { ShadowService } from '../shadow.service'
import { FakeLlm } from '../brain/llm'
import { testPlaybook } from '../brain/fixtures/test-playbook'

const extraction = { campos: {}, objecao_id: null, pergunta_fato_id: null, pergunta_sem_fato: false, pediu_humano: false, nao_entendeu: false }

// Garante que nenhum identificador direto chega ao provedor de LLM e que o rascunho é gravado cifrado.
describe('ShadowService: pseudonimização antes do provedor', () => {
  it('troca nome/telefone/CPF por marcadores e restaura o nome só localmente', async () => {
    const inserts: any[][] = []
    const pg = {
      query: async (sql: string, params: any[] = []) => {
        if (/FROM horizon_agent.messages m\s+WHERE m.conversation_id = \$1 AND m.author = 'lead'/.test(sql))
          return { rows: [{ id: '7', body: 'Sou Maria Oliveira, CPF 529.982.247-25', contains_sensitive: false }], rowCount: 1 }
        if (/FROM horizon_agent.conversations c/.test(sql))
          return {
            rows: [{
              id: 'lead-1', name: 'Maria Oliveira', phone: '5583999991234', stage: 'respondeu',
              qualification: { contato: 'maria@x.com.br', perfil: { cidade: { valor: 'Maria Oliveira', confianca: 0.9, msgId: '1' } } },
              summary: 'Maria Oliveira pediu cotação, fone 83 99999-1234', opt_out: false, anonymized_at: null,
            }],
            rowCount: 1,
          }
        if (/SELECT m.id, m.author FROM horizon_agent.messages m/.test(sql)) return { rows: [{ id: '7', author: 'lead' }], rowCount: 1 }
        if (/agent_drafts WHERE trigger_message_id/.test(sql)) return { rows: [], rowCount: 0 }
        if (/FROM horizon_agent.messages WHERE conversation_id = \$1 ORDER BY created_at, id/.test(sql))
          return {
            rows: [
              { id: '5', author: 'lead', contains_sensitive: false, body: 'Oi, aqui é a Maria Oliveira, (83) 99999-1234' },
              { id: '6', author: 'humano', contains_sensitive: false, body: 'Olá Maria!' },
              { id: '7', author: 'lead', contains_sensitive: false, body: 'Sou Maria Oliveira, CPF 529.982.247-25' },
            ],
            rowCount: 3,
          }
        if (/playbook_versions/.test(sql)) return { rows: [{ version: 1, data: structuredClone(testPlaybook) }], rowCount: 1 }
        if (/learned_examples/.test(sql)) return { rows: [{ situation: 's', lead_message: 'Maria Oliveira quer plano', human_reply: 'Oi Maria Oliveira' }], rowCount: 1 }
        if (/INSERT INTO horizon_agent.agent_drafts/.test(sql)) { inserts.push(params); return { rows: [{ id: 1 }], rowCount: 1 } }
        return { rows: [], rowCount: 0 }
      },
    }
    const llm = new FakeLlm([extraction, { texto: 'Oi [LEAD], vocês já têm plano hoje?' }])
    const svc = new ShadowService(pg as any, {} as any, undefined, llm)

    const r = await svc.run('00000000-0000-4000-8000-000000000000')
    expect(r).toEqual({ status: 'drafted', draftId: 1 })

    expect(llm.calls).toHaveLength(2)
    const sent = JSON.stringify(llm.calls)
    expect(sent).not.toMatch(/Maria|Oliveira|99999|529\.982|maria@x/)
    expect(sent).toContain('[LEAD]')
    expect(sent).toContain('[TELEFONE]')
    expect(sent).toContain('[CPF]')
    // o rascunho é gravado com o primeiro nome restaurado (comparável com a fala humana)
    expect(inserts[0][2]).toBe('Oi Maria, vocês já têm plano hoje?')
  })

  it('lead com opt-out não tem a conversa enviada ao provedor', async () => {
    const pg = {
      query: async (sql: string) => {
        if (/m.author = 'lead'/.test(sql)) return { rows: [{ id: '1', body: 'oi', contains_sensitive: false }], rowCount: 1 }
        if (/FROM horizon_agent.conversations c/.test(sql)) return { rows: [{ id: 'l', name: 'X', phone: '5583999991234', stage: 'contatado', qualification: {}, opt_out: true, anonymized_at: null }], rowCount: 1 }
        return { rows: [], rowCount: 0 }
      },
    }
    const llm = new FakeLlm([extraction, { texto: 'x' }])
    const svc = new ShadowService(pg as any, {} as any, undefined, llm)
    expect(await svc.run('00000000-0000-4000-8000-000000000000')).toEqual({ status: 'opt_out' })
    expect(llm.calls).toHaveLength(0)
  })
})
