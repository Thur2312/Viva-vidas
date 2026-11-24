import { Injectable } from '@nestjs/common'
import { createHmac, randomBytes, timingSafeEqual } from 'crypto'
import { SecretsService } from '../pilot/config/secrets.service'

const SCOPES = ['https://www.googleapis.com/auth/calendar.events', 'https://www.googleapis.com/auth/calendar.freebusy']
const STATE_TTL_MS = 10 * 60_000
const env = (k: string) => (process.env[k] ?? '').trim()

export type OAuthStart = { ok: true; url: string; redirectUri: string } | { ok: false; error: 'faltam_credenciais' | 'sem_url_publica'; missing: string[] }
export type OAuthResult = { ok: true } | { ok: false; error: 'estado_invalido' | 'negado' | 'sem_refresh_token' | 'troca_falhou' | 'faltam_credenciais' }

/**
 * Conecta a Google Agenda pelo painel (OAuth 2.0, fluxo de servidor web). O dono clica, autoriza no Google e volta;
 * o refresh token é guardado criptografado (SecretsService) como GOOGLE_REFRESH_TOKEN. Nada do token vai ao navegador.
 * `state` é assinado (HMAC com SECRETKEY), expira em 10 min e vale uma vez: sem ele o retorno é recusado.
 */
@Injectable()
export class GoogleOAuthService {
  private readonly used = new Map<string, number>()

  constructor(private readonly secrets: SecretsService) {}

  private signingKey(): string {
    return env('SECRETKEY') || env('PILOT_API_KEY')
  }

  /** Endereço público da API (sem barra final). */
  publicBase(): string {
    return (env('API_PUBLIC_URL') || env('VOICE_WEBHOOK_BASE_URL')).replace(/\/+$/, '')
  }

  redirectUri(): string {
    return `${this.publicBase()}/pilot/calendar/oauth/callback`
  }

  panelUrl(): string {
    const u = (env('PANEL_PUBLIC_URL') || env('FRONTEND_URL')).replace(/\/+$/, '')
    return /^https?:\/\//.test(u) ? u : ''
  }

  private sign(payload: string): string {
    return createHmac('sha256', this.signingKey()).update(payload).digest('base64url')
  }

  makeState(now = Date.now()): string {
    const payload = `${now}.${randomBytes(12).toString('base64url')}`
    return `${payload}.${this.sign(payload)}`
  }

  /** Confere assinatura, validade e uso único. */
  checkState(state: unknown, now = Date.now()): boolean {
    if (typeof state !== 'string' || !this.signingKey()) return false
    const parts = state.split('.')
    if (parts.length !== 3) return false
    const [ts, nonce, sig] = parts
    const expected = this.sign(`${ts}.${nonce}`)
    const a = Buffer.from(sig)
    const b = Buffer.from(expected)
    if (a.length !== b.length || !timingSafeEqual(a, b)) return false
    const age = now - Number(ts)
    if (!Number.isFinite(age) || age < 0 || age > STATE_TTL_MS) return false
    for (const [k, t] of this.used) if (now - t > STATE_TTL_MS) this.used.delete(k)
    if (this.used.has(nonce)) return false
    this.used.set(nonce, now)
    return true
  }

  start(): OAuthStart {
    const missing = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'].filter((k) => !env(k))
    if (missing.length) return { ok: false, error: 'faltam_credenciais', missing }
    if (!/^https:\/\//.test(this.publicBase())) return { ok: false, error: 'sem_url_publica', missing: ['API_PUBLIC_URL'] }
    const q = new URLSearchParams({
      client_id: env('GOOGLE_CLIENT_ID'),
      redirect_uri: this.redirectUri(),
      response_type: 'code',
      scope: SCOPES.join(' '),
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
      state: this.makeState(),
    })
    return { ok: true, url: `https://accounts.google.com/o/oauth2/v2/auth?${q}`, redirectUri: this.redirectUri() }
  }

  /** Troca o código por tokens e guarda o refresh token. Nunca lança nem registra o código ou os tokens. */
  async finish(code: unknown, state: unknown, error?: unknown, fetchImpl: typeof fetch = fetch): Promise<OAuthResult> {
    if (!this.checkState(state)) return { ok: false, error: 'estado_invalido' }
    if (typeof error === 'string' && error) return { ok: false, error: 'negado' }
    if (typeof code !== 'string' || !code || code.length > 2048) return { ok: false, error: 'estado_invalido' }
    if (!env('GOOGLE_CLIENT_ID') || !env('GOOGLE_CLIENT_SECRET')) return { ok: false, error: 'faltam_credenciais' }
    try {
      const res = await fetchImpl('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: env('GOOGLE_CLIENT_ID'),
          client_secret: env('GOOGLE_CLIENT_SECRET'),
          redirect_uri: this.redirectUri(),
          grant_type: 'authorization_code',
        }),
        signal: AbortSignal.timeout(15_000),
      })
      if (!res.ok) return { ok: false, error: 'troca_falhou' }
      const j: any = await res.json().catch(() => null)
      const refresh = j?.refresh_token
      if (typeof refresh !== 'string' || !refresh) return { ok: false, error: 'sem_refresh_token' }
      await this.secrets.set('GOOGLE_REFRESH_TOKEN', refresh, { actor: 'google-oauth' })
      return { ok: true }
    } catch {
      return { ok: false, error: 'troca_falhou' }
    }
  }
}
