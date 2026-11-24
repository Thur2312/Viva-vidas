import { CalendarAdapter, DisabledCalendar } from './calendar.types'
import { calendarEnabled } from './calendar.rules'
import { GoogleCalendarAdapter } from './google-calendar.adapter'
import { CrmAdapter, DisabledCrm } from '../crm/crm.types'
import { crmEnabled } from '../crm/crm.rules'
import { PipedriveAdapter } from '../crm/pipedrive.adapter'

/**
 * Escolhem o adaptador NO MOMENTO do uso, não no boot: ligar CALENDAR_PROVIDER / CRM_PROVIDER ou cadastrar as chaves
 * pelo painel passa a valer sem reiniciar a API.
 */
export class DynamicCalendar implements CalendarAdapter {
  private readonly google = new GoogleCalendarAdapter()
  private readonly off = new DisabledCalendar()
  private get cur(): CalendarAdapter { return calendarEnabled() ? this.google : this.off }
  get id() { return this.cur.id }
  status() { return this.cur.status() }
  busy(from: Date, to: Date, timezone: string) { return this.cur.busy(from, to, timezone) }
  createEvent(e: Parameters<CalendarAdapter['createEvent']>[0]) { return this.cur.createEvent(e) }
  deleteEvent(eventId: string) { return this.cur.deleteEvent(eventId) }
}

export class DynamicCrm implements CrmAdapter {
  private readonly pipedrive = new PipedriveAdapter()
  private readonly off = new DisabledCrm()
  private get cur(): CrmAdapter { return crmEnabled() ? this.pipedrive : this.off }
  get id() { return this.cur.id }
  status() { return this.cur.status() }
  findPersonByPhone(phone: string) { return this.cur.findPersonByPhone(phone) }
  createPerson(p: { name: string | null; phone: string }) { return this.cur.createPerson(p) }
  findOpenDeal(personId: number) { return this.cur.findOpenDeal(personId) }
  createDeal(personId: number, d: Parameters<CrmAdapter['createDeal']>[1]) { return this.cur.createDeal(personId, d) }
  updateDeal(dealId: number, d: Parameters<CrmAdapter['updateDeal']>[1]) { return this.cur.updateDeal(dealId, d) }
  addNote(dealId: number, text: string) { return this.cur.addNote(dealId, text) }
  deletePerson(personId: number) { return this.cur.deletePerson(personId) }
}
