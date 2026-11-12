import { INestApplication, ValidationPipe } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { Test } from '@nestjs/testing'
import * as request from 'supertest'
import { PilotModule } from '../pilot.module'
import { PgService } from '../pg.service'
import { ChatGatewayService } from '../../chat-gateway/chat-gateway.service'
import { ROLES_KEY } from '../../panel-auth/roles.decorator'
import { BroadcastsController } from './broadcasts.controller'

// Borda HTTP dos disparos. Banco e chat são dublês; NENHUMA mensagem real é possível aqui.
describe('BroadcastsController (HTTP)', () => {
  let app: INestApplication
  const sqls: string[] = []
  const id = '11111111-1111-4111-8111-111111111111'
  let row: any
  const fakePg = {
    query: async (sql: string, params?: any[]) => {
      sqls.push(sql)
      if (/INSERT INTO horizon_agent\.broadcasts/.test(sql)) return { rows: [row], rowCount: 1 }
      if (/FROM horizon_agent\.broadcasts WHERE id/.test(sql)) return { rows: [row], rowCount: 1 }
      if (/UPDATE horizon_agent\.broadcast_recipients/.test(sql)) return { rows: [], rowCount: params?.[0] === 'wamid.OK' ? 1 : 0 }
      return { rows: [], rowCount: 0 }
    },
  }
  const gw = {
    sendTemplate: jest.fn(async () => { throw new Error('ENVIO REAL NÃO PODE ACONTECER NOS TESTES') }),
    sendText: jest.fn(async () => { throw new Error('ENVIO REAL NÃO PODE ACONTECER NOS TESTES') }),
    createTemplate: jest.fn(async () => ({})),
    listTemplates: jest.fn(async () => []),
    numberHealth: jest.fn(async () => ({ ok: false, error: 'chat_nao_configurado' })),
    configured: jest.fn(() => false),
    status: jest.fn(() => ({ configured: false, missing: ['CHAT_API_URL', 'CHAT_BRIDGE_KEY'], connectionId: null })),
  }
  const KEY = 'chave-de-teste'
  const saved = { ...process.env }

  beforeAll(async () => {
    process.env.PILOT_API_KEY = KEY
    delete process.env.BROADCASTS_ENABLED
    const mod = await Test.createTestingModule({ imports: [PilotModule] })
      .overrideProvider(PgService).useValue(fakePg)
      .overrideProvider(ChatGatewayService).useValue(gw)
      .compile()
    app = mod.createNestApplication()
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))
    await app.init()
  })
  afterAll(async () => { await app.close(); process.env = { ...saved } })
  beforeEach(() => {
    sqls.length = 0
    gw.sendTemplate.mockClear(); gw.sendText.mockClear(); gw.createTemplate.mockClear()
    gw.configured.mockReturnValue(false)
    row = {
      id, tenant: 'alberto', name: 'Teste', status: 'draft', kind: 'template', template_name: 'retomada_contato', template_language: 'pt_BR',
      variables_map: { '1': { source: 'lead.first_name' }, '2': { source: 'custom', value: 'Corretora' } }, audience_filter: {},
      window_start: '09:00', window_end: '18:00', window_days: [1, 2, 3, 4, 5], timezone: 'America/Sao_Paulo',
      rate_per_minute: 20, daily_cap: 200, dry_run: false, scheduled_at: null,
    }
  })
  const http = () => request(app.getHttpServer())

  it('webhook de entrega: sem chave 401, chave errada 401, status inválido 400', async () => {
    await http().post('/pilot/broadcasts/webhook/status').send({ wid: 'x', status: 'read' }).expect(401)
    await http().post('/pilot/broadcasts/webhook/status').set('x-pilot-key', 'outra').send({ wid: 'x', status: 'read' }).expect(401)
    await http().post('/pilot/broadcasts/webhook/status').set('x-pilot-key', KEY).send({ wid: 'x', status: 'inventado' }).expect(400)
    await http().post('/pilot/broadcasts/webhook/status').set('x-pilot-key', KEY).send({ status: 'read' }).expect(400)
  })

  it('webhook de entrega: aceita e informa quantos destinatários mudaram', async () => {
    const r = await http().post('/pilot/broadcasts/webhook/status').set('x-pilot-key', KEY).send({ wid: 'wamid.OK', status: 'delivered' }).expect(201)
    expect(r.body).toEqual({ updated: 1 })
    const r2 = await http().post('/pilot/broadcasts/webhook/status').set('x-pilot-key', KEY).send({ wid: 'wamid.NAO', status: 'failed', errorCode: '131026' }).expect(201)
    expect(r2.body).toEqual({ updated: 0 })
  })

  it('webhook fica fechado sem PILOT_API_KEY configurada', async () => {
    const k = process.env.PILOT_API_KEY
    delete process.env.PILOT_API_KEY
    await http().post('/pilot/broadcasts/webhook/status').set('x-pilot-key', 'qualquer').send({ wid: 'x', status: 'read' }).expect(401)
    process.env.PILOT_API_KEY = k
  })

  it('criar: valida o corpo (nome obrigatório, limites, janela)', async () => {
    await http().post('/pilot/broadcasts').send({}).expect(400)
    await http().post('/pilot/broadcasts').send({ name: 'x', ratePerMinute: 500 }).expect(400)
    await http().post('/pilot/broadcasts').send({ name: 'x', dailyCap: 100000 }).expect(400)
    await http().post('/pilot/broadcasts').send({ name: 'x', windowStart: '25:99' }).expect(400)
    await http().post('/pilot/broadcasts').send({ name: 'x', kind: 'sms' }).expect(400)
    await http().post('/pilot/broadcasts').send({ name: 'x', windowStart: '18:00', windowEnd: '09:00' }).expect(400)
    expect(sqls.some((s) => /INSERT INTO horizon_agent\.broadcasts/.test(s))).toBe(false)
  })

  it('criar: nasce em rascunho com simulação ligada por padrão', async () => {
    const r = await http().post('/pilot/broadcasts').send({ name: 'Retomada' }).expect(201)
    expect(r.body.id).toBe(id)
    const ins = sqls.find((s) => /INSERT INTO horizon_agent\.broadcasts/.test(s))!
    expect(ins).toBeDefined()
  })

  it('rotas com :id exigem UUID', async () => {
    await http().get('/pilot/broadcasts/nao-e-uuid').expect(400)
    await http().post('/pilot/broadcasts/nao-e-uuid/start').send({ confirm: true, expectedRecipients: 1 }).expect(400)
  })

  it('iniciar: exige confirmação e contagem esperada', async () => {
    await http().post(`/pilot/broadcasts/${id}/start`).send({}).expect(400)
    await http().post(`/pilot/broadcasts/${id}/start`).send({ confirm: 'sim', expectedRecipients: 3 }).expect(400)
    await http().post(`/pilot/broadcasts/${id}/start`).send({ confirm: false, expectedRecipients: 3 }).expect(400)
    await http().post(`/pilot/broadcasts/${id}/start`).send({ confirm: true }).expect(400)
  })

  it('interruptor geral desligado: envio real é recusado (403) e o chat não é chamado', async () => {
    delete process.env.BROADCASTS_ENABLED
    const r = await http().post(`/pilot/broadcasts/${id}/start`).send({ confirm: true, expectedRecipients: 3 }).expect(403)
    expect(JSON.stringify(r.body)).toMatch(/BROADCASTS_ENABLED/)
    expect(gw.sendTemplate).not.toHaveBeenCalled()
    expect(sqls.some((s) => /INSERT INTO horizon_agent\.broadcast_recipients/.test(s))).toBe(false)
  })

  it('interruptor ligado mas chat não configurado: 503, nada materializado', async () => {
    process.env.BROADCASTS_ENABLED = 'true'
    await http().post(`/pilot/broadcasts/${id}/start`).send({ confirm: true, expectedRecipients: 3 }).expect(503)
    expect(sqls.some((s) => /INSERT INTO horizon_agent\.broadcast_recipients/.test(s))).toBe(false)
    delete process.env.BROADCASTS_ENABLED
  })

  it('templates: sem chat, mostra os 5 rascunhos como "não criados" e o chat como não configurado', async () => {
    const r = await http().get('/pilot/broadcasts/templates?refresh=1').expect(200)
    expect(r.body.chat.configured).toBe(false)
    expect(r.body.syncError).toBe('chat_nao_configurado')
    expect(r.body.drafts).toHaveLength(5)
    expect(r.body.drafts.every((d: any) => d.state === 'NAO_CRIADO')).toBe(true)
    expect(gw.listTemplates).not.toHaveBeenCalled()
  })

  it('criar template: reprova marketing sem aviso de saída antes de falar com o chat', async () => {
    gw.configured.mockReturnValue(true)
    const bad = { name: 'sem_saida', category: 'MARKETING', bodyText: 'Olá {{1}}, temos novidades para você hoje.', bodyExamples: ['Maria'] }
    const r = await http().post('/pilot/broadcasts/templates').send(bad).expect(400)
    expect(JSON.stringify(r.body)).toMatch(/aviso de saída/)
    expect(gw.createTemplate).not.toHaveBeenCalled()
  })

  it('criar template válido chama o chat uma vez e guarda como PENDING', async () => {
    gw.configured.mockReturnValue(true)
    const ok = { name: 'retomada_x', category: 'MARKETING', bodyText: 'Olá {{1}}, quer retomar a conversa?', bodyExamples: ['Maria'], buttons: [{ type: 'QUICK_REPLY', text: 'Parar mensagens' }] }
    const r = await http().post('/pilot/broadcasts/templates').send(ok).expect(201)
    expect(r.body.status).toBe('PENDING')
    expect(gw.createTemplate).toHaveBeenCalledTimes(1)
    expect(sqls.some((s) => /INSERT INTO horizon_agent\.message_templates_cache/.test(s))).toBe(true)
  })

  it('saúde do número: sem chat devolve estado honesto, sem valores inventados', async () => {
    const r = await http().get('/pilot/broadcasts/number-health').expect(200)
    expect(r.body.chat.configured).toBe(false)
    expect(r.body.latest).toBeNull()
    expect(r.body.verdict.state).toBe('ok') // sem disparo rodando não há o que bloquear
    expect(r.body.history).toEqual([])
  })

  it('webhook de qualidade: exige chave e valida corpo; não chama o chat para enviar nada', async () => {
    await http().post('/pilot/broadcasts/webhook/quality').send({ event: 'DOWNGRADE' }).expect(401)
    await http().post('/pilot/broadcasts/webhook/quality').set('x-pilot-key', KEY).send({}).expect(400)
    const r = await http().post('/pilot/broadcasts/webhook/quality').set('x-pilot-key', KEY).send({ event: 'DOWNGRADE', currentLimit: 'TIER_250' }).expect(201)
    expect(r.body).toEqual({ received: true })
    expect(sqls.some((s) => /INSERT INTO horizon_agent\.number_health_snapshots/.test(s))).toBe(true) // releitura falhou: falha fechado (vermelho)
    expect(gw.sendTemplate).not.toHaveBeenCalled()
  })

  it('retomar exige confirmação', async () => {
    await http().post(`/pilot/broadcasts/${id}/resume`).send({}).expect(400)
    await http().post(`/pilot/broadcasts/${id}/resume`).send({ confirm: false }).expect(400)
  })

  it('papéis: leitura = viewer, operação = manager, criar template = owner', () => {
    const ref = new Reflector()
    const proto = BroadcastsController.prototype as any
    const role = (m: string) => ref.get<string[]>(ROLES_KEY, proto[m])?.[0]
    for (const m of ['list', 'get', 'recipients', 'listTemplates']) expect(role(m)).toBe('viewer')
    for (const m of ['create', 'update', 'preview', 'start', 'pause', 'resume', 'cancel']) expect(role(m)).toBe('manager')
    expect(role('createTemplate')).toBe('owner')
    expect(role('numberHealth')).toBe('viewer')
    expect(role('quality')).toBeUndefined()
    expect(role('status')).toBeUndefined() // webhook: autenticado por chave, não por papel
  })
})
