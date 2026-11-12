import { createHmac } from 'crypto'
import { hashPassword, passwordProblems, verifyPassword } from './password.util'
import { hashToken, newRefreshToken, signAccessToken, verifyAccessToken } from './tokens.util'

const SECRET = 'k'.repeat(10) + 'Z9x!'.repeat(6)
const b64u = (o: any) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url')
const user = { id: 'u1', tenant: 'alberto', role: 'viewer' as const }

describe('password.util', () => {
  it('hash tem sal por usuario e verifica', async () => {
    const a = await hashPassword('Correct-Horse-9battery')
    const b = await hashPassword('Correct-Horse-9battery')
    expect(a).not.toBe(b)
    expect(a.startsWith('scrypt$')).toBe(true)
    expect(await verifyPassword('Correct-Horse-9battery', a)).toBe(true)
    expect(await verifyPassword('Correct-Horse-9batterY', a)).toBe(false)
  })
  it('formato invalido nunca lanca', async () => {
    expect(await verifyPassword('x', 'lixo')).toBe(false)
    expect(await verifyPassword('x', 'scrypt$1$1$1$a$b')).toBe(false)
    expect(await verifyPassword('x', '')).toBe(false)
  })
  it('regras minimas de senha', () => {
    expect(passwordProblems('curta1A!')).not.toEqual([])
    expect(passwordProblems('somenteminusculasaqui')).not.toEqual([])
    expect(passwordProblems('Password1234!!')).not.toEqual([])
    expect(passwordProblems('Zebra-Lunar-4421-ok', 'x@y.com')).toEqual([])
    expect(passwordProblems('Joaozinho-Silva-77!', 'joaozinho@x.com')).not.toEqual([])
  })
})

describe('tokens.util (HS256 fixo)', () => {
  it('assina e verifica; expira em 15 min', () => {
    const now = 1_700_000_000
    const t = signAccessToken(user, SECRET, now)
    const c = verifyAccessToken(t, SECRET, now + 1)!
    expect(c).toMatchObject({ sub: 'u1', tenant: 'alberto', role: 'viewer' })
    expect(c.exp - c.iat).toBe(900)
    expect(verifyAccessToken(t, SECRET, now + 901)).toBeNull()
  })
  it('rejeita alg none', () => {
    const now = Math.floor(Date.now() / 1000)
    const payload = { sub: 'u1', tenant: 't', role: 'owner', iss: 'horizon-agent-panel', exp: now + 600 }
    expect(verifyAccessToken(`${b64u({ alg: 'none', typ: 'JWT' })}.${b64u(payload)}.`, SECRET)).toBeNull()
    expect(verifyAccessToken(`${b64u({ alg: 'NONE' })}.${b64u(payload)}.x`, SECRET)).toBeNull()
  })
  it('rejeita outros algoritmos mesmo com assinatura valida (HS384/HS512)', () => {
    const now = Math.floor(Date.now() / 1000)
    const h = b64u({ alg: 'HS384', typ: 'JWT' })
    const p = b64u({ sub: 'u1', tenant: 't', role: 'owner', iss: 'horizon-agent-panel', exp: now + 600 })
    const sig = createHmac('sha384', SECRET).update(`${h}.${p}`).digest('base64url')
    expect(verifyAccessToken(`${h}.${p}.${sig}`, SECRET)).toBeNull()
  })
  it('rejeita assinatura adulterada, segredo errado, claims invalidas', () => {
    const t = signAccessToken(user, SECRET)
    const [h, p, s] = t.split('.')
    const forged = b64u({ ...JSON.parse(Buffer.from(p, 'base64url').toString()), role: 'owner' })
    expect(verifyAccessToken(`${h}.${forged}.${s}`, SECRET)).toBeNull()
    expect(verifyAccessToken(t, SECRET + 'x')).toBeNull()
    expect(verifyAccessToken('a.b', SECRET)).toBeNull()
    expect(verifyAccessToken(signAccessToken({ ...user, role: 'god' as any }, SECRET), SECRET)).toBeNull()
  })
  it('refresh token: 256 bits, so o hash e derivavel', () => {
    const r = newRefreshToken()
    expect(Buffer.from(r.token, 'base64url').length).toBe(32)
    expect(r.hash).toBe(hashToken(r.token))
    expect(r.hash).not.toContain(r.token)
  })
})
