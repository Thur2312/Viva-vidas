import { CallWindow } from './voice.config'
import { CALL_STATUSES, CallStatus, TERMINAL_STATUSES } from './voice.types'

// ───────────────────────── Janela de horário ─────────────────────────
const WEEKDAY: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }

/** Dia da semana e minutos desde 00:00 no fuso da janela (Intl, sem dependência extra). */
export function localParts(now: Date, tz: string) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  return { day: WEEKDAY[get('weekday')], minutes: Number(get('hour')) * 60 + Number(get('minute')) }
}

const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5))

/** Dentro da janela se o dia está na lista e start <= hora < end. */
export function isWithinWindow(now: Date, w: CallWindow): boolean {
  const { day, minutes } = localParts(now, w.tz)
  return w.days.includes(day) && minutes >= toMin(w.start) && minutes < toMin(w.end)
}

// ───────────────────────── Portões de conformidade ─────────────────────────
export type GateCode =
  | 'lead_nao_encontrado' | 'lead_anonimizado' | 'contato_bloqueado' | 'sem_consentimento_atendimento'
  | 'aviso_gravacao_ausente' | 'fora_da_janela' | 'dnc_sem_verificador' | 'dnc_bloqueado' | 'telefone_invalido'

export interface GateFailure { code: GateCode; message: string }

export interface GateInput {
  lead: { id: string; phone: string; opt_out?: boolean; anonymized_at?: unknown } | null
  /** Resultado de ConsentService.canContact. */
  canContact: { allowed: boolean; reason: string } | null
  hasAtendimentoConsent: boolean
  announcementText: string | null | undefined
  window: CallWindow
  now: Date
  dncEnabled: boolean
  /** null = nenhum verificador configurado. */
  dnc: { configured: boolean; blocked?: boolean } | null
  phoneE164: string | null
}

const MSG: Record<GateCode, string> = {
  lead_nao_encontrado: 'Lead não encontrado.',
  lead_anonimizado: 'Lead anonimizado: não há como contatá-lo.',
  contato_bloqueado: 'Contato bloqueado: o lead pediu para não ser contatado ou revogou autorização.',
  sem_consentimento_atendimento: 'Sem consentimento ativo para a finalidade "atendimento". Registre-o antes de ligar.',
  aviso_gravacao_ausente: 'O texto do aviso de gravação não está configurado. Sem ele a ligação não é feita (a gravação exige aviso).',
  fora_da_janela: 'Fora da janela de horário permitida para ligações.',
  dnc_sem_verificador: 'A checagem de "Não Perturbe" está ligada, mas nenhum verificador está configurado. Ligação recusada por segurança.',
  dnc_bloqueado: 'Número presente na lista de "Não Perturbe".',
  telefone_invalido: 'O telefone do lead é inválido.',
}
export const gateMessage = (c: GateCode) => MSG[c]

/**
 * Avalia TODOS os portões em ordem fixa e devolve o primeiro que falha (ou null). Cada portão falha FECHADO:
 * ausência de dado = recusa. Função pura, testável sem banco.
 */
export function evaluateGates(i: GateInput): GateFailure | null {
  const fail = (code: GateCode): GateFailure => ({ code, message: MSG[code] })
  if (!i.lead) return fail('lead_nao_encontrado')
  if (i.lead.anonymized_at || String(i.lead.phone).startsWith('anon:')) return fail('lead_anonimizado')
  if (i.lead.opt_out || !i.canContact || !i.canContact.allowed) return fail('contato_bloqueado')
  if (!i.hasAtendimentoConsent) return fail('sem_consentimento_atendimento')
  if (!i.announcementText || !i.announcementText.trim()) return fail('aviso_gravacao_ausente')
  if (!i.phoneE164) return fail('telefone_invalido')
  if (!isWithinWindow(i.now, i.window)) return fail('fora_da_janela')
  if (i.dncEnabled) {
    if (!i.dnc || !i.dnc.configured) return fail('dnc_sem_verificador')
    if (i.dnc.blocked !== false) return fail('dnc_bloqueado') // só `blocked === false` libera
  }
  return null
}

// ───────────────────────── Máquina de estados da ligação ─────────────────────────
const RANK: Record<CallStatus, number> = { queued: 0, ringing: 1, in_progress: 2, completed: 3, busy: 3, no_answer: 3, failed: 3, canceled: 3 }

export const isTerminal = (s: CallStatus) => TERMINAL_STATUSES.includes(s)
export const isCallStatus = (s: unknown): s is CallStatus => (CALL_STATUSES as readonly string[]).includes(s as string)

/**
 * Webhooks chegam repetidos e fora de ordem. Regras: só avança (rank maior); estado terminal é final;
 * mesmo estado = no-op. Retorna se deve aplicar a transição.
 */
export function nextStatus(current: CallStatus, incoming: CallStatus): { apply: boolean; status: CallStatus } {
  if (isTerminal(current)) return { apply: false, status: current }
  if (RANK[incoming] <= RANK[current]) return { apply: false, status: current }
  return { apply: true, status: incoming }
}
