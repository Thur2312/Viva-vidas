/** Interruptor geral: sem CALENDAR_PROVIDER=google a agenda fica desligada (nada e consultado nem criado). */
export const calendarEnabled = () => String(process.env.CALENDAR_PROVIDER ?? '').trim().toLowerCase() === 'google'

export interface CalendarRules {
  timezone: string
  /** 0 = domingo ... 6 = sabado */
  days: number[]
  start: string // HH:MM local
  end: string // HH:MM local
  durationMin: number
  /** Antecedencia minima: nao oferece horario que comeca antes de agora + isto. */
  minNoticeMin: number
  horizonDays: number
}

export const DEFAULT_RULES: CalendarRules = {
  timezone: 'America/Sao_Paulo',
  days: [1, 2, 3, 4, 5],
  start: '09:00',
  end: '18:00',
  durationMin: 30,
  minNoticeMin: 120,
  horizonDays: 14,
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/
const toMin = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3))

/** CALENDAR_RULES = JSON parcial sobre o padrao. Valor invalido derruba a config inteira para o padrao (nunca meio-valido). */
export function parseRules(raw: string | undefined): CalendarRules {
  let o: any
  try { o = raw ? JSON.parse(raw) : {} } catch { return DEFAULT_RULES }
  const r: CalendarRules = { ...DEFAULT_RULES, ...(o && typeof o === 'object' ? o : {}) }
  const okTz = (() => { try { new Intl.DateTimeFormat('pt-BR', { timeZone: r.timezone }); return true } catch { return false } })()
  const ok =
    okTz &&
    Array.isArray(r.days) && r.days.length > 0 && r.days.every((d) => Number.isInteger(d) && d >= 0 && d <= 6) &&
    HHMM.test(r.start) && HHMM.test(r.end) && toMin(r.start) < toMin(r.end) &&
    Number.isInteger(r.durationMin) && r.durationMin >= 15 && r.durationMin <= 120 &&
    Number.isInteger(r.minNoticeMin) && r.minNoticeMin >= 0 && r.minNoticeMin <= 7 * 1440 &&
    Number.isInteger(r.horizonDays) && r.horizonDays >= 1 && r.horizonDays <= 60
  return ok ? r : DEFAULT_RULES
}

/** Quanto o relogio de `tz` esta a frente do UTC naquele instante, em ms. */
function offsetMs(utcMs: number, tz: string): number {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(new Date(utcMs)).map((x) => [x.type, x.value]),
  ) as Record<string, string>
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(utcMs / 1000) * 1000
}

/** Data/hora de parede em `tz` -> instante UTC (ms). Duas passadas cobrem a troca de horario de verao. */
export function zonedToUtc(y: number, m: number, d: number, hh: number, mm: number, tz: string): number {
  const wall = Date.UTC(y, m - 1, d, hh, mm)
  const first = wall - offsetMs(wall, tz)
  return wall - offsetMs(first, tz)
}

export interface Interval { start: number; end: number }
export interface Slot { start: string; end: string }

/** Horarios livres: dentro dos dias/janela, apos a antecedencia minima, sem cruzar nenhum compromisso ocupado. */
export function freeSlots(rules: CalendarRules, busy: Interval[], now: Date, limit = 20): Slot[] {
  const out: Slot[] = []
  const earliest = now.getTime() + rules.minNoticeMin * 60_000
  const step = rules.durationMin * 60_000
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: rules.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now).map((x) => [x.type, x.value])) as Record<string, string>
  const base = Date.UTC(+parts.year, +parts.month - 1, +parts.day)

  for (let i = 0; i <= rules.horizonDays && out.length < limit; i++) {
    const day = new Date(base + i * 86_400_000)
    if (!rules.days.includes(day.getUTCDay())) continue
    const [y, m, d] = [day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate()]
    const open = zonedToUtc(y, m, d, +rules.start.slice(0, 2), +rules.start.slice(3), rules.timezone)
    const close = zonedToUtc(y, m, d, +rules.end.slice(0, 2), +rules.end.slice(3), rules.timezone)
    for (let s = open; s + step <= close && out.length < limit; s += step) {
      if (s < earliest) continue
      if (busy.some((b) => s < b.end && s + step > b.start)) continue
      out.push({ start: new Date(s).toISOString(), end: new Date(s + step).toISOString() })
    }
  }
  return out
}

/** O inicio pedido e exatamente um dos horarios livres? (impede horario inventado, fora da janela ou ja ocupado) */
export function isBookable(rules: CalendarRules, busy: Interval[], now: Date, startIso: string): Slot | null {
  const t = Date.parse(startIso)
  if (!Number.isFinite(t)) return null
  return freeSlots(rules, busy, now, 10_000).find((s) => Date.parse(s.start) === t) ?? null
}
