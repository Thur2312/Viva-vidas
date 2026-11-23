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
  /\bdoentes?\b/,
  /\bremedios?\b/,
  /\bmedicamentos?\b/,
  /\bmedicac\w*/,
  /\bgestantes?\b/,
  /\bgravida\b/,
  /\bgravidez\b/,
  /\bcirurgias?\b/,
  /\bpre-?existentes?\b/,
  /\bproblemas? de saude\b/,
  /\btratamentos?\b/,
  /\bcondica(?:o|oes) (?:medicas?|de saude)\b/,
  /\bdiabet\w*/,
  /\bhipertens\w*/,
  /\bcancer\b/,
  /\binternac\w*|\binternad\w*/,
  /\balergi\w*/,
  // "saude" sozinha, exceto em "plano/seguro de saude" (pergunta comercial legitima)
  /(?<!plano de )(?<!planos de )(?<!seguro )(?<!seguro de )\bsaude\b/,
]

// Indicios de pergunta mesmo sem '?': interrogativo/verbo no inicio da frase (com vocativo
// opcional, ex.: "Maria, voce tem ..."), "voce <verbo>" ou "algum(a)" em qualquer posicao.
export const QUESTION_CUES =
  /^(?:[a-z]+,\s*)?(?:voce\s+)?(?:ja\s+)?(?:tem|possui|toma|usa|faz|fez|esta|sofre|ha|teve|tinha|qual|quais|quem|como|quando|onde)\b|\bvoce\s+(?:ja\s+)?(?:tem|possui|toma|usa|faz|fez|sofre|esta|teve|tinha)\b|\balgum(?:a)?\b/

export const NUMBER_WORDS: Record<string, number> = {
  um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8,
  nove: 9, dez: 10, quinze: 15, vinte: 20, trinta: 30,
}

export const DEADLINE_PATTERNS: RegExp[] = [
  /(?<![a-z0-9])(\d+|um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez|quinze|vinte|trinta)\s*(dias?|horas?|hrs?|hs|h|d|minutos?|min|meses|mes|semanas?|anos?)(?![a-z0-9])/g,
]

// Cada padrao de preco captura o numero no grupo 1.
const NUM = '(\\d+(?:[.,]\\d+)*)'
// numero seguido de unidade de prazo ou percentual nao e preco
const NOT_UNIT =
  '(?!\\s*(?:dias?|horas?|hrs?|hs|h|d|minutos?|min|meses|mes|semanas?|anos?|%|por cento)(?![a-z0-9]))'
const MONEY_PATTERNS: RegExp[] = [
  new RegExp(`r?\\$\\s*${NUM}`, 'g'),
  new RegExp(`${NUM}\\s*(?:reais|real)\\b`, 'g'),
  new RegExp(`${NUM}\\s*(?:por mes|ao mes|/\\s*mes|mensais|mensal)(?![a-z0-9])`, 'g'),
  new RegExp(`\\d+\\s*x\\s*(?:de\\s*)?(?:r?\\$\\s*)?${NUM}${NOT_UNIT}`, 'g'),
  new RegExp(
    `(?:mensalidades?|parcelas?|valor|preco|a partir de)\\s*(?:de|e|:)?\\s*(?:r?\\$\\s*)?${NUM}${NOT_UNIT}`,
    'g',
  ),
]
const MIL_REAIS = /(?:(\d+)\s*)?mil\s+reais\b/g

const PERCENT_PATTERN = /(\d+(?:[.,]\d+)*)\s*(?:%|por cento)/g

export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
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
  if (unit === 'meses') return 'mes'
  if (/^(?:h|hrs?|hs|horas?)$/.test(unit)) return 'hora'
  if (/^(?:d|dias?)$/.test(unit)) return 'dia'
  if (/^(?:min|minutos?)$/.test(unit)) return 'minuto'
  return unit.replace(/s$/, '')
}

function canonicalQuantity(q: string): string {
  return q in NUMBER_WORDS ? String(NUMBER_WORDS[q]) : canonicalNumber(q)
}

function matchAll(text: string, re: RegExp): RegExpMatchArray[] {
  return Array.from(text.matchAll(new RegExp(re.source, 'g')))
}

function moneyValues(s: string): string[] {
  const direct = MONEY_PATTERNS.flatMap((re) => matchAll(s, re).map((m) => canonicalNumber(m[1])))
  const mil = matchAll(s, MIL_REAIS).map((m) => String((m[1] ? parseInt(m[1], 10) : 1) * 1000))
  return [...direct, ...mil]
}

function hasTerm(text: string, term: string): boolean {
  return new RegExp(`(?:^|[^a-z0-9])${term}(?![a-z0-9])`).test(text)
}

function isHealthQuestion(normalized: string): boolean {
  // Tradeoff: so marcamos frases que SAO perguntas ('?' ou indicio interrogativo)
  // E citam termo de saude. Afirmacoes que apenas mencionam o termo nao marcam,
  // evitando falso positivo, ao custo de perder perguntas indiretas sem '?' e sem
  // cue (ex.: "me diga se ha doenca"), que ficam para o verificador LLM.
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

  // valores: aprovado so por numero em formato de dinheiro no fato (nao "30 dias" nem "20%")
  const factMoney = new Set(factTexts.flatMap(moneyValues))
  const moneys = moneyValues(t)
  if (moneys.length) {
    risky = true
    if (moneys.some((n) => !factMoney.has(n))) violations.push('valor_nao_aprovado')
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
    DEADLINE_PATTERNS.flatMap((re) => matchAll(s, re).map((m) => `${canonicalQuantity(m[1])} ${canonicalUnit(m[2])}`))
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
