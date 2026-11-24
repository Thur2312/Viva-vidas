import { GoogleOAuthService } from './google-oauth.service'
import { DynamicCalendar, DynamicCrm } from './dynamic-adapters'
import { SECRET_DEFS, checkValue } from '../pilot/config/secrets.service'

const KEYS = ['SECRETKEY', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'API_PUBLIC_URL', 'VOICE_WEBHOOK_BASE_URL', 'PANEL_PUBLIC_URL', 'FRONTEND_URL', 'CALENDAR_PROVIDER', 'CRM_PROVIDER', 'PIPEDRIVE_DOMAIN', 'PIPEDRIVE_API_TOKEN']
const saved: Record<string, string | undefined> = {}
beforeEach(() => { for (const k of KEYS) { saved[k] = process.env[k]; delete process.env[k] } process.env.SECRETKEY = 'k'.repeat(40) })
afterEach(() => { for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] } })

const fakeSecrets = () => { const set = jest.fn(async () => []); return { set } as any }
const def = (n: string) => SECRET_DEFS.find((d) => d.name === n)!

describe('Google OAuth (agenda)', () => {
  it('sem credenciais ou sem URL pública não inicia', () => {
    const s = new GoogleOAuthService(fakeSecrets())
    expect(s.start()).toEqual({ ok: false, error: 'faltam_credenciais', missing: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'] })
    process.env.GOOGLE_CLIENT_ID = 'id'; process.env.GOOGLE_CLIENT_SECRET = 'seg'
    expect(s.start()).toMatchObject({ ok: false, error: 'sem_url_publica' })
    process.env.API_PUBLIC_URL = 'http://inseguro.exemplo'
    expect(s.start()).toMatchObject({ ok: false, error: 'sem_url_publica' })
  })

  it('monta a URL do Google com escopos, offline, consent, retorno e state', () => {
    process.env.GOOGLE_CLIENT_ID = 'meu-id'; process.env.GOOGLE_CLIENT_SECRET = 'seg'; process.env.API_PUBLIC_URL = 'https://api.exemplo.io/'
    const r = new GoogleOAuthService(fakeSecrets()).start() as any
    expect(r.ok).toBe(true)
    expect(r.redirectUri).toBe('https://api.exemplo.io/pilot/calendar/oauth/callback')
    const u = new URL(r.url)
    expect(u.origin + u.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(u.searchParams.get('access_type')).toBe('offline')
    expect(u.searchParams.get('prompt')).toBe('consent')
    expect(u.searchParams.get('scope')).toContain('calendar.events')
    expect(u.searchParams.get('scope')).toContain('calendar.freebusy')
    expect(u.searchParams.get('redirect_uri')).toBe(r.redirectUri)
    expect(u.searchParams.get('state')).toBeTruthy()
    expect(r.url).not.toContain('seg')
  })

  it('state: assinado, uso único, expira e recusa adulteração', () => {
    const s = new GoogleOAuthService(fakeSecrets())
    const t0 = 1_000_000
    const st = s.makeState(t0)
    expect(s.checkState(st, t0 + 1000)).toBe(true)
    expect(s.checkState(st, t0 + 2000)).toBe(false) // já usado
    expect(s.checkState(s.makeState(t0), t0 + 11 * 60_000)).toBe(false) // expirado
    const outro = s.makeState(t0)
    expect(s.checkState(outro.slice(0, -2) + 'xx', t0)).toBe(false)
    expect(s.checkState('lixo', t0)).toBe(false)
    expect(s.checkState(undefined, t0)).toBe(false)
    expect(new GoogleOAuthService(fakeSecrets()).checkState(st, t0)).toBe(true) // outra instância, mesma chave
    const antes = s.makeState(t0)
    process.env.SECRETKEY = 'z'.repeat(40)
    expect(new GoogleOAuthService(fakeSecrets()).checkState(antes, t0)).toBe(false) // chave trocada depois de assinar
  })

  it('guarda o refresh token (criptografado pelo SecretsService) e não devolve nada sensível', async () => {
    process.env.GOOGLE_CLIENT_ID = 'id'; process.env.GOOGLE_CLIENT_SECRET = 'seg'; process.env.API_PUBLIC_URL = 'https://api.exemplo.io'
    const secrets = fakeSecrets()
    const s = new GoogleOAuthService(secrets)
    const f = jest.fn(async () => ({ ok: true, json: async () => ({ access_token: 'a', refresh_token: '1//refresh-token-longo' }) })) as any
    const r = await s.finish('codigo', s.makeState(), undefined, f)
    expect(r).toEqual({ ok: true })
    expect(secrets.set).toHaveBeenCalledWith('GOOGLE_REFRESH_TOKEN', '1//refresh-token-longo', { actor: 'google-oauth' })
    const [url, init] = f.mock.calls[0]
    expect(url).toBe('https://oauth2.googleapis.com/token')
    expect(init.body.get('grant_type')).toBe('authorization_code')
    expect(init.body.get('redirect_uri')).toBe('https://api.exemplo.io/pilot/calendar/oauth/callback')
  })

  it('recusa state inválido, negado, sem refresh token e falha do Google', async () => {
    process.env.GOOGLE_CLIENT_ID = 'id'; process.env.GOOGLE_CLIENT_SECRET = 'seg'
    const secrets = fakeSecrets()
    const s = new GoogleOAuthService(secrets)
    expect(await s.finish('c', 'invalido')).toEqual({ ok: false, error: 'estado_invalido' })
    expect(await s.finish('c', s.makeState(), 'access_denied')).toEqual({ ok: false, error: 'negado' })
    const semRefresh = jest.fn(async () => ({ ok: true, json: async () => ({ access_token: 'a' }) })) as any
    expect(await s.finish('c', s.makeState(), undefined, semRefresh)).toEqual({ ok: false, error: 'sem_refresh_token' })
    const erro = jest.fn(async () => ({ ok: false, status: 400 })) as any
    expect(await s.finish('c', s.makeState(), undefined, erro)).toEqual({ ok: false, error: 'troca_falhou' })
    expect(secrets.set).not.toHaveBeenCalled()
  })
})

describe('adaptadores dinâmicos', () => {
  it('a agenda e o CRM ligam e desligam em tempo de uso, sem reiniciar', () => {
    const cal = new DynamicCalendar()
    expect(cal.id).toBe('disabled')
    process.env.CALENDAR_PROVIDER = 'google'
    expect(cal.id).toBe('google')
    expect(cal.status().missing).toContain('GOOGLE_CLIENT_ID')

    const crm = new DynamicCrm()
    expect(crm.id).toBe('disabled')
    process.env.CRM_PROVIDER = 'pipedrive'
    expect(crm.id).toBe('pipedrive')
    expect(crm.status().missing).toEqual(['PIPEDRIVE_DOMAIN', 'PIPEDRIVE_API_TOKEN'])
    process.env.PIPEDRIVE_DOMAIN = 'alberto'; process.env.PIPEDRIVE_API_TOKEN = 't'
    expect(crm.status().configured).toBe(true)
  })
})

describe('campos de CRM e agenda', () => {
  it('valida subdomínio, mapa de etapas e provedores', () => {
    expect(checkValue(def('PIPEDRIVE_DOMAIN'), 'alberto')).toBe('alberto')
    expect(() => checkValue(def('PIPEDRIVE_DOMAIN'), 'alberto.pipedrive.com')).toThrow('subdomínio')
    expect(checkValue(def('PIPEDRIVE_STAGE_MAP'), ' {"qualificado": 12, "reuniao_marcada": 13} ')).toBe('{"qualificado":12,"reuniao_marcada":13}')
    expect(() => checkValue(def('PIPEDRIVE_STAGE_MAP'), '{"qualificado":"x"}')).toThrow('inteiro')
    expect(() => checkValue(def('PIPEDRIVE_STAGE_MAP'), 'nao é json')).toThrow('JSON')
    expect(checkValue(def('CRM_PROVIDER'), 'Pipedrive')).toBe('pipedrive')
    expect(checkValue(def('CALENDAR_PROVIDER'), 'google')).toBe('google')
    expect(checkValue(def('API_PUBLIC_URL'), 'https://api.exemplo.io/')).toBe('https://api.exemplo.io')
    expect(() => checkValue(def('API_PUBLIC_URL'), 'http://api.exemplo.io')).toThrow('Endereço inválido')
    expect(checkValue(def('GOOGLE_CLIENT_SECRET'), 'GOCSPX-abcdef123456')).toBe('GOCSPX-abcdef123456')
  })
})
