import { Controller, Get, INestApplication, ValidationPipe } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler'
import { Public } from '../auth/public.decorator'
import { Test } from '@nestjs/testing'
import * as request from 'supertest'
import { PilotModule } from './pilot.module'
import { PgService } from './pg.service'
import { PilotController } from './pilot.controller'
import { BroadcastsController } from './broadcasts/broadcasts.controller'
import { INGEST_LIMIT_PER_MINUTE } from './ingest-throttle'

// Cobre só a borda HTTP: autenticação por chave e validação de entrada. O banco é um dublê.
describe('PilotController (HTTP)', () => {
  let app: INestApplication
  const calls: string[] = []
  const fakePg = {
    query: async (sql: string) => {
      calls.push(sql)
      if (/INSERT INTO horizon_agent.leads/.test(sql)) return { rows: [{ id: 'x', created: false }], rowCount: 1 }
      return { rows: [], rowCount: 0 }
    },
  }

  beforeAll(async () => {
    process.env.PILOT_API_KEY = 'chave-de-teste'
    const mod = await Test.createTestingModule({ imports: [PilotModule] }).overrideProvider(PgService).useValue(fakePg).compile()
    app = mod.createNestApplication()
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))
    await app.init()
  })
  afterAll(async () => { await app.close(); delete process.env.PILOT_API_KEY })

  it('rejeita ingestão sem chave', async () => {
    await request(app.getHttpServer()).post('/pilot/leads').send({ phone: '83999991234' }).expect(401)
  })

  it('rejeita chave errada', async () => {
    await request(app.getHttpServer()).post('/pilot/leads').set('x-pilot-key', 'outra').send({ phone: '83999991234' }).expect(401)
  })

  it('valida o corpo (telefone ausente e tipo de evento inválido)', async () => {
    await request(app.getHttpServer()).post('/pilot/leads').set('x-pilot-key', 'chave-de-teste').send({}).expect(400)
    await request(app.getHttpServer()).post('/pilot/events').set('x-pilot-key', 'chave-de-teste').send({ phone: '83999991234', type: 'inventado' }).expect(400)
  })

  it('aceita lead válido com a chave certa', async () => {
    await request(app.getHttpServer()).post('/pilot/leads').set('x-pilot-key', 'chave-de-teste').send({ phone: '83999991234', name: 'Teste' }).expect(201)
  })

  it('sem PILOT_API_KEY configurada a ingestão fica fechada', async () => {
    const saved = process.env.PILOT_API_KEY
    delete process.env.PILOT_API_KEY
    await request(app.getHttpServer()).post('/pilot/leads').set('x-pilot-key', 'qualquer').send({ phone: '83999991234' }).expect(401)
    process.env.PILOT_API_KEY = saved
  })

  it('shadow/run responde "disabled" sem chave da Anthropic', async () => {
    delete process.env.ANTHROPIC_API_KEY
    const res = await request(app.getHttpServer())
      .post('/pilot/shadow/run').set('x-pilot-key', 'chave-de-teste')
      .send({ conversationId: '00000000-0000-4000-8000-000000000000' }).expect(201)
    expect(res.body).toEqual({ status: 'disabled' })
  })
})

