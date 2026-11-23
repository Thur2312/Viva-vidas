import { ConversationsService } from './conversations/conversations.service'
import { PilotService } from './pilot.service'
import { CryptoService } from './compliance/crypto.service'

// Rascunho vazio (ação 'aguardar') é gravado só para dedupe/telemetria: nenhum leitor o mostra como sugestão.
describe('leitores de agent_drafts ignoram rascunho vazio', () => {
  const crypto = new CryptoService()
  const CONV = '00000000-0000-4000-8000-000000000000'

  it('thread da conversa não anexa rascunho vazio', async () => {
    const pg = {
      query: async (sql: string) => {
        if (/SELECT c\.id, c\.lead_id FROM horizon_agent\.conversations/.test(sql)) return { rows: [{ id: CONV, lead_id: 'l' }] }
        if (/FROM horizon_agent\.messages m\s+WHERE m\.conversation_id = \$1/.test(sql))
          return { rows: [{ id: '2', direction: 'in', author: 'lead', body: 'b', created_at: 't2' }, { id: '1', direction: 'in', author: 'lead', body: 'a', created_at: 't1' }] }
        if (/FROM horizon_agent\.agent_drafts d/.test(sql))
          return { rows: [{ id: '10', trigger_message_id: '1', draft_body: 'Oi!' }, { id: '11', trigger_message_id: '2', draft_body: '' }] }
        return { rows: [] }
      },
    }
    const audit = { log: jest.fn() }
    const svc = new ConversationsService(pg as any, crypto, audit as any, {} as any, {} as any, {} as any)
    const { data } = await svc.messages(CONV)
    expect((data[0] as any).draft?.draft_body).toBe('Oi!')
    expect((data[1] as any).draft).toBeUndefined()
  })

  it('detalhe do lead não lista rascunho vazio', async () => {
    const pg = {
      query: async (sql: string) => {
        if (/SELECT \* FROM horizon_agent\.leads/.test(sql)) return { rows: [{ id: 'l', phone: '5583999991234' }] }
        if (/FROM horizon_agent\.agent_drafts d/.test(sql)) return { rows: [{ id: '10', draft_body: 'Oi!' }, { id: '11', draft_body: '' }] }
        return { rows: [] }
      },
    }
    const svc = new PilotService(pg as any, crypto, undefined, { log: jest.fn() } as any)
    const r = await svc.getLead('l')
    expect(r.drafts.map((d: any) => d.draft_body)).toEqual(['Oi!'])
  })

  it('"rascunho pendente" da lista de conversas exclui action aguardar', async () => {
    const sqls: string[] = []
    const pg = { query: async (sql: string) => { sqls.push(sql); return { rows: [] } } }
    const conv = new ConversationsService(pg as any, crypto, {} as any, {} as any, {} as any, {} as any)
    await conv.list({}).catch(() => undefined)
    expect(sqls.some((s) => /AS pending/.test(s) && /d\.action IS DISTINCT FROM 'aguardar'/.test(s))).toBe(true)
  })
})

// A ingestão é caminho crítico e roda antes ou depois da migration 011 (aplicada à mão): não pode citar colunas dela.
describe('ingestão de mensagem humana: comparação com rascunho sem colunas da migration 011', () => {
  const crypto = new CryptoService()
  const CONV = '00000000-0000-4000-8000-000000000000'
  const COLS_011 = /\b(action|not_understood|objection_id|asked_field|handoff_reason|guard_violations|prompt_hash|input_tokens|output_tokens|calls)\b/

  function ingest(drafts: { id: string; draft_body: string }[]) {
    const queries: { sql: string; params: any[] }[] = []
    const pg = {
      query: async (sql: string, params: any[] = []) => {
        queries.push({ sql, params })
        if (/INSERT INTO horizon_agent\.leads/.test(sql)) return { rows: [{ id: 'lead-1', created: false, opt_out: false }], rowCount: 1 }
        if (/INSERT INTO horizon_agent\.conversations/.test(sql)) return { rows: [{ id: CONV }], rowCount: 1 }
        if (/INSERT INTO horizon_agent\.messages/.test(sql)) return { rows: [{ id: '99' }], rowCount: 1 }
        if (/SELECT id, draft_body FROM horizon_agent\.agent_drafts/.test(sql)) return { rows: drafts, rowCount: drafts.length }
        return { rows: [], rowCount: 0 }
      },
    }
    const learning = { capture: jest.fn() }
    const svc = new PilotService(pg as any, crypto, undefined, { log: jest.fn() } as any, learning as any)
    const run = () => svc.ingestMessage({ phone: '5583999991234', direction: 'out', author: 'humano', body: 'Oi! Vocês já têm plano?' } as any)
    const updates = () => queries.filter((q) => /UPDATE horizon_agent\.agent_drafts/.test(q.sql))
    return { run, queries, updates }
  }

  it('nenhum SQL da ingestão cita action, not_understood ou outra coluna da 011', async () => {
    const t = ingest([{ id: '10', draft_body: 'Oi! Vocês já têm plano?' }])
    await t.run()
    expect(t.queries.filter((q) => /agent_drafts/.test(q.sql)).length).toBeGreaterThan(0)
    for (const q of t.queries) expect(q.sql).not.toMatch(COLS_011)
  })

  it('rascunho mais novo vazio e um mais antigo com texto: compara com o mais antigo', async () => {
    const t = ingest([{ id: '12', draft_body: '' }, { id: '11', draft_body: 'Oi! Vocês já têm plano?' }])
    const r = await t.run()
    expect((r as any).comparison?.draftId).toBe(11)
    expect(t.updates()).toHaveLength(1)
    expect(t.updates()[0].params[0]).toBe('11')
  })

  it('todos os rascunhos sem comparação vazios: comparison null e nenhum UPDATE', async () => {
    const t = ingest([{ id: '12', draft_body: '' }, { id: '11', draft_body: '   ' }])
    const r = await t.run()
    expect((r as any).comparison).toBeNull()
    expect(t.updates()).toHaveLength(0)
  })
})
