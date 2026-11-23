import { Predicate, Profile, ProfileEntry } from './types'

type Extracted = Record<string, { valor: ProfileEntry['valor']; confianca: number }>

const DEFAULT_MIN_CONFIDENCE = 0.6

/** BRAIN_MIN_CONFIDENCE vazio ou não numérico cai no padrão (0.6), nunca em 0 nem NaN. */
function envMinConfidence(): number {
  const raw = (process.env.BRAIN_MIN_CONFIDENCE ?? '').trim()
  if (!raw) return DEFAULT_MIN_CONFIDENCE
  const n = Number(raw)
  return Number.isFinite(n) ? n : DEFAULT_MIN_CONFIDENCE
}

/**
 * Mescla campos extraídos no perfil sem mutar as entradas.
 * - confiança < mínimo: ignorado;
 * - campo novo: entra;
 * - confiança maior que a existente: substitui;
 * - confiança menor ou igual: mantém o existente e, se o valor difere, a chave vai em `conflicts`.
 * A evidência guarda só o id da mensagem, nunca o texto do lead.
 */
export function mergeProfile(
  current: Profile,
  extracted: Extracted,
  msgId: number | string,
  opts?: { minConfidence?: number },
): { profile: Profile; conflicts: string[] } {
  const min = opts?.minConfidence ?? envMinConfidence()
  const profile: Profile = { ...current }
  const conflicts: string[] = []
  for (const [chave, novo] of Object.entries(extracted)) {
    if (!(novo.confianca >= min)) continue
    const atual = profile[chave]
    if (!atual || novo.confianca > atual.confianca) {
      profile[chave] = { valor: novo.valor, confianca: novo.confianca, msgId: String(msgId) }
    } else if (atual.valor !== novo.valor) {
      conflicts.push(chave)
    }
  }
  return { profile, conflicts }
}

function toNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  return null
}

/**
 * Avalia um critério contra o perfil. Retorna true/false, ou null quando faltam dados.
 * - `all` é E tri-valorado: algum false -> false; senão algum null -> null; senão true.
 * - `any` é OU tri-valorado: algum true -> true; senão algum null -> null; senão false.
 * - `presente`/`ausente` em campo faltante são definitivos (presente -> false, ausente -> true).
 * - eq/gt/gte/lt/lte em campo faltante -> null.
 * - Comparação numérica converte strings numéricas; `eq` envolvendo string compara como
 *   string, sem caixa e sem espaços nas pontas.
 * - Predicado null -> null.
 */
export function evalPredicate(p: Predicate | null, profile: Profile): boolean | null {
  if (!p) return null
  if ('campo' in p) {
    const entry = profile[p.campo]
    if (p.op === 'presente') return !!entry
    if (p.op === 'ausente') return !entry
    if (!entry) return null
    const a = entry.valor
    const b = p.valor
    if (p.op === 'eq') {
      if (typeof a === 'string' || typeof b === 'string') {
        return String(a).trim().toLowerCase() === String(b).trim().toLowerCase()
      }
      return a === b
    }
    const x = toNumber(a)
    const y = toNumber(b)
    if (x === null || y === null) return null
    if (p.op === 'gt') return x > y
    if (p.op === 'gte') return x >= y
    if (p.op === 'lt') return x < y
    return x <= y
  }
  if (p.all) {
    const rs = p.all.map((c) => evalPredicate(c, profile))
    if (rs.includes(false)) return false
    return rs.includes(null) ? null : true
  }
  if (p.any) {
    const rs = p.any.map((c) => evalPredicate(c, profile))
    if (rs.includes(true)) return true
    return rs.includes(null) ? null : false
  }
  return null
}
