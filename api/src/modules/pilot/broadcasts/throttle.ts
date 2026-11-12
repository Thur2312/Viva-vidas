/** Matemática de vazão, janela de envio, backoff e auto-pausa. Tudo puro e testável. */

export const TICK_MS = 15_000
export const MAX_ATTEMPTS = 5
export const AUTOPAUSE_WINDOW = 20
export const AUTOPAUSE_THRESHOLD = 0.3
export const AUTOPAUSE_MIN_SAMPLES = 5
/** Destinatário "em fila" há mais que isso sem desfecho = processo caiu no meio do envio. Nunca reenviamos (no máximo uma vez). */
export const STALE_CLAIM_MS = 5 * 60_000

export interface BudgetInput {
  ratePerMinute: number
  tickMs?: number
  sentLast60s: number
  dailyCap: number
  sentToday: number
  globalRemaining?: number
}

/** Quantos envios cabem neste ciclo: janela deslizante de 60s, teto por ciclo, teto diário do disparo e global. */
export function batchBudget(i: BudgetInput): number {
  const tick = i.tickMs ?? TICK_MS
  const perTick = Math.max(1, Math.ceil((i.ratePerMinute * tick) / 60_000))
  const minuteLeft = i.ratePerMinute - i.sentLast60s
  const dayLeft = i.dailyCap - i.sentToday
  const g = i.globalRemaining ?? Number.POSITIVE_INFINITY
  return Math.max(0, Math.min(perTick, minuteLeft, dayLeft, g))
}

/** Atraso exponencial: 30s, 60s, 2min, 4min... teto de 1h. `attempt` conta a tentativa que acabou de falhar (1 = primeira). */
export function backoffMs(attempt: number): number {
  return Math.min(3_600_000, 30_000 * 2 ** Math.max(0, attempt - 1))
}

/** `outcomes`: do mais recente para o mais antigo, true = falha. Pausa se a taxa nos últimos 20 passar de 30%. */
export function shouldAutoPause(outcomes: boolean[]): { pause: boolean; rate: number; samples: number } {
  const recent = outcomes.slice(0, AUTOPAUSE_WINDOW)
  const samples = recent.length
  if (samples < AUTOPAUSE_MIN_SAMPLES) return { pause: false, rate: 0, samples }
  const rate = recent.filter(Boolean).length / samples
  return { pause: rate > AUTOPAUSE_THRESHOLD, rate, samples }
}

/** Erro transitório (vale tentar de novo): 429, 5xx, tempo esgotado. 4xx é definitivo. */
export function isTransientStatus(status: number | null): boolean {
  return status === null || status === 429 || status >= 500
}

export function parseGatewayStatus(message: string | undefined): number | null {
  const m = /Chat respondeu (\d{3})/.exec(message ?? '')
  return m ? Number(m[1]) : null
}

// ───────────── Janela de envio (fuso horário) ─────────────

export interface WindowSpec { timezone: string; start: string; end: string; days: number[] }
export const DEFAULT_WINDOW: WindowSpec = { timezone: 'America/Sao_Paulo', start: '09:00', end: '18:00', days: [1, 2, 3, 4, 5] }

const WD: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }

export function localParts(now: Date, timezone: string) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  const p = Object.fromEntries(f.formatToParts(now).map((x) => [x.type, x.value]))
  return { weekday: WD[p.weekday], minutes: Number(p.hour) * 60 + Number(p.minute) }
}

const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5))

/** Dentro da janela [start, end) nos dias permitidos. Janela inválida (início >= fim) = fechada. */
export function inSendWindow(now: Date, w: WindowSpec): boolean {
  if (toMin(w.start) >= toMin(w.end)) return false
  const { weekday, minutes } = localParts(now, w.timezone)
  return w.days.includes(weekday) && minutes >= toMin(w.start) && minutes < toMin(w.end)
}

/** Início do dia local, em UTC (para o teto diário). */
export function startOfLocalDay(now: Date, timezone: string): Date {
  const { minutes } = localParts(now, timezone)
  // Aproximação segura: recua os minutos decorridos no dia local, arredondando ao minuto.
  const d = new Date(now.getTime() - minutes * 60_000)
  d.setUTCSeconds(0, 0)
  return d
}
