import { Controller, Get, INestApplication } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'
import { Test } from '@nestjs/testing'
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler'
import { createHmac } from 'crypto'
import * as request from 'supertest'
import { FakePg } from 'test/panel-auth/fake-pg'
import { AuthModule } from '../auth/auth.module'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { NoTenant } from '../auth/no-tenant.decorator'
import { TenantGuard } from '../auth/tenant.guard'
import { PgService } from '../pilot/pg.service'
import { PilotModule } from '../pilot/pilot.module'
import { PanelAuthModule } from './panel-auth.module'
import { Roles } from './roles.decorator'
import { RolesGuard } from './roles.guard'
import { SafeExceptionFilter } from './security/hardening'
import { signAccessToken } from './tokens.util'

const PASS = 'Zebra-Lunar-4421-ok'
const SECRET = 'http-test-secret-' + 'y'.repeat(32)
const b64u = (o: any) => Buffer.from(JSON.stringify(o)).toString('base64url')

@Controller('probe')
@NoTenant()
class ProbeController {
  @Get('manager') @Roles('manager') m() { return { ok: true } }
  @Get('owner') @Roles('owner') o() { return { ok: true } }
  @Get('boom') boom(): never { throw new Error('segredo-interno postgres://u:p@h/db 5583999991234') }
}

async function build(throttle = false): Promise<{ app: INestApplication; pg: FakePg }> {
  const pg = new FakePg()
  const mod = await Test.createTestingModule({
    imports: [ThrottlerModule.forRoot([{ ttl: 900000, limit: 1500 }]), AuthModule, PanelAuthModule, PilotModule],
    controllers: [ProbeController],
    providers: [
      { provide: APP_GUARD, useClass: JwtAuthGuard },
      { provide: APP_GUARD, useClass: TenantGuard },
      { provide: APP_GUARD, useClass: RolesGuard },
      ...(throttle ? [{ provide: APP_GUARD, useClass: ThrottlerGuard }] : []),
    ],
  })
    .overrideProvider(PgService)
    .useValue(pg)
    .compile()
  const app = mod.createNestApplication()
  app.useGlobalFilters(new SafeExceptionFilter())
  await app.init()
  return { app, pg }
}

