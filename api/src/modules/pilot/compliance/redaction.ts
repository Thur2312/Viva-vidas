/**
 * Redação e pseudonimização de dados pessoais em texto livre. Funções puras, sem I/O.
 * Objetivo: o que sai do banco rumo ao provedor de LLM (e o que vira exemplo aprendido)
 * não carrega identificador direto. É redução de risco, não anonimização garantida:
 * texto livre pode conter identificadores indiretos que nenhuma regra pega.
 */

const digits = (s: string) => s.replace(/\D/g, '')

export function isValidCpf(raw: string): boolean {
  const d = digits(raw)
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false
  const calc = (len: number) => {
    let sum = 0
    for (let i = 0; i < len; i++) sum += Number(d[i]) * (len + 1 - i)
    const r = (sum * 10) % 11
    return r === 10 ? 0 : r
  }
  return calc(9) === Number(d[9]) && calc(10) === Number(d[10])
}

export function isValidCnpj(raw: string): boolean {
  const d = digits(raw)
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false
  const calc = (len: number) => {
    const w = len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
    let sum = 0
    for (let i = 0; i < len; i++) sum += Number(d[i]) * w[i]
    const r = sum % 11
    return r < 2 ? 0 : 11 - r
  }
  return calc(12) === Number(d[12]) && calc(13) === Number(d[13])
}

export function luhn(raw: string): boolean {
  const d = digits(raw)
  if (d.length < 13 || d.length > 19) return false
  let sum = 0
  for (let i = 0; i < d.length; i++) {
    let n = Number(d[d.length - 1 - i])
    if (i % 2 === 1) { n *= 2; if (n > 9) n -= 9 }
    sum += n
  }
  return sum % 10 === 0
}

export type PiiKind = 'cartao' | 'cnpj' | 'cpf' | 'email' | 'rg' | 'telefone' | 'nome'

export interface RedactOptions {
  /** Outros nomes conhecidos (completos). Cada nome e cada parte com 3+ letras viram [NOME]. */
  names?: string[]
  /** Nomes do próprio lead: viram [LEAD]. */
  leadNames?: string[]
  /** Telefones conhecidos do lead (qualquer formatação) → [TELEFONE]. */
  phones?: string[]
}

export interface RedactResult { text: string; found: PiiKind[] }

// Classe de caracteres tolerante a acento, para casar "Joao" com "João".
const ACCENTS: Record<string, string> = { a: 'aàáâãä', e: 'eèéêë', i: 'iìíîï', o: 'oòóôõö', u: 'uùúûü', c: 'cç', n: 'nñ' }
const stripAccents = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '')
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function nameRegex(token: string): RegExp {
  const base = stripAccents(token).toLowerCase()
  const src = [...base].map((ch) => (ACCENTS[ch] ? `[${ACCENTS[ch]}]` : esc(ch))).join('')
  return new RegExp(`(?<![\\p{L}\\p{N}])${src}(?![\\p{L}\\p{N}])`, 'giu')
}

const NAME_PARTICLES = new Set(['de', 'da', 'do', 'das', 'dos'])
function nameTokens(names: string[] = []): string[] {
  const out = new Set<string>()
  for (const n of names) {
    const full = (n || '').trim()
    if (full.length < 3) continue
    out.add(full)
    for (const t of full.split(/\s+/)) if (t.length >= 3 && !NAME_PARTICLES.has(t.toLowerCase())) out.add(t)
  }
  // nomes mais longos primeiro, para não deixar sobra do nome completo
  return [...out].sort((a, b) => b.length - a.length)
}

function phoneRegexFor(phone: string): RegExp | null {
  const d = digits(phone)
  if (d.length < 10) return null
  const variants = new Set([d])
  if (d.startsWith('55') && d.length >= 12) variants.add(d.slice(2))
  else variants.add(`55${d}`)
  const parts = [...variants].map((v) => [...v].map(esc).join('[\\s().\\-]*'))
  return new RegExp(`(?<!\\d)(?:\\+\\s*)?(?:\\(\\s*)?(?:${parts.join('|')})(?!\\d)`, 'g')
}

