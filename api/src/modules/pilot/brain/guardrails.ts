import type { ApprovedFact } from './types'

export type Violation =
  | 'valor_nao_aprovado'
  | 'percentual_nao_aprovado'
  | 'prazo_nao_aprovado'
  | 'cobertura_nao_aprovada'
  | 'urgencia_falsa'
  | 'pergunta_saude'
  | 'varias_perguntas'
  | 'tamanho'

// Todas as listas abaixo operam sobre texto JA normalizado (minusculas, sem acento).
export const URGENCY_TERMS = [
  'so hoje',
  'so ate hoje',
  'ultima chance',
  'ultimas vagas',
  'ultimas unidades',
  'corre',
  'nao perca',
  'oferta expira',
  'ultimo dia',
  'acaba hoje',
  'por tempo limitado',
]

export const COVERAGE_PHRASES = [
  'cobre tudo',
  'cobre qualquer',
  'sem carencia',
  'cobertura total',
  'cobertura completa',
  'sem limite',
  'sem limites',
  'reembolso integral',
  'aceita todas as doencas',
  'aceita qualquer doenca',
]

export const HEALTH_QUESTION_PATTERNS: RegExp[] = [
  /\bdoencas?\b/,
  /\bremedios?\b/,
  /\bmedicamentos?\b/,
  /\bgestantes?\b/,
  /\bgravida\b/,
  /\bgravidez\b/,
  /\bcirurgias?\b/,
  /\bpre-?existentes?\b/,
  /\bproblemas? de saude\b/,
  /\btratamentos?\b/,
  /\bcondica(?:o|oes) medicas?\b/,
]

// Interrogativos que iniciam uma frase-pergunta mesmo sem '?'
export const QUESTION_CUES = /^(?:voce\s+)?(?:tem|possui|toma|usa|faz|fez|ja fez|esta|sofre|ha|qual|quais|quem|algum|alguma|como|quando|onde)\b/

export const DEADLINE_PATTERNS: RegExp[] = [
  /(\d+)\s*(dias?|horas?|meses|mes|semanas?|anos?)\b/g,
]

const MONEY_PATTERNS: RegExp[] = [
  /r\$\s*(\d+(?:[.,]\d+)*)/g,
  /(\d+(?:[.,]\d+)*)\s*reais\b/g,
  /(\d+(?:[.,]\d+)*)\s*por mes\b/g,
]

const PERCENT_PATTERN = /(\d+(?:[.,]\d+)*)\s*(?:%|por cento)/g
const NUMBER_PATTERN = /\d+(?:[.,]\d+)*/g

export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// '1.250,00' -> '1250'; '350,50' -> '350.5'; '1.250' -> '1250'
export function canonicalNumber(raw: string): string {
  let s = raw
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.')
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '')
  const n = parseFloat(s)
  return Number.isNaN(n) ? s : String(n)
}

function canonicalUnit(unit: string): string {
  return unit === 'meses' ? 'mes' : unit.replace(/s$/, '')
}

function matchAll(text: string, re: RegExp): RegExpMatchArray[] {
  return Array.from(text.matchAll(new RegExp(re.source, 'g')))
}

function hasTerm(text: string, term: string): boolean {
  return new RegExp(`(?:^|[^a-z0-9])${term}(?![a-z0-9])`).test(text)
}

function isHealthQuestion(normalized: string): boolean {
  // Tradeoff: so marcamos frases que SAO perguntas ('?' ou abertura interrogativa)
  // E citam termo de saude. Afirmacoes que apenas mencionam o termo nao marcam,
  // evitando falso positivo, ao custo de perder perguntas indiretas sem '?'
  // (ex.: "me diga se voce tem alguma doenca"), que ficam para o verificador LLM.
  const sentences = normalized.split(/(?<=[.!?])\s+/)
  return sentences.some((s) => {
    const isQuestion = s.includes('?') || QUESTION_CUES.test(s)
    return isQuestion && HEALTH_QUESTION_PATTERNS.some((p) => p.test(s))
  })
}

export function checkDraft(
  text: string,
  facts: ApprovedFact[],
  opts: { maxChars?: number } = {},
): { violations: Violation[]; risky: boolean } {
  const maxChars = opts.maxChars ?? 600
  const t = normalize(text)
  const factTexts = facts.map((f) => normalize(f.texto))
  const violations: Violation[] = []
  let risky = false

  // valores
  const factNumbers = new Set(factTexts.flatMap((f) => matchAll(f, NUMBER_PATTERN).map((m) => canonicalNumber(m[0]))))
  const moneys = MONEY_PATTERNS.flatMap((re) => matchAll(t, re).map((m) => canonicalNumber(m[1])))
  if (moneys.length) {
    risky = true
    if (moneys.some((n) => !factNumbers.has(n))) violations.push('valor_nao_aprovado')
  }

  // percentuais
  const factPercents = new Set(factTexts.flatMap((f) => matchAll(f, PERCENT_PATTERN).map((m) => canonicalNumber(m[1]))))
  const percents = matchAll(t, PERCENT_PATTERN).map((m) => canonicalNumber(m[1]))
  if (percents.length) {
    risky = true
    if (percents.some((n) => !factPercents.has(n))) violations.push('percentual_nao_aprovado')
  }

  // prazos
  const deadlineKeys = (s: string) =>
    DEADLINE_PATTERNS.flatMap((re) => matchAll(s, re).map((m) => `${canonicalNumber(m[1])} ${canonicalUnit(m[2])}`))
  const factDeadlines = new Set(factTexts.flatMap(deadlineKeys))
  const deadlines = deadlineKeys(t)
  if (deadlines.length) {
    risky = true
    if (deadlines.some((d) => !factDeadlines.has(d))) violations.push('prazo_nao_aprovado')
  }

  // cobertura
  const coverage = COVERAGE_PHRASES.filter((p) => hasTerm(t, p))
  if (coverage.length) {
    risky = true
    if (coverage.some((p) => !factTexts.some((f) => hasTerm(f, p)))) violations.push('cobertura_nao_aprovada')
  }

  if (URGENCY_TERMS.some((u) => hasTerm(t, u))) violations.push('urgencia_falsa')
  if (isHealthQuestion(t)) violations.push('pergunta_saude')
  if ((text.match(/\?/g) ?? []).length > 1) violations.push('varias_perguntas')
  if (text.length > maxChars) violations.push('tamanho')

  return { violations, risky }
}
