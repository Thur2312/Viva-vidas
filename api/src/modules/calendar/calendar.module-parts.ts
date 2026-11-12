import { CalendarController } from './calendar.controller'
import { calendarEnabled } from './calendar.rules'
import { CalendarService } from './calendar.service'
import { CALENDAR_ADAPTER, DisabledCalendar } from './calendar.types'
import { GoogleCalendarAdapter } from './google-calendar.adapter'

export { CalendarController }
/** Providers da agenda, registrados em PilotModule (precisam de PgService, PilotService, AuditService e AdvisoryLockService). */
export const CALENDAR_PROVIDERS = [
  CalendarService,
  { provide: CALENDAR_ADAPTER, useFactory: () => (calendarEnabled() ? new GoogleCalendarAdapter() : new DisabledCalendar()) },
]
