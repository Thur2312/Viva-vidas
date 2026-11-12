import { UnauthorizedException } from '@nestjs/common'
import { FakePg } from 'test/panel-auth/fake-pg'
import { PanelAuthService, MAX_FAILED_ATTEMPTS } from './panel-auth.service'
import { verifyAccessToken } from './tokens.util'

const PASS = 'Zebra-Lunar-4421-ok'

describe('PanelAuthService', () => {
  let pg: FakePg
  let svc: PanelAuthService
  let user: any
  beforeAll(() => {
    process.env.SECRETKEY = 'unit-test-secret-' + 'x'.repeat(32)
  })
  beforeEach(async () => {
    pg = new FakePg()
    svc = new PanelAuthService(pg as any)
    user = await pg.addUser({ email: 'Ana@Exemplo.com', password: PASS, role: 'manager' })
  })

  it('login ok devolve tokens e user; e-mail case-insensitive', async () => {
    const r = await svc.login(' ANA@exemplo.com ', PASS, 'jest')
    expect(r.expiresIn).toBe(900)
    expect(r.user).toEqual({ id: user.id, name: 'Teste', email: 'ana@exemplo.com', role: 'manager' })
    expect(verifyAccessToken(r.accessToken)).toMatchObject({ sub: user.id, tenant: 'alberto', role: 'manager' })
    // so o hash do refresh e guardado
    expect(pg.tokens).toHaveLength(1)
    expect(JSON.stringify(pg.tokens)).not.toContain(r.refreshToken)
  })

  it('falhas dao a mesma excecao generica (usuario inexistente, senha errada, inativo, corpo invalido)', async () => {
    await pg.addUser({ email: 'off@x.com', password: PASS, active: false })
    const msgs = new Set<string>()
    for (const [e, p] of [['nao@existe.com', PASS], ['ana@exemplo.com', 'errada'], ['off@x.com', PASS], [undefined, undefined], [{}, []]] as any[]) {
      try {
        await svc.login(e, p)
        throw new Error('deveria falhar')
      } catch (err) {
        expect(err).toBeInstanceOf(UnauthorizedException)
        msgs.add((err as Error).message)
      }
    }
    expect(msgs.size).toBe(1)
  })

  it('bloqueia apos 5 falhas por 15 min, mesmo com a senha certa', async () => {
    for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) await expect(svc.login('ana@exemplo.com', 'errada')).rejects.toThrow(UnauthorizedException)
    expect(user.locked_until).toBeInstanceOf(Date)
    const mins = (user.locked_until.getTime() - Date.now()) / 60000
    expect(mins).toBeGreaterThan(14)
    expect(mins).toBeLessThanOrEqual(15)
    await expect(svc.login('ana@exemplo.com', PASS)).rejects.toThrow(UnauthorizedException)
    user.locked_until = new Date(Date.now() - 1000) // expirou
    await expect(svc.login('ana@exemplo.com', PASS)).resolves.toBeDefined()
    expect(user.failed_attempts).toBe(0)
  })

  it('login com sucesso zera o contador de falhas', async () => {
    await svc.login('ana@exemplo.com', 'errada').catch(() => 0)
    await svc.login('ana@exemplo.com', 'errada').catch(() => 0)
    expect(user.failed_attempts).toBe(2)
    await svc.login('ana@exemplo.com', PASS)
    expect(user.failed_attempts).toBe(0)
  })

  it('refresh rotaciona: token novo, antigo revogado e encadeado', async () => {
    const a = await svc.login('ana@exemplo.com', PASS)
    const b = await svc.refresh(a.refreshToken)
    expect(b.refreshToken).not.toBe(a.refreshToken)
    expect(pg.tokens).toHaveLength(2)
    expect(pg.tokens[0].revoked_at).toBeTruthy()
    expect(pg.tokens[0].replaced_by).toBe(pg.tokens[1].id)
    expect(pg.tokens[1].family_id).toBe(pg.tokens[0].family_id)
    expect(pg.tokens[1].revoked_at).toBeNull()
  })

  it('reuso de refresh antigo revoga a familia inteira', async () => {
    const a = await svc.login('ana@exemplo.com', PASS)
    const b = await svc.refresh(a.refreshToken)
    await expect(svc.refresh(a.refreshToken)).rejects.toThrow(UnauthorizedException) // reuso
    expect(pg.tokens.every((t) => t.revoked_at)).toBe(true)
    await expect(svc.refresh(b.refreshToken)).rejects.toThrow(UnauthorizedException) // o novo tambem caiu
  })

  it('refresh de outra familia nao e afetado pelo reuso', async () => {
    const a = await svc.login('ana@exemplo.com', PASS)
    const other = await svc.login('ana@exemplo.com', PASS)
    const a2 = await svc.refresh(a.refreshToken)
    await svc.refresh(a.refreshToken).catch(() => 0)
    await expect(svc.refresh(other.refreshToken)).resolves.toBeDefined()
    expect(a2).toBeDefined()
  })

  it('refresh invalido, expirado ou de usuario inativo e recusado', async () => {
    await expect(svc.refresh('x'.repeat(43))).rejects.toThrow(UnauthorizedException)
    await expect(svc.refresh(undefined)).rejects.toThrow(UnauthorizedException)
    const a = await svc.login('ana@exemplo.com', PASS)
    pg.tokens[0].expires_at = new Date(Date.now() - 1000)
    await expect(svc.refresh(a.refreshToken)).rejects.toThrow(UnauthorizedException)
    const b = await svc.login('ana@exemplo.com', PASS)
    user.active = false
    await expect(svc.refresh(b.refreshToken)).rejects.toThrow(UnauthorizedException)
    expect(pg.tokens.filter((t) => t.id !== pg.tokens[0].id).every((t) => t.revoked_at)).toBe(true)
  })

  it('logout revoga a sessao e e idempotente', async () => {
    const a = await svc.login('ana@exemplo.com', PASS)
    await svc.logout(a.refreshToken)
    await svc.logout(a.refreshToken)
    await svc.logout('desconhecido')
    await expect(svc.refresh(a.refreshToken)).rejects.toThrow(UnauthorizedException)
  })
})
