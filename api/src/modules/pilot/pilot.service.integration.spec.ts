import { Client } from 'pg'
import { PilotService, normalizePhone } from './pilot.service'

// Roda contra um Postgres real com o schema horizon_agent, SEMPRE dentro de uma transação
// que sofre ROLLBACK. Sem PILOT_TEST_DATABASE_URL, a suíte inteira é ignorada.
const url = process.env.PILOT_TEST_DATABASE_URL
const d = url ? describe : describe.skip

d('PilotService (banco real, com rollback)', () => {
  let client: Client
  let svc: PilotService

  beforeAll(async () => {
    client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
    await client.connect()
  })
  afterAll(async () => { await client.end() })
  beforeEach(async () => {
    await client.query('BEGIN')
    svc = new PilotService(client as any)
    ;(svc as any).tenant = 'teste_rollback'
  })
  afterEach(async () => { await client.query('ROLLBACK') })

  const db = () => client as any

  it('normaliza telefone brasileiro', () => {
    expect(normalizePhone('(83) 99999-1234')).toBe('5583999991234')
    expect(() => normalizePhone('123')).toThrow()
  })

  it('upsert é idempotente e gera o evento "contatado" uma vez', async () => {
    const a = await svc.upsertLead({ phone: '83999991234', name: 'Lead Teste' }, db())
    const b = await svc.upsertLead({ phone: '+55 83 99999-1234' }, db())
    expect(b.id).toBe(a.id)
    const ev = await client.query(`SELECT count(*)::int n FROM horizon_agent.lead_events WHERE lead_id = $1 AND type = 'contatado'`, [a.id])
    expect(ev.rows[0].n).toBe(1)
  })

  it('a etapa só avança e perdido não sobrescreve venda', async () => {
    const l = await svc.upsertLead({ phone: '83988887777' }, db())
    await svc.addEvent(l.id, 'qualificado', {}, db())
    await svc.addEvent(l.id, 'respondeu', {}, db())
    expect((await client.query('SELECT stage FROM horizon_agent.leads WHERE id=$1', [l.id])).rows[0].stage).toBe('qualificado')
    await svc.addEvent(l.id, 'venda', { value: 2500 }, db())
    await svc.addEvent(l.id, 'perdido', {}, db())
    expect((await client.query('SELECT stage FROM horizon_agent.leads WHERE id=$1', [l.id])).rows[0].stage).toBe('venda')
  })

  it('opt_out marca o lead e não muda a etapa', async () => {
    const l = await svc.upsertLead({ phone: '83977776666' }, db())
    await svc.addEvent(l.id, 'opt_out', {}, db())
    const r = (await client.query('SELECT stage, opt_out FROM horizon_agent.leads WHERE id=$1', [l.id])).rows[0]
    expect(r).toEqual({ stage: 'contatado', opt_out: true })
  })

  it('mensagem do lead cria conversa, registra "respondeu" e deduplica por wid', async () => {
    const m = { phone: '83966665555', direction: 'in' as const, author: 'lead' as const, body: 'Quero reduzir meu plano', wid: 'wamid.1' }
    const first = await svc.ingestMessage(m, db())
    const again = await svc.ingestMessage(m, db())
    expect(first.duplicated).toBe(false)
    expect(again.duplicated).toBe(true)
    const stage = (await client.query('SELECT stage FROM horizon_agent.leads WHERE id=$1', [first.leadId])).rows[0].stage
    expect(stage).toBe('respondeu')
  })

  it('uma conversa por (lead, canal): mensagens seguidas reutilizam a conversa e o banco recusa duplicata (migration 010)', async () => {
    const base = { phone: '83955554444', direction: 'in' as const, author: 'lead' as const }
    const a = await svc.ingestMessage({ ...base, body: 'oi', wid: 'wamid.c1' }, db())
    const b = await svc.ingestMessage({ ...base, body: 'tudo bem?', wid: 'wamid.c2' }, db())
    expect((b as any).conversationId).toBe((a as any).conversationId)
    const n = await client.query('SELECT count(*)::int n FROM horizon_agent.conversations WHERE lead_id = $1', [a.leadId])
    expect(n.rows[0].n).toBe(1)

    await client.query('SAVEPOINT s')
    await expect(
      client.query(`INSERT INTO horizon_agent.conversations (lead_id, channel) VALUES ($1, 'whatsapp')`, [a.leadId]),
    ).rejects.toThrow(/conversations_lead_channel_uidx|duplicate key/)
    await client.query('ROLLBACK TO s')
    // outro canal continua permitido: a restricao e por (lead, canal), nao so por lead
    await client.query(`INSERT INTO horizon_agent.conversations (lead_id, channel) VALUES ($1, 'email')`, [a.leadId])
  })

  it('reenviar a mesma mensagem nao mexe em updated_at da conversa (nao reordena a lista)', async () => {
    const m = { phone: '83944443333', direction: 'in' as const, author: 'lead' as const, body: 'ola', wid: 'wamid.u1' }
    const first = await svc.ingestMessage(m, db())
    await client.query(`UPDATE horizon_agent.conversations SET updated_at = now() - interval '1 hour' WHERE id = $1`, [(first as any).conversationId])
    const before = (await client.query('SELECT updated_at FROM horizon_agent.conversations WHERE id = $1', [(first as any).conversationId])).rows[0].updated_at
    await svc.ingestMessage(m, db()) // repeticao: duplicada
    const after = (await client.query('SELECT updated_at FROM horizon_agent.conversations WHERE id = $1', [(first as any).conversationId])).rows[0].updated_at
    expect(after.getTime()).toBe(before.getTime())
  })

  it('resposta humana é comparada com o rascunho pendente', async () => {
    const inbound = await svc.ingestMessage({ phone: '83955554444', direction: 'in', author: 'lead', body: 'Pago 1900 no plano', wid: 'w1' }, db())
    await client.query(
      `INSERT INTO horizon_agent.agent_drafts (conversation_id, trigger_message_id, draft_body, model) VALUES ($1,$2,$3,'teste')`,
      [inbound.conversationId, inbound.messageId, 'Entendi. Quantas vidas tem no plano?'],
    )
    const out = await svc.ingestMessage(
      { phone: '83955554444', direction: 'out', author: 'humano', body: 'Entendi! Quantas vidas tem no plano?', wid: 'w2' },
      db(),
    )
    expect(out.comparison?.humanAction).toBe('igual')
    expect(out.comparison?.similarity).toBeGreaterThanOrEqual(0.8)
  })

  it('overview conta o funil por lead distinto e a listagem pagina', async () => {
    const a = await svc.upsertLead({ phone: '83944443333', name: 'A', source: { campaign_id: 'c1', campaign_name: 'Camp 1' } }, db())
    const b = await svc.upsertLead({ phone: '83933332222', name: 'B', source: { campaign_id: 'c1', campaign_name: 'Camp 1' } }, db())
    await svc.addEvent(a.id, 'qualificado', {}, db())
    await svc.addEvent(b.id, 'respondeu', {}, db())
    // o service usa this.pg; aqui é o mesmo client transacional
    const o = await svc.overview()
    expect(o.funnel.contatado).toBe(2)
    expect(o.funnel.qualificado).toBe(1)
    const list = await svc.listLeads({ campaignId: 'c1', pageSize: 1 })
    expect(list.meta.totalItems).toBe(2)
    expect(list.data).toHaveLength(1)
    const camps = await svc.campaigns()
    expect(camps.find((c: any) => c.campaign_id === 'c1')?.leads).toBe(2)
  })

  it('getLead lança 404 para id inexistente', async () => {
    await expect(svc.getLead('00000000-0000-0000-0000-000000000000')).rejects.toThrow('Lead não encontrado')
  })
})
