import { CalendarController } from './calendar.controller'
import { CalendarService } from './calendar.service'
import { CALENDAR_ADAPTER } from './calendar.types'
import { DynamicCalendar } from './dynamic-adapters'
import { GoogleOAuthController } from './google-oauth.controller'
import { GoogleOAuthService } from './google-oauth.service'

export { CalendarController, GoogleOAuthController }
/** Providers da agenda, registrados em PilotModule (precisam de PgService, PilotService, AuditService e AdvisoryLockService). */
export const CALENDAR_PROVIDERS = [
  CalendarService,
  GoogleOAuthService,
  { provide: CALENDAR_ADAPTER, useFactory: () => new DynamicCalendar() },
]
