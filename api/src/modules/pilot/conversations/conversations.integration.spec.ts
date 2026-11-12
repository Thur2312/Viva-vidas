import { randomBytes } from 'crypto'
import { INestApplication, ValidationPipe } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import * as request from 'supertest'
import { Client } from 'pg'
import { PilotModule } from '../pilot.module'
import { PgService } from '../pg.service'
import { PilotService } from '../pilot.service'
import { CryptoService } from '../compliance/crypto.service'
import { ChatGatewayService } from '../../chat-gateway/chat-gateway.service'
import { ConversationsService } from './conversations.service'

// Banco real, SEMPRE dentro de uma transação que sofre ROLLBACK, tenant exclusivo de teste.
// A API HTTP sobe sobre o mesmo client transacional; o chat (gateway) é um dublê. Sem PILOT_TEST_DATABASE_URL a suíte é ignorada.
const url = process.env.PILOT_TEST_DATABASE_URL
const d = url ? describe : describe.skip
jest.setTimeout(120_000)

d('Conversas (banco real, com rollback, HTTP com gateway falso)', () => {
  let client: Client
  let app: INestApplication
  let svc: ConversationsService
  let pilot: PilotService
  let crypto: CryptoService
  const saved = { ...process.env }
  const sentToChat: any[] = []
  let gatewayMode: 'ok' | 'down' = 'ok'
  let widSeq = 0
  const fakeGateway = {
    sendText: async (i: any) => {
      if (gatewayMode === 'down') {
        const { ServiceUnavailableException } = require('@nestjs/common')
        throw new ServiceUnavailableException('Chat não configurado (CHAT_API_URL / CHAT_BRIDGE_KEY)')
      }
      sentToChat.push(i)
      return { wid: `wamid.test.${++widSeq}` }
    },
    configured: () => true,
  }

  beforeAll(async () => {
    process.env.PILOT_DATA_KEY = randomBytes(32).toString('base64')
    process.env.PILOT_PHONE_SALT = 'sal-' + randomBytes(4).toString('hex')
    process.env.PILOT_TENANT = 'teste_rollback'
    client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
    await client.connect()
    const mod = await Test.createTestingModule({ imports: [PilotModule] })
      .overrideProvider(PgService).useValue(client)
      .overrideProvider(ChatGatewayService).useValue(fakeGateway)
      .compile()
    app = mod.createNestApplication()
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))
    await app.init()
    svc = mod.get(ConversationsService)
    pilot = mod.get(PilotService)
    crypto = mod.get(CryptoService)
  })
  afterAll(async () => { await app?.close(); await client.end(); process.env = { ...saved } })
  beforeEach(async () => { await client.query('BEGIN'); sentToChat.length = 0; gatewayMode = 'ok' })
  afterEach(async () => { await client.query('ROLLBACK') })

  const http = () => request(app.getHttpServer())
  const ingest = (phone: string, direction: 'in' | 'out', author: 'lead' | 'humano' | 'agente', body: string, wid: string, name?: string) =>
    pilot.ingestMessage({ phone, direction, author, body, wid, name }, client as any)
  const setTime = (messageId: number, iso: string) => client.query(`UPDATE horizon_agent.messages SET created_at = $2::timestamptz WHERE id = $1`, [messageId, iso])

  it('lista: telefone mascarado, prévia curta, busca por nome/telefone (nunca por corpo)', async () => {
    const long = 'Olá '.repeat(60)
    await ingest('83999991234', 'in', 'lead', long, 'a1', 'Maria Teste')
    const b = await ingest('83988887777', 'in', 'lead', 'segredo-no-corpo', 'b1', 'João Teste')
    await ingest('83988887777', 'out', 'humano', 'Já te respondo', 'b2')
    const all = await svc.list({})
    expect(all.meta.totalItems).toBe(2)
    const maria = all.data.find((r: any) => r.lead_name === 'Maria Teste')!
    expect(maria.phone).toBe('+55 83 9****-1234')
    expect(maria.last_message_preview!.length).toBeLessThanOrEqual(120)
    expect(maria.unread_for_human).toBe(true)
    expect(all.data.find((r: any) => r.lead_name === 'João Teste')!.unread_for_human).toBe(false)
    expect((await svc.list({ search: 'maria' })).data).toHaveLength(1)
    expect((await svc.list({ search: '99999-1234' })).data).toHaveLength(1)
    expect((await svc.list({ search: 'segredo' })).data).toHaveLength(0) // corpo não é pesquisável
    expect((await svc.list({ search: '%' })).data).toHaveLength(0) // curinga escapado
    expect((await svc.list({ leadId: b.leadId })).data).toHaveLength(1)
    expect((await svc.list({ status: 'aguardando' })).data).toHaveLength(1)
    expect((await svc.list({ status: 'respondida' })).data).toHaveLength(1)
    expect((await svc.list({ pageSize: 1 })).meta.totalPages).toBe(2)
  })

  it('mensagens: descriptografa, anexa rascunho à mensagem gatilho, pagina e audita sem dado pessoal', async () => {
    const m1 = await ingest('83955554444', 'in', 'lead', 'Pago 1900 no plano', 'w1', 'Ana Teste')
    const convId = m1.conversationId!
    await client.query(
      `INSERT INTO horizon_agent.agent_drafts (conversation_id, trigger_message_id, draft_body, model, stage_guess, next_action_guess)
       VALUES ($1,$2,$3,'teste','respondeu','perguntar_vidas')`,
      [convId, m1.messageId, crypto.encrypt('Quantas vidas tem no plano?')],
    )
    const out = await ingest('83955554444', 'out', 'humano', 'Quantas vidas tem no plano?', 'w2')
    for (let i = 3; i < 8; i++) await ingest('83955554444', 'in', 'lead', `msg ${i}`, `w${i}`)

    const r = await svc.messages(convId, { limit: 3 }, { actor: 'op-1', ip: '1.1.1.1' })
    expect(r.hasMore).toBe(true)
    expect(r.data).toHaveLength(3)
    expect(r.data.map((m) => m.body)).toEqual(['msg 5', 'msg 6', 'msg 7'])
    const older = await svc.messages(convId, { before: String(r.data[0].id), limit: 10 }, { actor: 'op-1' })
    expect(older.hasMore).toBe(false)
    expect(older.data[0].body).toBe('Pago 1900 no plano')
    expect(older.data[0].draft).toMatchObject({ draft_body: 'Quantas vidas tem no plano?', stage_guess: 'respondeu', human_action: 'igual' })
    expect(older.data[0].draft!.similarity).toBeGreaterThan(0.8)
    expect(older.data[1].id).toBe(out.messageId)

    // O corpo está cifrado no banco; a leitura grava UMA linha de auditoria por janela, sem dado pessoal.
    const raw = (await client.query(`SELECT body FROM horizon_agent.messages WHERE id = $1`, [m1.messageId])).rows[0].body
    expect(raw).not.toContain('Pago 1900')
    const logs = (await client.query(`SELECT actor, details FROM horizon_agent.audit_log WHERE action = 'conversation.read' AND entity_id = $1`, [convId])).rows
    expect(logs).toHaveLength(1)
    expect(JSON.stringify(logs[0])).not.toMatch(/Pago|Ana|83955/)
  })

  it('mensagens: 404 para conversa de outro tenant e 400 para id inválido (HTTP)', async () => {
    await http().get('/pilot/conversations/not-a-uuid/messages').expect(400)
    await http().get('/pilot/conversations/00000000-0000-4000-8000-000000000000/messages').expect(404)
    await http().get('/pilot/conversations?mode=xyz').expect(400)
  })

  it('envio: dentro da janela envia ao chat, grava como humano, compara com o rascunho e audita (HTTP)', async () => {
    const m1 = await ingest('83944443333', 'in', 'lead', 'Quero reduzir o plano', 'i1', 'Bia Teste')
    const convId = m1.conversationId!
    await client.query(
      `INSERT INTO horizon_agent.agent_drafts (conversation_id, trigger_message_id, draft_body, model) VALUES ($1,$2,$3,'teste')`,
      [convId, m1.messageId, crypto.encrypt('Claro! Quantas vidas tem no plano?')],
    )
    const res = await http().post(`/pilot/conversations/${convId}/messages`).send({ body: ' Claro! Quantas vidas tem no plano? ' }).expect(201)
    expect(res.body).toMatchObject({ direction: 'out', author: 'humano', body: 'Claro! Quantas vidas tem no plano?' })
    expect(res.body.draft_comparison.human_action).toBe('igual')
    expect(sentToChat).toHaveLength(1)
    expect(sentToChat[0]).toMatchObject({ phone: '5583944443333', body: 'Claro! Quantas vidas tem no plano?' })

    const row = (await client.query(`SELECT author, direction, wid, body FROM horizon_agent.messages WHERE conversation_id = $1 AND direction = 'out'`, [convId])).rows
    expect(row).toHaveLength(1)
    expect(row[0]).toMatchObject({ author: 'humano', wid: 'wamid.test.' + widSeq })
    expect(row[0].body).not.toContain('Claro')
    // o eco do chat com o mesmo wid não duplica
    const echo = await ingest('83944443333', 'out', 'humano', 'Claro! Quantas vidas tem no plano?', row[0].wid)
    expect(echo.duplicated).toBe(true)
    const log = (await client.query(`SELECT details FROM horizon_agent.audit_log WHERE action = 'conversation.send' AND entity_id = $1`, [convId])).rows
    expect(log).toHaveLength(1)
    expect(JSON.stringify(log[0])).not.toMatch(/Claro|Bia|83944/)
  })

  it('envio: janela de 24h fechada devolve 422 window_closed e não chama o chat', async () => {
    const m1 = await ingest('83933332222', 'in', 'lead', 'Oi', 'j1')
    await setTime(m1.messageId!, new Date(Date.now() - 30 * 3600_000).toISOString())
    const res = await http().post(`/pilot/conversations/${m1.conversationId}/messages`).send({ body: 'Olá' }).expect(422)
    expect(res.body.code).toBe('window_closed')
    expect(res.body.message).toMatch(/template|modelo/i)
    expect(sentToChat).toHaveLength(0)
  })

  it('envio: opt-out, anonimizado e marketing revogado bloqueiam com 422 contact_blocked', async () => {
    const a = await ingest('83922221111', 'in', 'lead', 'Oi', 'k1')
    await pilot.addEvent(a.leadId!, 'opt_out', {}, client as any)
    const r = await http().post(`/pilot/conversations/${a.conversationId}/messages`).send({ body: 'x' }).expect(422)
    expect(r.body).toMatchObject({ code: 'contact_blocked', reason: 'opt_out' })

    const b = await ingest('83911110000', 'in', 'lead', 'Oi', 'k2')
    await client.query(`UPDATE horizon_agent.leads SET anonymized_at = now() WHERE id = $1`, [b.leadId])
    const r2 = await http().post(`/pilot/conversations/${b.conversationId}/messages`).send({ body: 'x' }).expect(422)
    expect(r2.body.code).toBe('contact_blocked')
    expect(sentToChat).toHaveLength(0)
  })

  it('envio: 503 honesto com o chat fora do ar, 400 para corpo vazio/gigante, nada gravado', async () => {
    const m = await ingest('83900001111', 'in', 'lead', 'Oi', 'l1')
    gatewayMode = 'down'
    const r = await http().post(`/pilot/conversations/${m.conversationId}/messages`).send({ body: 'Olá' }).expect(503)
    expect(r.body.message).toMatch(/Chat não configurado/)
    gatewayMode = 'ok'
    await http().post(`/pilot/conversations/${m.conversationId}/messages`).send({ body: '' }).expect(400)
    await http().post(`/pilot/conversations/${m.conversationId}/messages`).send({ body: 'x'.repeat(4097) }).expect(400)
    await http().post(`/pilot/conversations/${m.conversationId}/messages`).send({ body: '   ' }).expect(400)
    expect((await client.query(`SELECT count(*)::int n FROM horizon_agent.messages WHERE conversation_id = $1 AND direction = 'out'`, [m.conversationId])).rows[0].n).toBe(0)
  })

  it('stats: fuso America/Sao_Paulo, métricas de tempo e rascunhos', async () => {
    // 2026-03-10 02:30Z = 09/03 23:30 em São Paulo
    const lead1 = await ingest('83900002222', 'in', 'lead', 'Oi', 's1')
    await setTime(lead1.messageId!, '2026-03-10T02:30:00Z')
    const reply = await ingest('83900002222', 'out', 'humano', 'Olá, tudo bem?', 's2')
    await setTime(reply.messageId!, '2026-03-10T02:32:00Z') // 120 s depois
    const lead2 = await ingest('83900002222', 'in', 'lead', 'Quero saber mais', 's3')
    await setTime(lead2.messageId!, '2026-03-10T14:00:00Z') // 11:00 SP do dia 10
    const reply2 = await ingest('83900002222', 'out', 'humano', 'Claro', 's4')
    await setTime(reply2.messageId!, '2026-03-10T14:10:00Z') // 600 s
    await client.query(`UPDATE horizon_agent.conversations SET created_at = '2026-03-10T02:30:00Z' WHERE id = $1`, [lead1.conversationId])
    await client.query(
      `INSERT INTO horizon_agent.agent_drafts (conversation_id, trigger_message_id, draft_body, model, created_at, human_action, similarity)
       VALUES ($1,$2,$3,'teste','2026-03-10T02:31:00Z','editou',0.6), ($1,$4,$3,'teste','2026-03-10T14:01:00Z','diferente',0.1), ($1,$4,$3,'teste','2026-03-10T14:02:00Z',NULL,NULL)`,
      [lead1.conversationId, lead1.messageId, crypto.encrypt('x'), lead2.messageId],
    )

    // só o dia 09 (SP): contém a 1ª mensagem (23:30 SP) e nada do dia 10
    const d9 = await svc.stats('2026-03-09', '2026-03-09')
    expect(d9.mensagens).toHaveLength(1)
    expect(d9.mensagens[0]).toEqual({ dia: '2026-03-09', leads_in: 1, humano_out: 1, agente_out: 0 })
    expect(d9.horarios_pico.find((h: any) => h.hora === 23)!.mensagens).toBe(2)
    expect(d9.horarios_pico).toHaveLength(24)
    expect(d9.conversas_novas).toBe(1)

    const both = await svc.stats('2026-03-09', '2026-03-10')
    expect(both.mensagens.map((m: any) => m.dia)).toEqual(['2026-03-09', '2026-03-10'])
    expect(both.mensagens[1]).toEqual({ dia: '2026-03-10', leads_in: 1, humano_out: 1, agente_out: 0 })
    expect(both.conversas_ativas).toBe(1)
    expect(both.tempo_primeira_resposta_humano_seg).toMatchObject({ p50: 120, p90: 120, media: 120 })
    expect(both.tempo_resposta_humano_seg.p50).toBe(360) // mediana de 120 e 600
    expect(both.rascunhos).toMatchObject({ total: 3, comparados: 2, igual: 0, editou: 1, diferente: 1, ignorou: 0, usable_rate: 0.5 })
    expect(both.por_etapa).toEqual([{ stage: 'respondeu', conversas: 1 }])
    expect(both.taxa_resposta_equipe).toBe(1)

    // período sem dados: zeros e nulos honestos, nunca estimativa
    const empty = await svc.stats('2026-01-01', '2026-01-02')
    expect(empty.conversas_ativas).toBe(0)
    expect(empty.tempo_primeira_resposta_humano_seg.p50).toBeNull()
    expect(empty.rascunhos.usable_rate).toBeNull()
    expect(empty.taxa_resposta_lead).toBeNull()

    // HTTP: validação do período
    await http().get('/pilot/conversations/stats?from=2026-03-10&to=2026-03-01').expect(400)
    await http().get('/pilot/conversations/stats?from=banana').expect(400)
    await http().get('/pilot/conversations/stats?from=2024-01-01&to=2026-03-01').expect(400) // > 366 dias
    const ok = await http().get('/pilot/conversations/stats?from=2026-03-09&to=2026-03-10').expect(200)
    expect(ok.body.mensagens).toHaveLength(2)
  })

  it('não deixa resíduo: o tenant de teste está vazio depois do rollback', async () => {
    await client.query('ROLLBACK')
    const n = (await client.query(`SELECT count(*)::int n FROM horizon_agent.leads WHERE tenant = 'teste_rollback'`)).rows[0].n
    expect(n).toBe(0)
    await client.query('BEGIN') // o afterEach faz o ROLLBACK final
  })
})
