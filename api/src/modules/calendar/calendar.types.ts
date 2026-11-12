import { Interval } from './calendar.rules'

export interface CalendarStatus { provider: string; configured: boolean; missing: string[] }

/** Erro da API da agenda. `status` 0 = rede/timeout. Nunca carrega o corpo da resposta (pode ter dado pessoal). */
export class CalendarApiError extends Error {
  constructor(public readonly status: number, what = 'agenda') {
    super(`${what}: HTTP ${status}`)
  }
}

export class CalendarNotConfiguredError extends Error {
  constructor(public readonly missing: string[]) {
    super(`Agenda nao configurada: falta ${missing.join(', ')}`)
  }
}

export interface CalendarAdapter {
  readonly id: string
  status(): CalendarStatus
  busy(from: Date, to: Date, timezone: string): Promise<Interval[]>
  createEvent(e: { start: Date; end: Date; timezone: string; summary: string; description: string }): Promise<string>
  deleteEvent(eventId: string): Promise<void>
}

export const CALENDAR_ADAPTER = Symbol('CALENDAR_ADAPTER')

export class DisabledCalendar implements CalendarAdapter {
  readonly id = 'disabled'
  constructor(private readonly missing: string[] = ['CALENDAR_PROVIDER (use "google")']) {}
  status(): CalendarStatus { return { provider: this.id, configured: false, missing: this.missing } }
  private no(): never { throw new CalendarNotConfiguredError(this.missing) }
  async busy(): Promise<Interval[]> { return this.no() }
  async createEvent(): Promise<string> { return this.no() }
  async deleteEvent(): Promise<void> { return this.no() }
}
