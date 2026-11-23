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

  it('comparação com a resposta humana e "rascunho pendente" excluem action aguardar', async () => {
    const sqls: string[] = []
    const pg = { query: async (sql: string) => { sqls.push(sql); return { rows: [] } } }
    const svc = new PilotService(pg as any, crypto, undefined, { log: jest.fn() } as any)
    await (svc as any).compareWithDraft(CONV, 5, 'oi', pg)
    expect(sqls[0]).toMatch(/action IS DISTINCT FROM 'aguardar'/)

    const conv = new ConversationsService(pg as any, crypto, {} as any, {} as any, {} as any, {} as any)
    sqls.length = 0
    await conv.list({}).catch(() => undefined)
    expect(sqls.some((s) => /AS pending/.test(s) && /d\.action IS DISTINCT FROM 'aguardar'/.test(s))).toBe(true)
  })
})