describe('panel-auth (HTTP, PgService falso)', () => {
  let app: INestApplication
  let pg: FakePg
  const http = () => request(app.getHttpServer())
  beforeAll(async () => {
    process.env.SECRETKEY = SECRET
    process.env.PANEL_SESSION_CACHE_MS = '0' // sem cache: cada teste enxerga o banco falso na hora
    ;({ app, pg } = await build())
    await pg.addUser({ email: 'viewer@x.com', password: PASS, role: 'viewer' })
    await pg.addUser({ email: 'mgr@x.com', password: PASS, role: 'manager' })
    await pg.addUser({ email: 'own@x.com', password: PASS, role: 'owner' })
  })
  afterAll(async () => app.close())

  const login = (email: string, password = PASS) => http().post('/panel-auth/login').send({ email, password })

  it('login 200 com o formato do contrato', async () => {
    const r = await login('viewer@x.com').expect(200)
    expect(Object.keys(r.body).sort()).toEqual(['accessToken', 'expiresIn', 'refreshToken', 'user'])
    expect(Object.keys(r.body.user).sort()).toEqual(['email', 'id', 'name', 'role'])
    expect(r.body.expiresIn).toBe(900)
    expect(JSON.stringify(r.body)).not.toMatch(/password|hash/i)
  })

  it('401 generico para qualquer falha de login (inclui corpo vazio)', async () => {
    const bodies = await Promise.all([
      login('viewer@x.com', 'errada'),
      login('naoexiste@x.com'),
      http().post('/panel-auth/login').send({}),
      http().post('/panel-auth/login').send({ email: ['a'], password: { $ne: 1 } }),
    ])
    bodies.forEach((r) => expect(r.status).toBe(401))
    expect(new Set(bodies.map((r) => JSON.stringify(r.body))).size).toBe(1)
  })

  it('me exige Bearer e devolve o usuario', async () => {
    await http().get('/panel-auth/me').expect(401)
    const { body } = await login('mgr@x.com').expect(200)
    const me = await http().get('/panel-auth/me').set('Authorization', `Bearer ${body.accessToken}`).expect(200)
    expect(me.body).toMatchObject({ email: 'mgr@x.com', role: 'manager' })
  })

  it('refresh rotaciona; reuso derruba a familia; logout 204', async () => {
    const a = (await login('viewer@x.com')).body
    const b = (await http().post('/panel-auth/refresh').send({ refreshToken: a.refreshToken }).expect(200)).body
    expect(b.refreshToken).not.toBe(a.refreshToken)
    expect(b.user.email).toBe('viewer@x.com')
    // Logo apos a rotacao: 409 (requisicao simultanea), sem derrubar a sessao.
    await http().post('/panel-auth/refresh').send({ refreshToken: a.refreshToken }).expect(409)
    pg.tokens.forEach((t) => t.revoked_at && (t.revoked_at = new Date(Date.now() - 11_000))) // passou a janela de tolerancia
    await http().post('/panel-auth/refresh').send({ refreshToken: a.refreshToken }).expect(401)
    await http().post('/panel-auth/refresh').send({ refreshToken: b.refreshToken }).expect(401)
    const c = (await login('viewer@x.com')).body
    await http().post('/panel-auth/logout').send({ refreshToken: c.refreshToken }).expect(204)
    await http().post('/panel-auth/refresh').send({ refreshToken: c.refreshToken }).expect(401)
    await http().post('/panel-auth/logout').send({}).expect(204)
  })

  it('JWT: alg none, HS384, token expirado, assinatura errada e sem exp sao 401', async () => {
    const now = Math.floor(Date.now() / 1000)
    const claims = { sub: 'u', tenant: 't', role: 'owner', iss: 'horizon-agent-panel', exp: now + 600 }
    const none = `${b64u({ alg: 'none', typ: 'JWT' })}.${b64u(claims)}.`
    const h384 = `${b64u({ alg: 'HS384', typ: 'JWT' })}.${b64u(claims)}`
    const hs384 = `${h384}.${createHmac('sha384', SECRET).update(h384).digest('base64url')}`
    const noExpBody = b64u({ ...claims, exp: undefined })
    const noExpHead = b64u({ alg: 'HS256', typ: 'JWT' })
    const noExp = `${noExpHead}.${noExpBody}.${createHmac('sha256', SECRET).update(`${noExpHead}.${noExpBody}`).digest('base64url')}`
    const expired = signAccessToken({ id: 'u', tenant: 't', role: 'owner' }, SECRET, now - 4000)
    const wrongKey = signAccessToken({ id: 'u', tenant: 't', role: 'owner' }, 'outro-segredo-' + 'z'.repeat(32))
    for (const t of [none, hs384, noExp, expired, wrongKey]) await http().get('/probe/manager').set('Authorization', `Bearer ${t}`).expect(401)
  })

  it('RBAC: viewer 403, manager so manager, owner tudo', async () => {
    const tok = async (e: string) => (await login(e)).body.accessToken
    const get = (path: string, t: string) => http().get(path).set('Authorization', `Bearer ${t}`)
    const [v, m, o] = [await tok('viewer@x.com'), await tok('mgr@x.com'), await tok('own@x.com')]
    await get('/probe/manager', v).expect(403)
    await get('/probe/manager', m).expect(200)
    await get('/probe/owner', m).expect(403)
    await get('/probe/owner', o).expect(200)
    await http().get('/probe/manager').expect(401)
  })

  it('/pilot/* leitura exige token valido (viewer basta)', async () => {
    await http().get('/pilot/overview').expect(401)
    await http().get('/pilot/leads').expect(401)
    const t = (await login('viewer@x.com')).body.accessToken
    const r = await http().get('/pilot/readiness').set('Authorization', `Bearer ${t}`)
    expect([401, 403]).not.toContain(r.status)
  })

  describe('revogacao imediata do access token (token_version)', () => {
    const get = (t: string) => http().get('/probe/manager').set('Authorization', `Bearer ${t}`)
    const user = (email: string) => pg.users.find((u) => u.email === email)

    it('aumentar token_version (reset de senha) derruba o token ja emitido; novo login funciona', async () => {
      await pg.addUser({ email: 'reset@x.com', password: PASS, role: 'manager' })
      const old = (await login('reset@x.com')).body.accessToken
      await get(old).expect(200)
      user('reset@x.com').token_version += 1 // o que o script panel:reset-password faz
      await get(old).expect(401)
      const fresh = (await login('reset@x.com')).body.accessToken
      await get(fresh).expect(200)
    })

    it('usuario desativado perde o acesso na hora, mesmo com token valido', async () => {
      await pg.addUser({ email: 'off@x.com', password: PASS, role: 'manager' })
      const t = (await login('off@x.com')).body.accessToken
      await get(t).expect(200)
      user('off@x.com').active = false
      await get(t).expect(401)
    })

    it('o papel vem do banco: rebaixar vale na hora (o JWT ainda diz manager)', async () => {
      await pg.addUser({ email: 'down@x.com', password: PASS, role: 'manager' })
      const t = (await login('down@x.com')).body.accessToken
      await get(t).expect(200)
      user('down@x.com').role = 'viewer'
      await get(t).expect(403)
    })

    it('token antigo sem `tv` vale como versao 0; usuario inexistente e sub invalido sao 401', async () => {
      const u = await pg.addUser({ email: 'old@x.com', password: PASS, role: 'manager' })
      const now = Math.floor(Date.now() / 1000)
      const head = b64u({ alg: 'HS256', typ: 'JWT' })
      const sign = (claims: any) => {
        const body = b64u(claims)
        return `${head}.${body}.${createHmac('sha256', SECRET).update(`${head}.${body}`).digest('base64url')}`
      }
      const base = { tenant: 'alberto', role: 'manager', iss: 'horizon-agent-panel', exp: now + 600 }
      await get(sign({ ...base, sub: u.id })).expect(200) // sem tv
      u.token_version = 3
      await get(sign({ ...base, sub: u.id })).expect(401) // versao do banco avancou
      await get(sign({ ...base, sub: u.id, tv: 3 })).expect(200)
      await get(sign({ ...base, sub: u.id, tv: 'x' })).expect(401)
      await get(sign({ ...base, sub: '00000000-0000-4000-8000-0000000fffff', tv: 0 })).expect(401) // nao existe
      await get(sign({ ...base, sub: "x'; DROP TABLE panel_users;--", tv: 0 })).expect(401) // nem chega ao banco
    })
  })

  it('5xx nao vaza mensagem interna', async () => {
    const t = (await login('own@x.com')).body.accessToken
    const r = await http().get('/probe/boom').set('Authorization', `Bearer ${t}`).expect(500)
    expect(r.body).toEqual({ statusCode: 500, message: 'Internal server error' })
    expect(JSON.stringify(r.body)).not.toMatch(/postgres|segredo|5583/)
  })
})

describe('panel-auth rate limit', () => {
  it('login: 429 apos 10 tentativas por minuto', async () => {
    process.env.SECRETKEY = SECRET
    const { app } = await build(true)
    const codes: number[] = []
    for (let i = 0; i < 12; i++) codes.push((await request(app.getHttpServer()).post('/panel-auth/login').send({ email: 'a@b.com', password: 'x' })).status)
    expect(codes.slice(0, 10).every((c) => c === 401)).toBe(true)
    expect(codes[11]).toBe(429)
    await app.close()
  })
})
