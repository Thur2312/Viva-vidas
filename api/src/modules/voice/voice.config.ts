/** Leitura de ambiente em tempo de uso (permite testar trocando process.env). Nunca loga valores. */
const env = (k: string) => (process.env[k] ?? '').trim()
const present = (k: string) => env(k).length > 0
export const missingOf = (names: string[]) => names.filter((n) => !present(n))

export const DEFAULT_WINDOW = { days: [1, 2, 3, 4, 5], start: '09:00', end: '18:00', tz: 'America/Sao_Paulo' }

export interface CallWindow { days: number[]; start: string; end: string; tz: string }

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/

export function isValidWindow(w: any): w is CallWindow {
  if (!w || typeof w !== 'object') return false
  if (!Array.isArray(w.days) || !w.days.length || !w.days.every((d: any) => Number.isInteger(d) && d >= 0 && d <= 6)) return false
  if (typeof w.start !== 'string' || typeof w.end !== 'string' || !HHMM.test(w.start) || !HHMM.test(w.end)) return false
  if (w.start >= w.end) return false
  if (typeof w.tz !== 'string') return false
  try { new Intl.DateTimeFormat('en-US', { timeZone: w.tz }); } catch { return false }
  return true
}

/**
 * VOICE_CALL_WINDOW: "1-5@09:00-18:00" (dias 0=dom..6=sab; aceita lista "1,2,3,4,5" e faixa) com fuso opcional
 * "1-5@09:00-18:00@America/Sao_Paulo". Valor inválido NÃO relaxa nada: cai no padrão (seg-sex 09-18).
 */
export function parseWindowEnv(raw: string | undefined): CallWindow | null {
  const s = (raw ?? '').trim()
  if (!s) return null
  const m = /^([0-6](?:[-,][0-6])*)@(\d{2}:\d{2})-(\d{2}:\d{2})(?:@([A-Za-z_\/+-]+))?$/.exec(s)
  if (!m) return null
  const days = new Set<number>()
  for (const part of m[1].split(',')) {
    const r = part.split('-').map(Number)
    if (r.length === 2) { for (let d = r[0]; d <= r[1]; d++) days.add(d) } else days.add(r[0])
  }
  const w = { days: [...days].sort(), start: m[2], end: m[3], tz: m[4] ?? DEFAULT_WINDOW.tz }
  return isValidWindow(w) ? w : null
}

export const voiceEnv = {
  tenant: () => process.env.PILOT_TENANT || 'alberto',
  telephonyProvider: () => env('VOICE_TELEPHONY_PROVIDER').toLowerCase() || 'twilio',
  webhookBase: () => env('VOICE_WEBHOOK_BASE_URL').replace(/\/+$/, ''),
  operatorPhone: () => env('VOICE_OPERATOR_PHONE'),
  dncEnabled: () => env('VOICE_DNC_ENABLED').toLowerCase() === 'true',
  windowDefault: () => parseWindowEnv(process.env.VOICE_CALL_WINDOW) ?? DEFAULT_WINDOW,
  recordingRetentionDays: () => days('VOICE_RECORDING_RETENTION_DAYS', 365),
  transcriptRetentionDays: () => days('VOICE_TRANSCRIPT_RETENTION_DAYS', 365),
}

function days(name: string, def: number) {
  const n = Number(process.env[name])
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : def
}

export function toE164(digits: string): string | null {
  const d = (digits ?? '').replace(/\D/g, '')
  if (d.length < 10 || d.length > 15) return null
  return `+${d.length <= 11 ? '55' + d : d}`
}
