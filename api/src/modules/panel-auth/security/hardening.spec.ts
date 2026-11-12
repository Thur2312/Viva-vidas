import { BadGatewayException, HttpException, InternalServerErrorException, ServiceUnavailableException } from '@nestjs/common'
import { SafeExceptionFilter, bffClientIp, corsOriginCheck, parseCorsOrigins, safePath, scrub, validateEnv } from './hardening'
import { buildTenantBaseUrl } from 'src/shared/util/tenant-url.utils'
import { buildPublicUrl, getStorageConfig } from 'src/modules/files/config/storage.config'

describe('validateEnv', () => {
  const prod = (k?: string, extra: any = {}) => validateEnv({ NODE_ENV: 'production', PILOT_ONLY: 'true', SECRETKEY: k, ...extra } as any)
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
  it('producao exige PILOT_ONLY ou TENANT_GUARD_ENFORCE e recusa o kill-switch de assinatura', () => {
    const k = 'q8Zr!v3Lm0Xc9Tn2Bw7Ye5Ug1Hd4Pf6Ja'
    expect(validateEnv({ NODE_ENV: 'production', SECRETKEY: k } as any)).not.toEqual([])
    expect(validateEnv({ NODE_ENV: 'production', SECRETKEY: k, TENANT_GUARD_ENFORCE: 'true' } as any)).toEqual([])
    expect(prod(k, { WHATSAPP_META_WEBHOOK_SIGNATURE_DISABLED: 'true' })).not.toEqual([])
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

describe('bffClientIp', () => {
  const run = (headers: Record<string, string>, secret: string | undefined = 'chave-do-bff') => {
    const req: any = { headers, ip: '203.0.113.9' }
    bffClientIp(secret)(req, {} as any, () => undefined)
    return req.ip
  }
  it('aceita o IP do usuario so com a chave certa', () => {
    expect(run({ 'x-bff-key': 'chave-do-bff', 'x-bff-client-ip': '198.51.100.7' })).toBe('198.51.100.7')
    expect(run({ 'x-bff-key': 'errada', 'x-bff-client-ip': '198.51.100.7' })).toBe('203.0.113.9')
    expect(run({ 'x-bff-client-ip': '198.51.100.7' })).toBe('203.0.113.9')
  })
  it('ignora tudo sem a env e recusa valor que nao e IP', () => {
    expect(run({ 'x-bff-key': 'x', 'x-bff-client-ip': '198.51.100.7' }, undefined)).toBe('203.0.113.9')
    expect(run({ 'x-bff-key': 'chave-do-bff', 'x-bff-client-ip': "1.2.3.4'; DROP" })).toBe('203.0.113.9')
  })
})

describe('SafeExceptionFilter', () => {
  const run = (e: unknown) => {
    const out: { status?: number; body?: any } = {}
    const res: any = { headersSent: false, status(c: number) { out.status = c; return this }, json(b: any) { out.body = b } }
    const host: any = { switchToHttp: () => ({ getResponse: () => res, getRequest: () => ({ method: 'GET', originalUrl: '/x?token=SEGREDO', reqId: 'r1' }) }) }
    new SafeExceptionFilter().catch(e, host)
    return out
  }
  it('503/502 lancados de proposito levam o motivo ao painel (mensagem e codigo)', () => {
    const r = run(new ServiceUnavailableException('Agenda não configurada'))
    expect(r.status).toBe(503)
    expect(r.body).toMatchObject({ statusCode: 503, message: 'Agenda não configurada' })
    expect(run(new BadGatewayException('Agenda indisponível no momento')).body.message).toBe('Agenda indisponível no momento')
    expect(run(new ServiceUnavailableException({ code: 'provedor_nao_configurado', message: 'A telefonia ainda não está configurada.' })).body).toMatchObject({ code: 'provedor_nao_configurado' })
  })
  it('erro inesperado e 500 continuam genericos, sem vazar detalhe', () => {
    expect(run(new Error('connection to postgres://u:senha@host failed')).body).toEqual({ statusCode: 500, message: 'Internal server error' })
    expect(run(new InternalServerErrorException('segredo interno')).body).toEqual({ statusCode: 500, message: 'Internal server error' })
    expect(run(new HttpException('x', 504)).body).toEqual({ statusCode: 504, message: 'Internal server error' })
  })
  it('4xx passam como sempre', () => {
    expect(run(new HttpException('Acesso negado', 403))).toEqual({ status: 403, body: { statusCode: 403, message: 'Acesso negado' } })
  })
})