const RE_EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g
const RE_CARD = /(?<![\d-])\d{4}[ -]?\d{4}[ -]?\d{4}[ -]?\d{1,7}(?![\d-])/g
const RE_CNPJ = /(?<![\d./-])\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}(?![\d/-])/g
const RE_CPF = /(?<![\d./-])\d{3}\.?\d{3}\.?\d{3}-?\d{2}(?![\d/-])/g
// RG: com pontuação (12.345.678-9) ou precedido de "RG".
const RE_RG = /\bRG\b[\s:.nº°-]*\d[\d.\-]{4,12}[\dXx]|(?<![\d.])\d{1,2}\.\d{3}\.\d{3}-?[\dXx](?![\d-])/gi
const RE_PHONE = /(?<!\d)(?:\+?55[\s-]?)?(?:\(\s?\d{2}\s?\)|\d{2})[\s.-]?(?:9[\s.-]?)?\d{4}[\s.-]?\d{4}(?!\d)/g
// "meu nome é Fulano de Tal", "me chamo Maria", "aqui é o João"
const RE_SELF_INTRO =
  /\b(meu nome (?:é|e)|me chamo|aqui (?:é|e) (?:o|a))\s+([A-ZÀ-Ý][\p{L}']+(?:\s+(?:d[aeo]s?\s+)?[A-ZÀ-Ý][\p{L}']+){0,3})/gu

export function redactPii(input: string, opts: RedactOptions = {}): RedactResult {
  let text = input ?? ''
  const found = new Set<PiiKind>()
  const sub = (re: RegExp, kind: PiiKind, repl: string | ((m: string, ...a: any[]) => string)) => {
    text = text.replace(re, (m: string, ...a: any[]) => {
      const r = typeof repl === 'function' ? repl(m, ...a) : repl
      if (r !== m) found.add(kind)
      return r
    })
  }

  // 1) telefones conhecidos do lead
  for (const p of opts.phones ?? []) {
    const re = phoneRegexFor(p)
    if (re) sub(re, 'telefone', '[TELEFONE]')
  }
  // 2) e-mail, cartão (Luhn), CNPJ, CPF. Sem pontuação, só com dígito verificador válido.
  sub(RE_EMAIL, 'email', '[EMAIL]')
  sub(RE_CARD, 'cartao', (m) => (luhn(m) ? '[CARTAO]' : m))
  sub(RE_CNPJ, 'cnpj', (m) => (/[./-]/.test(m) || isValidCnpj(m) ? '[CNPJ]' : m))
  sub(RE_CPF, 'cpf', (m) => (/[.-]/.test(m) || isValidCpf(m) ? '[CPF]' : m))
  // 3) RG
  sub(RE_RG, 'rg', '[RG]')
  // 4) telefones em geral
  sub(RE_PHONE, 'telefone', '[TELEFONE]')

  // 5) nomes: conhecidos primeiro, depois apresentações explícitas
  const lead = new Set(nameTokens(opts.leadNames).map((t) => t.toLowerCase()))
  const toks = [...new Set([...nameTokens(opts.leadNames), ...nameTokens(opts.names)])].sort((a, b) => b.length - a.length)
  for (const tok of toks) sub(nameRegex(tok), 'nome', lead.has(tok.toLowerCase()) ? '[LEAD]' : '[NOME]')
  sub(RE_SELF_INTRO, 'nome', (m, intro, name) => (/\[(LEAD|NOME)\]/.test(name) ? m : `${intro} [NOME]`))

  text = text.replace(/(\[(?:LEAD|NOME)\])(?:\s+\[(?:LEAD|NOME)\])+/g, '$1')
  return { text, found: [...found] }
}

