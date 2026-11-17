import { ShadowService, DraftContext } from '../shadow.service'

// Garante que nenhum identificador direto chega ao provedor de LLM e que o rascunho é gravado cifrado.
describe('ShadowService: pseudonimização antes do provedor', () => {
  it('troca nome/telefone/CPF por marcadores e restaura o nome só localmente', async () => {
    delete process.env.ANTHROPIC_API_KEY
    delete process.env.GEMINI_API_KEY
    const captured: { ctx?: DraftContext } = {}
    const inserts: any[][] = []
    const pg = {
      query: async (sql: string, params: any[] = []) => {
        if (/FROM horizon_agent.messages m\s+WHERE m.conversation_id = \$1 AND m.author = 'lead'/.test(sql))
          return { rows: [{ id: 7, body: 'Sou Maria Oliveira, CPF 529.982.247-25' }], rowCount: 1 }
        if (/agent_drafts WHERE trigger_message_id/.test(sql)) return { rows: [], rowCount: 0 }
        if (/FROM horizon_agent.conversations c/.test(sql))
          return {
            rows: [{ name: 'Maria Oliveira', phone: '5583999991234', stage: 'respondeu', qualification: { contato: 'maria@x.com.br' }, summary: 'Maria Oliveira pediu cotação, fone 83 99999-1234', opt_out: false, anonymized_at: null }],
            rowCount: 1,
          }
        if (/SELECT author, body FROM horizon_agent.messages/.test(sql))
          return { rows: [{ author: 'lead', body: 'Oi, aqui é a Maria Oliveira, (83) 99999-1234' }, { author: 'humano', body: 'Olá Maria!' }, { author: 'lead', body: 'Sou Maria Oliveira, CPF 529.982.247-25' }], rowCount: 3 }
        if (/playbook_versions/.test(sql)) return { rows: [], rowCount: 0 }
        if (/learned_examples/.test(sql)) return { rows: [{ situation: 's', lead_message: 'Maria Oliveira quer plano', human_reply: 'Oi Maria Oliveira' }], rowCount: 1 }
        if (/INSERT INTO horizon_agent.agent_drafts/.test(sql)) { inserts.push(params); return { rows: [{ id: 1 }], rowCount: 1 } }
        return { rows: [], rowCount: 0 }
      },
    }
    const svc = new ShadowService(pg as any, {} as any)
    ;(svc as any).provider = {
      enabled: true,
      generate: async (ctx: DraftContext) => {
        captured.ctx = ctx
        return { draft: 'Oi [LEAD], tudo bem?', model: 'm' }
      },
    }

    const r = await svc.run('00000000-0000-4000-8000-000000000000')
    expect(r).toEqual({ status: 'drafted', draftId: 1 })

    const sent = JSON.stringify(captured.ctx)
    expect(sent).not.toMatch(/Maria|Oliveira|99999|529\.982|maria@x/)
    expect(sent).toContain('[LEAD]')
    expect(sent).toContain('[TELEFONE]')
    expect(sent).toContain('[CPF]')
    expect(captured.ctx!.lead.name).toBe('[LEAD]')
    // o rascunho é gravado com o primeiro nome restaurado (comparável com a fala humana)
    expect(inserts[0][2]).toBe('Oi Maria, tudo bem?')
  })

  it('lead com opt-out não tem a conversa enviada ao provedor', async () => {
    let called = false
    const pg = {
      query: async (sql: string) => {
        if (/m.author = 'lead'/.test(sql)) return { rows: [{ id: 1, body: 'oi' }], rowCount: 1 }
        if (/FROM horizon_agent.conversations c/.test(sql)) return { rows: [{ name: 'X', phone: '5583999991234', stage: 'contatado', qualification: {}, opt_out: true, anonymized_at: null }], rowCount: 1 }
        return { rows: [], rowCount: 0 }
      },
    }
    const svc = new ShadowService(pg as any, {} as any)
    ;(svc as any).provider = { enabled: true, generate: async () => { called = true; return { draft: 'x', model: 'm' } } }
    expect(await svc.run('00000000-0000-4000-8000-000000000000')).toEqual({ status: 'opt_out' })
    expect(called).toBe(false)
  })
  it('conversa com mensagem sensível (saúde) não é enviada ao provedor: fica para o humano', async () => {
    let called = false
    const pg = {
      query: async (sql: string) => {
        if (/m.author = 'lead'/.test(sql)) return { rows: [{ id: 1, body: 'tenho diabetes' }], rowCount: 1 }
        if (/FROM horizon_agent.conversations c/.test(sql)) return { rows: [{ name: 'X', phone: '5583999991234', stage: 'contatado', qualification: {}, opt_out: false, anonymized_at: null }], rowCount: 1 }
        if (/contains_sensitive LIMIT 1/.test(sql)) return { rows: [{ '?column?': 1 }], rowCount: 1 }
        return { rows: [], rowCount: 0 }
      },
    }
    const svc = new ShadowService(pg as any, {} as any)
    ;(svc as any).provider = { enabled: true, generate: async () => { called = true; return { draft: 'x', model: 'm' } } }
    expect(await svc.run('00000000-0000-4000-8000-000000000000')).toEqual({ status: 'sensitive_human_only' })
    expect(called).toBe(false)
  })
})
