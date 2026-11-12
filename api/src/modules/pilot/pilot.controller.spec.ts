import { INestApplication, ValidationPipe } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import * as request from 'supertest'
import { PilotModule } from './pilot.module'
import { PgService } from './pg.service'

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
