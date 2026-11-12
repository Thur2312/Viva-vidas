import { corsOriginCheck, parseCorsOrigins, safePath, scrub, validateEnv } from './hardening'
import { buildTenantBaseUrl } from 'src/shared/util/tenant-url.utils'
import { buildPublicUrl, getStorageConfig } from 'src/modules/files/config/storage.config'

describe('validateEnv', () => {
  const prod = (k?: string, extra: any = {}) => validateEnv({ NODE_ENV: 'production', SECRETKEY: k, ...extra } as any)
  it('producao recusa ausente, curta e placeholder', () => {
    expect(prod(undefined)).not.toEqual([])
    expect(prod('curta')).not.toEqual([])
    expect(prod('changeme-' + 'a'.repeat(40))).not.toEqual([])
    expect(prod('secret' + 'k'.repeat(40))).not.toEqual([])
    expect(prod('a'.repeat(40))).not.toEqual([])
  })
  it('producao aceita segredo forte; dev so exige presenca', () => {
    expect(prod('q8Zr!v3Lm0Xc9Tn2Bw7Ye5Ug1Hd4Pf6Ja')).toEqual([])
    expect(validateEnv({ SECRETKEY: 'curta' } as any)).toEqual([])
    expect(validateEnv({} as any)).not.toEqual([])
  })
  it('recusa CORS * em producao', () => {
    expect(prod('q8Zr!v3Lm0Xc9Tn2Bw7Ye5Ug1Hd4Pf6Ja', { CORS_ORIGINS: '*' })).not.toEqual([])
  })
})

describe('logging e CORS', () => {
  it('scrub mascara telefone, bearer e jwt', () => {
    const s = scrub('falha 5583999991234 / +55 (83) 99999-1234 Bearer abc.def.ghi eyJhbGciOi.eyJzdWIi.sig')
    expect(scrub('erro postgres://usr:pw@host/db')).not.toMatch(/usr|pw/)
    expect(s).not.toMatch(/999991234|99999-1234|abc\.def|eyJ/)
  })
  it('safePath remove query, telefone e tokens longos', () => {
    expect(safePath('/pilot/leads?token=SEGREDO&phone=5583999991234')).toBe('/pilot/leads')
    expect(safePath('/x/5583999991234/y')).toBe('/x/:redacted/y')
    expect(safePath('/auth/' + 'a'.repeat(40))).toBe('/auth/:redacted')
    expect(safePath('/pilot/leads/0b9d6c1e-1111-4222-8333-444455556666')).toContain('0b9d6c1e')
  })
  it('CORS nega por padrao e exige origem exata', () => {
    const check = (allowed: string[], o?: string) => {
      let r: boolean | undefined
      corsOriginCheck(allowed)(o, (_e, a) => (r = a))
      return r
    }
    expect(parseCorsOrigins(undefined)).toEqual([])
    expect(parseCorsOrigins('*, http://a.com/ ')).toEqual(['http://a.com'])
    expect(check([], 'http://localhost:3000')).toBe(false)
    expect(check(['http://localhost:3000'], 'http://evil-localhost.com')).toBe(false)
    expect(check(['http://localhost:3000'], 'http://localhost:3000')).toBe(true)
  })
})

describe('defaults HDM neutralizados', () => {
  const saved = { ...process.env }
  afterEach(() => { process.env = { ...saved } })
  it('sem TENANT_BASE_DOMAIN usa o fallback', () => {
    delete process.env.TENANT_BASE_DOMAIN
    expect(buildTenantBaseUrl('acme', 'https://app.test')).toBe('https://app.test')
    process.env.TENANT_BASE_DOMAIN = 'exemplo.com'
    expect(buildTenantBaseUrl('acme', 'https://app.test')).toBe('https://acme.exemplo.com')
  })
  it('storage sem bucket/endpoint embutidos', () => {
    delete process.env.MINIO_BUCKET_NAME
    delete process.env.MINIO_PUBLIC_ENDPOINT
    const c = getStorageConfig()
    expect(c.bucket).toBe('')
    expect(c.endpoint).toBe('')
    expect(buildPublicUrl(c, 'k')).not.toMatch(/hdm/)
  })
})
