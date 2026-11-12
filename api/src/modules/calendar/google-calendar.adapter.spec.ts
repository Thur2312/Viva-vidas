import { GoogleCalendarAdapter } from './google-calendar.adapter'
import { CalendarApiError } from './calendar.types'

const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body })

describe('GoogleCalendarAdapter (fetch simulado: NAO fala com o Google real)', () => {
  const env = { ...process.env }
  let calls: { url: string; init: any }[]
  const mock = (...responses: any[]) => {
    calls = []
    global.fetch = jest.fn(async (url: any, init: any) => { calls.push({ url: String(url), init }); return responses.shift() }) as any
  }
  const TOKEN = json({ access_token: 'at-123', expires_in: 3599 })
  beforeEach(() => {
    process.env.GOOGLE_CLIENT_ID = 'cid'; process.env.GOOGLE_CLIENT_SECRET = 'csecret'; process.env.GOOGLE_REFRESH_TOKEN = 'rtoken'
    process.env.GOOGLE_CALENDAR_ID = 'alberto@exemplo.com'
  })
  afterAll(() => { process.env = env })

  it('status lista o que falta e recusa id de agenda com caracteres perigosos', () => {
    delete process.env.GOOGLE_REFRESH_TOKEN
    expect(new GoogleCalendarAdapter().status()).toEqual({ provider: 'google', configured: false, missing: ['GOOGLE_REFRESH_TOKEN'] })
    process.env.GOOGLE_CALENDAR_ID = '../../x?y'
    expect(new GoogleCalendarAdapter().status().missing).toContain('GOOGLE_CALENDAR_ID')
  })

  it('troca o refresh token por access token, usa Bearer e reaproveita o token ate perto de expirar', async () => {
    mock(TOKEN, json({ calendars: { 'alberto@exemplo.com': { busy: [] } } }), json({ calendars: { 'alberto@exemplo.com': { busy: [] } } }))
    const a = new GoogleCalendarAdapter()
    await a.busy(new Date('2026-11-12T00:00:00Z'), new Date('2026-11-13T00:00:00Z'), 'America/Sao_Paulo')
    await a.busy(new Date('2026-11-12T00:00:00Z'), new Date('2026-11-13T00:00:00Z'), 'America/Sao_Paulo')
    expect(calls.filter((c) => c.url.includes('oauth2.googleapis.com'))).toHaveLength(1) // so uma troca
    expect(calls[0].init.body.toString()).toContain('grant_type=refresh_token')
    expect(calls[1].init.headers.authorization).toBe('Bearer at-123')
    expect(calls[1].url).not.toContain('at-123')
  })

  it('freeBusy devolve os intervalos ocupados', async () => {
    mock(TOKEN, json({ calendars: { 'alberto@exemplo.com': { busy: [{ start: '2026-11-12T15:00:00Z', end: '2026-11-12T16:00:00Z' }] } } }))
    const busy = await new GoogleCalendarAdapter().busy(new Date(), new Date(), 'America/Sao_Paulo')
    expect(busy).toEqual([{ start: Date.parse('2026-11-12T15:00:00Z'), end: Date.parse('2026-11-12T16:00:00Z') }])
  })

  it('agenda inacessivel (200 com errors) e falha, NUNCA "tudo livre"', async () => {
    mock(TOKEN, json({ calendars: { 'alberto@exemplo.com': { errors: [{ reason: 'notFound' }], busy: [] } } }))
    await expect(new GoogleCalendarAdapter().busy(new Date(), new Date(), 'America/Sao_Paulo')).rejects.toBeInstanceOf(CalendarApiError)
  })

  it('cria o evento no id da agenda codificado, sem avisar convidados, e devolve o id', async () => {
    mock(TOKEN, json({ id: 'evt1' }))
    const id = await new GoogleCalendarAdapter().createEvent({ start: new Date('2026-11-12T15:00:00Z'), end: new Date('2026-11-12T15:30:00Z'), timezone: 'America/Sao_Paulo', summary: 'Reunião · Maria', description: 'x' })
    expect(id).toBe('evt1')
    expect(calls[1].url).toBe('https://www.googleapis.com/calendar/v3/calendars/alberto%40exemplo.com/events?sendUpdates=none')
    expect(JSON.parse(calls[1].init.body)).toMatchObject({ summary: 'Reunião · Maria', start: { dateTime: '2026-11-12T15:00:00.000Z', timeZone: 'America/Sao_Paulo' } })
  })

  it('erros nao carregam o corpo da resposta, e rede fora vira status 0', async () => {
    mock(json({ error: { message: 'telefone 5583999991234' } }, 401))
    const e = await new GoogleCalendarAdapter().busy(new Date(), new Date(), 'x').catch((x) => x)
    expect(e).toBeInstanceOf(CalendarApiError)
    expect(e.status).toBe(401)
    expect(e.message).not.toMatch(/5583/)
    global.fetch = jest.fn(async () => { throw new Error('ECONNRESET') }) as any
    expect((await new GoogleCalendarAdapter().busy(new Date(), new Date(), 'x').catch((x) => x)).status).toBe(0)
  })

  it('apagar evento que ja nao existe (404/410) conta como feito; outros erros sobem', async () => {
    mock(TOKEN, json({}, 404), json({}, 410), json({}, 500))
    const a = new GoogleCalendarAdapter()
    await expect(a.deleteEvent('e1')).resolves.toBeUndefined()
    await expect(a.deleteEvent('e1')).resolves.toBeUndefined()
    await expect(a.deleteEvent('e1')).rejects.toBeInstanceOf(CalendarApiError)
  })

  it('sem configuracao nao chama a rede', async () => {
    delete process.env.GOOGLE_CLIENT_SECRET
    mock()
    await expect(new GoogleCalendarAdapter().busy(new Date(), new Date(), 'x')).rejects.toBeInstanceOf(CalendarApiError)
    expect(calls).toHaveLength(0)
  })
})
