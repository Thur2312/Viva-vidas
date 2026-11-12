import { BadGatewayException, ConflictException, NotFoundException, ServiceUnavailableException } from '@nestjs/common'
import { CalendarService } from './calendar.service'
import { CalendarAdapter, CalendarApiError, CalendarNotConfiguredError, CalendarStatus } from './calendar.types'
import { Interval } from './calendar.rules'
import { subjectHooks } from '../pilot/compliance/subject-hooks'

const NOW = new Date('2026-11-12T13:00:00Z') // quinta 10:00 em Sao Paulo
const FREE = '2026-11-12T15:00:00.000Z' // 12:00 locais
const CTX = { actor: 'op-1' }

class FakeCal implements CalendarAdapter {
  readonly id = 'fake'
  busyList: Interval[] = []
  created: any[] = []
  deleted: string[] = []
  failBusy: unknown = null
  failCreate: unknown = null
  status(): CalendarStatus { return { provider: 'fake', configured: true, missing: [] } }
  async busy() { if (this.failBusy) throw this.failBusy; return this.busyList }
  async createEvent(e: any) { if (this.failCreate) throw this.failCreate; this.created.push(e); return `evt${this.created.length}` }
  async deleteEvent(id: string) { this.deleted.push(id) }
}

function setup(over: { lead?: any; hasMeeting?: boolean; addEventFails?: boolean; lockRan?: boolean } = {}) {
  const lead = over.lead === undefined ? { id: 'L1', name: 'Maria Souza', phone: '5583999991234', opt_out: false, anonymized_at: null } : over.lead
  const pg = { query: jest.fn(async (sql: string) => (/FROM horizon_agent.leads/.test(sql) ? { rows: lead ? [lead] : [] } : { rows: [], rowCount: over.hasMeeting ? 1 : 0 })) }
  void over
  const pilot = { tenant: 'alberto', addEvent: jest.fn(async () => { if (over.addEventFails) throw new Error('banco caiu'); return { duplicated: false } }) }
  const audit = { log: jest.fn() }
  const lock = { withLock: jest.fn(async (_k: number, fn: () => any) => (over.lockRan === false ? { ran: false } : { ran: true, result: await fn() })) }
  const cal = new FakeCal()
  return { svc: new CalendarService(pg as any, pilot as any, audit as any, lock as any, cal), pg, pilot, audit, lock, cal }
}