// ───── Limite próprio das rotas do chat e deduplicação sem `wid` ─────
describe('ingestão do chat: limite e idempotência', () => {
  const KEY = 'chave-de-teste'
  const inserts: any[][] = []
  const fakePg = {
    query: async (sql: string, params: any[] = []) => {
      if (/INSERT INTO horizon_agent\.leads/.test(sql)) return { rows: [{ id: 'lead-1', created: false }], rowCount: 1 }
      if (/INSERT INTO horizon_agent\.conversations/.test(sql)) return { rows: [{ id: 'conv-1' }], rowCount: 1 }
      if (/FROM horizon_agent\.conversations WHERE lead_id/.test(sql)) return { rows: [{ id: 'conv-1' }], rowCount: 1 }
      if (/INSERT INTO horizon_agent\.messages/.test(sql)) {
        inserts.push(params)
        return { rows: [{ id: String(inserts.length) }], rowCount: 1 }
      }
      return { rows: [], rowCount: 0 }
    },
  }
  let app: INestApplication
  const post = (body: object) => request(app.getHttpServer()).post('/pilot/ingest/message').set('x-pilot-key', KEY).send(body)
  const base = { phone: '83999991234', direction: 'in', author: 'lead', body: 'Oi, quero saber o preço' }

  beforeAll(async () => {
    process.env.PILOT_API_KEY = KEY
    const mod = await Test.createTestingModule({ imports: [PilotModule] }).overrideProvider(PgService).useValue(fakePg).compile()
    app = mod.createNestApplication()
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))
    await app.init()
  })
  afterAll(async () => { await app.close(); delete process.env.PILOT_API_KEY; delete process.env.PILOT_REQUIRE_WID })
  beforeEach(() => { inserts.length = 0; delete process.env.PILOT_REQUIRE_WID })

  it('as rotas que o chat chama têm limite próprio (não o global de 1500 por 15 min)', () => {
    const meta = (cls: any, name: string) => Reflect.getMetadata('THROTTLER:LIMITdefault', cls.prototype[name])
    for (const n of ['createLead', 'ingest', 'event', 'qualification', 'shadowRun']) expect(meta(PilotController, n)).toBe(INGEST_LIMIT_PER_MINUTE)
    for (const n of ['quality', 'status']) expect(meta(BroadcastsController, n)).toBe(INGEST_LIMIT_PER_MINUTE)
    expect(INGEST_LIMIT_PER_MINUTE).toBeGreaterThan(1500 / 15) // acima do que o limite global permitia por minuto
  })

  it('mensagem recebida SEM wid ganha chave de deduplicação; COM wid usa o do chat', async () => {
    await post(base).expect(201)
    expect(inserts[0][4]).toMatch(/^auto:[0-9a-f]{40}$/)
    await post({ ...base, wid: 'wamid.ABC' }).expect(201)
    expect(inserts[1][4]).toBe('wamid.ABC')
  })

  it('mensagem enviada sem wid NÃO ganha chave (duas respostas iguais precisam existir)', async () => {
    await post({ ...base, direction: 'out', author: 'humano' }).expect(201)
    expect(inserts[0][4]).toBeNull()
  })

  it('PILOT_REQUIRE_WID=true recusa recebida sem wid antes de gravar qualquer coisa', async () => {
    process.env.PILOT_REQUIRE_WID = 'true'
    await post(base).expect(400)
    expect(inserts).toHaveLength(0)
    await post({ ...base, wid: 'wamid.XYZ' }).expect(201) // com wid segue normal
    await post({ ...base, direction: 'out', author: 'humano' }).expect(201) // só vale para recebidas
  })
})

// Prova comportamental: com o limite GLOBAL reduzido a 5 por minuto, a ingestão do chat segue aceitando, e uma rota
// comum (controle) leva 429. Era o defeito: o chat é um IP só e estourava o limite global.
@Controller('probe-throttle')
class ThrottleProbe {
  @Public() @Get() ping() { return { ok: true } }
}

describe('limite global não derruba a ingestão do chat', () => {
  let app: INestApplication
  beforeAll(async () => {
    process.env.PILOT_API_KEY = 'chave-de-teste'
    const mod = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot([{ ttl: 60_000, limit: 5 }]), PilotModule],
      controllers: [ThrottleProbe],
      providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
    })
      .overrideProvider(PgService)
      .useValue({ query: async () => ({ rows: [{ id: 'x', created: false }], rowCount: 1 }) })
      .compile()
    app = mod.createNestApplication()
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))
    await app.init()
  })
  afterAll(async () => { await app.close(); delete process.env.PILOT_API_KEY })

  it('rota comum: 429 depois do limite (o limiter está ativo)', async () => {
    const codes: number[] = []
    for (let i = 0; i < 8; i++) codes.push((await request(app.getHttpServer()).get('/probe-throttle')).status)
    expect(codes.slice(0, 5).every((c) => c === 200)).toBe(true)
    expect(codes.slice(5).every((c) => c === 429)).toBe(true)
  })

  it('ingestão do chat: 30 chamadas seguidas, nenhuma 429', async () => {
    const codes: number[] = []
    for (let i = 0; i < 30; i++) {
      codes.push((await request(app.getHttpServer()).post('/pilot/leads').set('x-pilot-key', 'chave-de-teste').send({ phone: '83999991234' })).status)
    }
    expect(codes).not.toContain(429)
    expect(codes.every((c) => c === 201)).toBe(true)
  })
})
