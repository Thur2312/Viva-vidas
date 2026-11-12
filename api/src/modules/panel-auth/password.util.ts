import { randomBytes, scrypt, timingSafeEqual, ScryptOptions } from 'crypto'

// scrypt (node:crypto), sem dependencia extra. Os parametros vao dentro do hash, entao da para subir o custo depois.
const N = 32768
const R = 8
const P = 1
const KEYLEN = 64

function scryptAsync(password: string, salt: Buffer, keylen: number, opts: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password.normalize('NFKC'), salt, keylen, opts, (err, key) => (err ? reject(err) : resolve(key))),
  )
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const key = await scryptAsync(password, salt, KEYLEN, { N, r: R, p: P, maxmem: 128 * N * R * 2 })
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`
}

/** Comparacao em tempo constante. Formato invalido => false (nunca lanca). */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    const [alg, n, r, p, saltB64, hashB64] = String(stored).split('$')
    if (alg !== 'scrypt' || !hashB64) return false
    const expected = Buffer.from(hashB64, 'base64')
    const n_ = Number(n)
    const r_ = Number(r)
    const p_ = Number(p)
    if (!Number.isInteger(n_) || n_ < 2 || n_ > 1 << 20 || !Number.isInteger(r_) || r_ < 1 || r_ > 32 || !Number.isInteger(p_) || p_ < 1 || p_ > 16) return false
    const got = await scryptAsync(password, Buffer.from(saltB64, 'base64'), expected.length, {
      N: n_,
      r: r_,
      p: p_,
      maxmem: 128 * n_ * r_ * 2,
    })
    return got.length === expected.length && timingSafeEqual(got, expected)
  } catch {
    return false
  }
}

const COMMON = ['password', 'senha', '123456', 'qwerty', 'letmein', 'admin', 'horizon', 'changeme', 'welcome', 'abc123']

/** Retorna lista de problemas (vazia = senha aceita). Minimo 12 chars, 3 de 4 classes. */
export function passwordProblems(password: string, email?: string): string[] {
  if (typeof password !== 'string') return ['senha invalida']
  const problems: string[] = []
  if (password.length < 12) problems.push('minimo de 12 caracteres')
  if (password.length > 128) problems.push('maximo de 128 caracteres')
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((re) => re.test(password)).length
  if (classes < 3) problems.push('use ao menos 3 tipos: minuscula, maiuscula, numero, simbolo')
  if (/^(.)\1+$/.test(password)) problems.push('nao pode repetir um unico caractere')
  const low = password.toLowerCase()
  if (COMMON.some((c) => low.includes(c))) problems.push('contem palavra comum')
  const local = (email ?? '').split('@')[0].toLowerCase()
  if (local.length >= 4 && low.includes(local)) problems.push('nao pode conter o e-mail')
  return problems
}