describe('CalendarService', () => {
  const env = { ...process.env }
  beforeEach(() => { delete process.env.CALENDAR_RULES })
  afterAll(() => { process.env = env })

  it('slots devolve horarios livres no fuso das regras', async () => {
    const { svc, cal } = setup()
    cal.busyList = [{ start: Date.parse(FREE), end: Date.parse(FREE) + 1_800_000 }]
    const r = await svc.slots(5, NOW)
    expect(r).toMatchObject({ timezone: 'America/Sao_Paulo', durationMin: 30 })
    expect(r.slots.map((s) => s.start)).not.toContain(FREE)
    expect(r.slots).toHaveLength(5)
  })

  it('agendar cria o evento (so nome e telefone), registra reuniao_marcada e audita', async () => {
    const { svc, cal, pilot, audit } = setup()
    const r = await svc.book('L1', FREE, CTX, NOW)
    expect(r).toEqual({ start: FREE, end: '2026-11-12T15:30:00.000Z', eventId: 'evt1' })
    expect(cal.created[0].summary).toBe('Reunião · Maria')
    expect(cal.created[0].description).toMatch(/5583999991234/)
    expect(pilot.addEvent).toHaveBeenCalledWith('L1', 'reuniao_marcada', { actor: 'humano', payload: { calendarEventId: 'evt1', start: FREE } })
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'calendar.book', entityId: 'L1' }))
  })

  it('horario ocupado, desalinhado, no fim de semana ou inventado: 409, nada criado', async () => {
    const { svc, cal } = setup()
    cal.busyList = [{ start: Date.parse(FREE), end: Date.parse(FREE) + 1_800_000 }]
    for (const t of [FREE, '2026-11-12T15:10:00.000Z', '2026-11-14T15:00:00.000Z', 'lixo'])
      await expect(svc.book('L1', t, CTX, NOW)).rejects.toBeInstanceOf(ConflictException)
    expect(cal.created).toHaveLength(0)
  })

  it('lead inexistente: 404; opt-out ou anonimizado: 409; ja tem reuniao: 409', async () => {
    await expect(setup({ lead: null }).svc.book('L1', FREE, CTX, NOW)).rejects.toBeInstanceOf(NotFoundException)
    await expect(setup({ lead: { id: 'L1', name: 'A', phone: '1', opt_out: true, anonymized_at: null } }).svc.book('L1', FREE, CTX, NOW)).rejects.toBeInstanceOf(ConflictException)
    await expect(setup({ lead: { id: 'L1', name: 'A', phone: '1', opt_out: false, anonymized_at: new Date() } }).svc.book('L1', FREE, CTX, NOW)).rejects.toBeInstanceOf(ConflictException)
    const s = setup({ hasMeeting: true })
    await expect(s.svc.book('L1', FREE, CTX, NOW)).rejects.toBeInstanceOf(ConflictException)
    expect(s.cal.created).toHaveLength(0)
  })

  it('se registrar no funil falhar depois de criar o evento, o evento e desfeito (sem reuniao fantasma)', async () => {
    const { svc, cal } = setup({ addEventFails: true })
    await expect(svc.book('L1', FREE, CTX, NOW)).rejects.toThrow('banco caiu')
    expect(cal.deleted).toEqual(['evt1'])
  })

  it('outro agendamento em andamento (trava ocupada): 409 sem consultar a agenda', async () => {
    const { svc, cal } = setup({ lockRan: false })
    await expect(svc.book('L1', FREE, CTX, NOW)).rejects.toBeInstanceOf(ConflictException)
    expect(cal.created).toHaveLength(0)
  })

  it('agenda fora do ar vira 502 e nao configurada vira 503, sem expor detalhe', async () => {
    const a = setup(); a.cal.failBusy = new CalendarApiError(500)
    await expect(a.svc.slots(5, NOW)).rejects.toBeInstanceOf(BadGatewayException)
    const b = setup(); b.cal.failBusy = new CalendarNotConfiguredError(['X'])
    await expect(b.svc.slots(5, NOW)).rejects.toBeInstanceOf(ServiceUnavailableException)
    const c = setup(); c.cal.failCreate = new CalendarApiError(403)
    await expect(c.svc.book('L1', FREE, CTX, NOW)).rejects.toBeInstanceOf(BadGatewayException)
    expect(c.pilot.addEvent).not.toHaveBeenCalled()
  })

  it('regras vem de CALENDAR_RULES (ex.: reuniao de 60 min)', async () => {
    process.env.CALENDAR_RULES = '{"durationMin":60}'
    const { svc } = setup()
    expect((await svc.slots(1, NOW)).durationMin).toBe(60)
    expect(svc.status().rules.durationMin).toBe(60)
  })

  describe('direito de exclusao e anonimizacao (LGPD)', () => {
    const hooks = (ids: (string | null)[], cal: FakeCal) => {
      const db: any = { query: jest.fn(async () => ({ rows: ids.map((id) => ({ id })) })) }
      const svc = new CalendarService({} as any, { tenant: 'alberto' } as any, {} as any, {} as any, cal)
      svc.onModuleInit()
      return { h: subjectHooks().find((x) => x.name === 'calendar')!, db }
    }
    it('apaga da agenda os eventos criados para o lead, na exclusao e na anonimizacao', async () => {
      const cal = new FakeCal(); const { h, db } = hooks(['e1', 'e2', null], cal)
      expect(await h.eraseLead!('L1', { actor: 'x' }, db)).toEqual({ agenda_eventos: 2 })
      expect(await h.anonymizeLead!('L1', { actor: 'x' }, db)).toEqual({ agenda_eventos: 2 })
      expect(cal.deleted).toEqual(['e1', 'e2', 'e1', 'e2'])
    })
    it('lead que nunca foi agendado nao chama a agenda', async () => {
      const cal = new FakeCal(); const { h, db } = hooks([], cal)
      expect(await h.eraseLead!('L1', { actor: 'x' }, db)).toEqual({ agenda_eventos: 0 })
      expect(cal.deleted).toEqual([])
    })
    it('se nao conseguir apagar, falha alto (o pedido do titular nao e dado como concluido)', async () => {
      const cal = new FakeCal(); cal.deleteEvent = async () => { throw new CalendarApiError(500) }
      const { h, db } = hooks(['e1'], cal)
      await expect(h.eraseLead!('L1', { actor: 'x' }, db)).rejects.toBeInstanceOf(CalendarApiError)
    })
  })
})