// ───────────── Dados de saúde (art. 11) ─────────────
const SENSITIVE_TERMS: Record<string, string[]> = {
  condicao: [
    'diabetes', 'diabetico', 'hipertensao', 'hipertenso', 'pressao alta', 'cancer', 'cancro', 'tumor', 'neoplasia', 'leucemia',
    'hiv', 'aids', 'hepatite', 'tuberculose', 'covid', 'depressao', 'ansiedade', 'bipolar', 'esquizofrenia', 'transtorno',
    'autismo', 'tea', 'tdah', 'cardiopatia', 'cardiaco', 'infarto', 'avc', 'arritmia', 'asma', 'bronquite', 'dpoc', 'epilepsia',
    'convulsao', 'cirrose', 'esclerose', 'parkinson', 'alzheimer', 'demencia', 'obesidade', 'bariatrica', 'gravida', 'gestante',
    'gravidez', 'gestacao', 'pre-natal', 'prenatal', 'aborto', 'infertilidade', 'fertilizacao', 'doenca preexistente',
    'doenca pre-existente', 'preexistencia', 'pre-existencia', 'cirurgia', 'internacao', 'internado', 'uti', 'hemodialise',
    'dialise', 'quimioterapia', 'radioterapia', 'transplante', 'deficiencia', 'cadeirante', 'doenca cronica', 'cronico',
    'artrite', 'lupus', 'fibromialgia', 'colesterol', 'glaucoma', 'catarata', 'hernia', 'sequela',
  ],
  medicamento: [
    'insulina', 'metformina', 'losartana', 'enalapril', 'captopril', 'atenolol', 'sinvastatina', 'atorvastatina', 'omeprazol',
    'fluoxetina', 'sertralina', 'escitalopram', 'clonazepam', 'rivotril', 'diazepam', 'alprazolam', 'zolpidem', 'ritalina',
    'levotiroxina', 'puran', 'warfarina', 'marevan', 'amoxicilina', 'ozempic', 'monjaro', 'tamoxifeno', 'litio', 'risperidona',
    'carbamazepina', 'quetiapina', 'anticoncepcional', 'antidepressivo', 'ansiolitico',
  ],
  exame: [
    'hemograma', 'ressonancia', 'tomografia', 'ultrassom', 'ultrassonografia', 'ecografia', 'ecocardiograma', 'eletrocardiograma',
    'biopsia', 'endoscopia', 'colonoscopia', 'mamografia', 'papanicolau', 'densitometria', 'cintilografia', 'laudo', 'exame de sangue',
    'glicemia', 'hemoglobina glicada', 'psa', 'beta hcg', 'cateterismo', 'holter', 'espirometria', 'polissonografia',
  ],
}
const RE_CID = /\bCID[\s:-]*[A-TV-Z]\d{2}(?:\.\d{1,2})?\b|\b[A-TV-Z]\d{2}\.\d{1,2}\b/i

const norm = (s: string) => stripAccents(s).toLowerCase()
const SENSITIVE_RES = Object.entries(SENSITIVE_TERMS).map(([cat, terms]) => ({
  cat,
  re: new RegExp(`(?<![a-z0-9])(?:${terms.map(esc).join('|')})(?![a-z0-9])`),
}))

export interface SensitiveResult { containsSensitive: boolean; categories: string[] }

/** Marca texto que provavelmente trata de saúde. Prefere falso positivo a falso negativo. */
export function flagSensitive(text: string): SensitiveResult {
  const t = norm(text ?? '')
  const categories = SENSITIVE_RES.filter((r) => r.re.test(t)).map((r) => r.cat)
  if (RE_CID.test(text ?? '')) categories.push('cid')
  return { containsSensitive: categories.length > 0, categories }
}

// ───────────── Pseudonimização para o provedor de LLM ─────────────
export interface LeadIdentity { name?: string | null; phone?: string | null; extraNames?: string[] }

export function pseudonymize(text: string, who: LeadIdentity): string {
  return redactPii(text, {
    leadNames: who.name ? [who.name] : [],
    names: who.extraNames,
    phones: who.phone ? [who.phone] : [],
  }).text
}

/** Aplica `pseudonymize` a todas as strings de um valor JSON (qualificação etc.). */
export function pseudonymizeDeep<T>(value: T, who: LeadIdentity): T {
  if (typeof value === 'string') return pseudonymize(value, who) as any
  if (Array.isArray(value)) return value.map((v) => pseudonymizeDeep(v, who)) as any
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as any).map(([k, v]) => [k, pseudonymizeDeep(v, who)])) as any
  }
  return value
}

/** Volta [LEAD] para o primeiro nome, só localmente, para o rascunho ficar comparável com a fala real. */
export function restoreLeadName(text: string, name?: string | null): string {
  const first = (name ?? '').trim().split(/\s+/)[0]
  return text.replace(/\[LEAD\]/g, first || '')
}
