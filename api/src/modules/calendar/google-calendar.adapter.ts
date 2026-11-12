import { Interval } from './calendar.rules'
import { CalendarAdapter, CalendarApiError, CalendarStatus } from './calendar.types'

const TIMEOUT_MS = 15_000
/** Id de agenda: e-mail ou "primary". Sem barras nem espacos: o valor entra no caminho da URL. */
const CAL_ID_RE = /^[A-Za-z0-9._%+@-]{1,200}$/

/**
 * Google Calendar API v3 por fetch (sem SDK). Autorizacao OAuth2 com refresh token guardado em env (ver docs).
 * Escopo necessario: https://www.googleapis.com/auth/calendar.events e calendar.freebusy.
 * ATENCAO: ainda NAO foi exercitado contra o Google real (sem conta no ambiente de desenvolvimento); so contra o
 * contrato documentado, com fetch simulado nos testes. Confirme na primeira execucao com a conta do Alberto.
 */
export class GoogleCalendarAdapter implements CalendarAdapter {
  readonly id = 'google'
  private token: { value: string; exp: number } | null = null

  private get calendarId() { return (process.env.GOOGLE_CALENDAR_ID || 'primary').trim() }

  status(): CalendarStatus {
    const missing = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN'].filter((k) => !process.env[k])
    if (!CAL_ID_RE.test(this.calendarId)) missing.push('GOOGLE_CALENDAR_ID')
    return { provider: this.id, configured: missing.length === 0, missing }
  }

  private async fetchJson(url: string, init: RequestInit, what: string): Promise<any> {
    let res: Response
    try {
      res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) })
    } catch {
      throw new CalendarApiError(0, what)
    }
    if (!res.ok) throw new CalendarApiError(res.status, what)
    if (res.status === 204) return null
    return res.json().catch(() => { throw new CalendarApiError(502, `${what} resposta_invalida`) })
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.exp > Date.now() + 60_000) return this.token.value
    if (!this.status().configured) throw new CalendarApiError(0, 'nao_configurado')
    const j = await this.fetchJson('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID!, client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        refresh_token: process.env.GOOGLE_REFRESH_TOKEN!, grant_type: 'refresh_token',
      }),
    }, 'oauth token')
    if (typeof j?.access_token !== 'string') throw new CalendarApiError(502, 'oauth sem token')
    this.token = { value: j.access_token, exp: Date.now() + Math.max(60, Number(j.expires_in) || 3000) * 1000 }
    return this.token.value
  }

  private async api(method: string, path: string, body: unknown, what: string) {
    const token = await this.accessToken()
    return this.fetchJson(`https://www.googleapis.com/calendar/v3${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    }, what)
  }

  async busy(from: Date, to: Date, timezone: string): Promise<Interval[]> {
    const id = this.calendarId
    const j = await this.api('POST', '/freeBusy', { timeMin: from.toISOString(), timeMax: to.toISOString(), timeZone: timezone, items: [{ id }] }, 'POST /freeBusy')
    const cal = j?.calendars?.[id]
    // Agenda inacessivel vem como 200 com `errors`: tratar como falha, nunca como "tudo livre".
    if (!cal || (Array.isArray(cal.errors) && cal.errors.length)) throw new CalendarApiError(502, 'freeBusy agenda_inacessivel')
    return (cal.busy ?? []).map((b: any) => ({ start: Date.parse(b.start), end: Date.parse(b.end) })).filter((b: Interval) => Number.isFinite(b.start) && Number.isFinite(b.end))
  }

  async createEvent(e: { start: Date; end: Date; timezone: string; summary: string; description: string }): Promise<string> {
    const j = await this.api('POST', `/calendars/${encodeURIComponent(this.calendarId)}/events?sendUpdates=none`, {
      summary: e.summary, description: e.description,
      start: { dateTime: e.start.toISOString(), timeZone: e.timezone }, end: { dateTime: e.end.toISOString(), timeZone: e.timezone },
    }, 'POST /events')
    if (typeof j?.id !== 'string') throw new CalendarApiError(502, 'evento sem id')
    return j.id
  }

  async deleteEvent(eventId: string): Promise<void> {
    try {
      await this.api('DELETE', `/calendars/${encodeURIComponent(this.calendarId)}/events/${encodeURIComponent(eventId)}?sendUpdates=none`, undefined, 'DELETE /events')
    } catch (err) {
      if (err instanceof CalendarApiError && (err.status === 404 || err.status === 410)) return // ja nao existe: objetivo cumprido
      throw err
    }
  }
}
