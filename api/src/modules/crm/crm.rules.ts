import { CrmApiError } from './crm.types'

/** Interruptor geral: sem CRM_PROVIDER=pipedrive nada entra na fila e nada e enviado. */
export const crmEnabled = () => String(process.env.CRM_PROVIDER ?? '').trim().toLowerCase() === 'pipedrive'

export const MAX_ATTEMPTS = 8
export const TICK_MS = 15_000
export const BATCH_SIZE = 20
/** "processing" ha mais que isso = o processo morreu no meio; volta para a fila (as chamadas ao CRM sao idempotentes). */
export const STALE_CLAIM_MS = 5 * 60_000

/** 30s, 1min, 2min... ate 1h. `attempts` ja inclui a tentativa que acabou de falhar. */
export const backoffMs = (attempts: number) => Math.min(30_000 * 2 ** Math.max(0, attempts - 1), 3_600_000)

/** Rede, 429 e 5xx valem nova tentativa; 4xx (token invalido, dado recusado) nao: tentar de novo so repete o erro. */
export function isTransient(e: unknown): boolean {
  if (!(e instanceof CrmApiError)) return false
  return e.status === 0 || e.status === 429 || e.status >= 500
}

/** Apenas etapas que valem a pena no CRM. contatado/respondeu nao sao enviados: minimiza dado e ruido. */
export const SYNCED_EVENTS = ['qualificado', 'reuniao_marcada', 'compareceu', 'venda', 'perdido', 'opt_out'] as const

/** PIPEDRIVE_STAGE_MAP = {"qualificado": 12, "reuniao_marcada": 13, "compareceu": 14}. Valor invalido e ignorado (vira "sem etapa"). */
export function parseStageMap(raw: string | undefined): Record<string, number> {
  try {
    const o = JSON.parse(raw ?? '{}')
    const out: Record<string, number> = {}
    for (const k of ['qualificado', 'reuniao_marcada', 'compareceu']) if (Number.isInteger(o?.[k]) && o[k] > 0) out[k] = o[k]
    return out
  } catch {
    return {}
  }
}

export interface PlanLead { name: string | null; opt_out: boolean; anonymized_at: Date | string | null }
export interface PlanIds { person_id?: number; deal_id?: number }
export interface Plan {
  skip?: string
  ensurePerson?: boolean
  ensureDeal?: boolean
  stageId?: number
  status?: 'open' | 'won' | 'lost'
  value?: number
  note?: string
}

const NOTES: Record<string, string> = {
  qualificado: 'Lead qualificado pelo agente de IA.',
  reuniao_marcada: 'Reunião marcada pelo agente de IA.',
  compareceu: 'Lead compareceu à reunião.',
  venda: 'Venda registrada.',
  perdido: 'Lead marcado como perdido.',
  opt_out: 'Lead pediu para não ser contatado (opt-out). Não enviar novas mensagens.',
}

/** Decide, sem tocar em rede nem banco, o que fazer no CRM para um evento. */
export function planFor(type: string, value: number | null, lead: PlanLead, ids: PlanIds, stageMap: Record<string, number>): Plan {
  if (lead.anonymized_at) return { skip: 'anonimizado' }
  if (!(SYNCED_EVENTS as readonly string[]).includes(type)) return { skip: 'etapa_nao_sincronizada' }

  if (type === 'opt_out') {
    // So avisa o CRM se a pessoa ja esta la: nao criamos registro novo de quem acabou de pedir para sair.
    return ids.person_id && ids.deal_id ? { note: NOTES.opt_out, status: 'lost' } : ids.person_id ? { skip: 'opt_out_sem_negocio' } : { skip: 'opt_out_sem_registro' }
  }
  if (lead.opt_out) return { skip: 'opt_out' }

  if (type === 'venda') return { ensurePerson: true, ensureDeal: true, status: 'won', ...(value != null ? { value } : {}), note: NOTES.venda }
  if (type === 'perdido') return ids.deal_id ? { status: 'lost', note: NOTES.perdido } : { skip: 'perdido_sem_negocio' }

  const stageId = stageMap[type]
  if (!stageId) return { skip: 'sem_etapa_mapeada' }
  return { ensurePerson: true, ensureDeal: true, stageId, note: NOTES[type] }
}

/** Titulo do negocio: so o primeiro nome (o resto do cadastro fica no WhatsApp/painel). */
export function dealTitle(name: string | null): string {
  const first = (name ?? '').trim().split(/\s+/)[0]
  return `WhatsApp · ${first ? first.slice(0, 40) : 'Lead'}`
}

/** Texto seguro para guardar em last_error: so o que identifica a falha, sem corpo de resposta. */
export function safeError(e: unknown): string {
  if (e instanceof CrmApiError) return e.message.slice(0, 120)
  const m = e instanceof Error ? e.name : 'erro'
  return String(m).slice(0, 120)
}
