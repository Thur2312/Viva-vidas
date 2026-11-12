import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto'
import { ACCESS_TOKEN_ISSUER, ACCESS_TOKEN_TTL_SECONDS, PanelRole, isPanelRole } from './panel-roles'

const b64u = (b: Buffer | string) => Buffer.from(b).toString('base64url')

export interface AccessClaims {
  sub: string
  tenant: string
  role: PanelRole
  iss: string
  iat: number
  exp: number
}

/** JWT HS256 assinado com SECRETKEY. */
export function signAccessToken(
  user: { id: string; tenant: string; role: PanelRole },
  secret = process.env.SECRETKEY,
  now = Math.floor(Date.now() / 1000),
): string {
  if (!secret) throw new Error('SECRETKEY ausente')
  const header = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const payload = b64u(
    JSON.stringify({ sub: user.id, tenant: user.tenant, role: user.role, iss: ACCESS_TOKEN_ISSUER, iat: now, exp: now + ACCESS_TOKEN_TTL_SECONDS }),
  )
  const sig = createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url')
  return `${header}.${payload}.${sig}`
}

/**
 * Verificador proprio com algoritmo FIXO em HS256 (rejeita none/HS384/RS256...). Retorna null
 * para qualquer falha. A estrategia do passport tambem fixa HS256; este e o ponto testavel
 * isoladamente.
 */
export function verifyAccessToken(token: string, secret = process.env.SECRETKEY, now = Math.floor(Date.now() / 1000)): AccessClaims | null {
  try {
    if (!secret || typeof token !== 'string') return null
    const parts = token.split('.')
    if (parts.length !== 3) return null
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'))
    if (header?.alg !== 'HS256') return null
    const expected = createHmac('sha256', secret).update(`${parts[0]}.${parts[1]}`).digest()
    const got = Buffer.from(parts[2], 'base64url')
    if (got.length !== expected.length || !timingSafeEqual(got, expected)) return null
    const c = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
    if (typeof c.exp !== 'number' || c.exp <= now) return null
    if (c.iss !== ACCESS_TOKEN_ISSUER) return null
    if (typeof c.sub !== 'string' || typeof c.tenant !== 'string' || !isPanelRole(c.role)) return null
    return c as AccessClaims
  } catch {
    return null
  }
}

export const hashToken = (t: string) => createHash('sha256').update(t).digest('hex')
export const hashUserAgent = (ua?: string) => (ua ? createHash('sha256').update(ua).digest('hex') : null)

/** 256 bits aleatorios; so o hash vai para o banco. */
export function newRefreshToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url')
  return { token, hash: hashToken(token) }
}
