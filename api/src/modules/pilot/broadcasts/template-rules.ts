import { BadRequestException } from '@nestjs/common'

export interface TemplateButton { type: 'QUICK_REPLY' | 'URL' | 'PHONE_NUMBER'; text: string; url?: string; phone_number?: string }
export interface TemplateContent { bodyText?: string | null; footerText?: string | null; buttons?: TemplateButton[] | null }

export const TEMPLATE_NAME_RE = /^[a-z0-9_]{1,512}$/
const SHORTENERS = /\b(bit\.ly|tinyurl\.com|t\.co|goo\.gl|is\.gd|cutt\.ly|rb\.gy|ow\.ly)\b/i
const PROMO_WORDS = /(?<![\wÀ-ÿ])(desconto|promo[cç][aã]o|oferta|gr[aá]tis|gratuito|aproveite|imperd[ií]vel|[uú]ltimas vagas|cupom|black friday)(?![\wÀ-ÿ])/i
const URGENT_WORDS = /(?<![\wÀ-ÿ])(urgente|[uú]ltima chance|corra|s[oó] hoje|garantido)(?![\wÀ-ÿ])/i

/** Aviso de saída exigido nos templates de marketing: texto "responda PARAR/SAIR" ou botão de resposta rápida. */
export function hasOptOutHint(t: TemplateContent): boolean {
  const text = `${t.bodyText ?? ''}\n${t.footerText ?? ''}`
  if (/\b(responda|digite|envie|mande|escreva)\s+[*_]*(parar|sair)\b/i.test(text)) return true
  return !!t.buttons?.some((b) => b.type === 'QUICK_REPLY' && !!b.text?.trim())
}

export function countVariables(body: string): number {
  return new Set(body.match(/\{\{\d+\}\}/g) ?? []).size
}

/** Valida a criação de um template e devolve a lista de problemas (vazia = ok). Mesmas regras do chat, mais as de conformidade. */
export function validateTemplateInput(i: {
  name: string; category: string; language?: string; bodyText: string; bodyExamples?: string[]; footerText?: string; buttons?: TemplateButton[]
}): string[] {
  const errs: string[] = []
  if (!TEMPLATE_NAME_RE.test(i.name ?? '')) errs.push('Nome inválido: use minúsculas, números e sublinhado.')
  if (!['MARKETING', 'UTILITY'].includes(i.category)) errs.push('Categoria deve ser MARKETING ou UTILITY.')
  const body = i.bodyText ?? ''
  if (!body.trim()) errs.push('O corpo do template é obrigatório.')
  if (body.length > 1024) errs.push('O corpo passa de 1024 caracteres.')
  const vars = body.match(/\{\{(\d+)\}\}/g) ?? []
  const nums = [...new Set(vars.map((v) => Number(v.replace(/\D/g, ''))))].sort((a, b) => a - b)
  if (nums.some((n, idx) => n !== idx + 1)) errs.push('As variáveis devem ser sequenciais: {{1}}, {{2}}, ...')
  if (/^\s*\{\{\d+\}\}/.test(body) || /\{\{\d+\}\}\s*[.!?]?\s*$/.test(body)) errs.push('Variável no início ou no fim do texto costuma ser reprovada pela Meta.')
  if (nums.length > 0 && (i.bodyExamples?.length ?? 0) < nums.length) errs.push('Informe um exemplo para cada variável (a Meta exige).')
  if (SHORTENERS.test(body) || SHORTENERS.test(i.footerText ?? '')) errs.push('Link encurtado não é permitido.')
  if (URGENT_WORDS.test(body)) errs.push('Evite urgência agressiva ou promessa de garantia no texto.')
  if (i.footerText && i.footerText.length > 60) errs.push('O rodapé passa de 60 caracteres.')
  if ((i.buttons?.length ?? 0) > 3) errs.push('No máximo 3 botões.')
  for (const b of i.buttons ?? []) {
    if (!b.text?.trim() || b.text.length > 25) errs.push('O texto do botão deve ter de 1 a 25 caracteres.')
    if (b.type === 'URL' && (!b.url || !/^https:\/\//i.test(b.url) || SHORTENERS.test(b.url))) errs.push('Botão de URL exige https e não aceita encurtador.')
  }
  if (i.category === 'MARKETING' && !hasOptOutHint(i)) errs.push('Template de marketing precisa de aviso de saída ("responda PARAR para sair") ou botão de resposta rápida.')
  if (i.category === 'UTILITY' && PROMO_WORDS.test(body)) errs.push('Texto promocional em template UTILITY: a Meta reclassifica como MARKETING. Use a categoria MARKETING.')
  return errs
}

export function assertValidTemplate(i: Parameters<typeof validateTemplateInput>[0]) {
  const errs = validateTemplateInput(i)
  if (errs.length) throw new BadRequestException(errs.join(' '))
}

/** Valor da variável: sem quebra de linha/tabulação (a Meta recusa), sem espaços repetidos, tamanho limitado. */
export function cleanVar(v: string, max = 60): string {
  return String(v ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, max)
}

export type VarSource = 'lead.name' | 'lead.first_name' | 'custom'
export interface VarSpec { source: VarSource; value?: string; fallback?: string }
export type VariablesMap = Record<string, VarSpec>

export function validateVariablesMap(map: unknown, bodyText: string | null | undefined): string[] {
  const errs: string[] = []
  const need = bodyText ? countVariables(bodyText) : 0
  const m = (map ?? {}) as Record<string, any>
  for (let n = 1; n <= need; n++) {
    const s = m[String(n)]
    if (!s || !['lead.name', 'lead.first_name', 'custom'].includes(s.source)) errs.push(`Variável {{${n}}} sem origem definida.`)
    else if (s.source === 'custom' && !cleanVar(s.value ?? '')) errs.push(`Variável {{${n}}} personalizada está vazia.`)
  }
  for (const k of Object.keys(m)) {
    if (!/^[1-9]\d?$/.test(k)) errs.push(`Chave de variável inválida: ${k}`)
    else if (bodyText && Number(k) > need) errs.push(`O template não usa {{${k}}}.`)
  }
  return errs
}

/** Monta as variáveis do corpo para um lead. Devolve null se alguma ficar vazia (o lead é pulado, nunca enviado "em branco"). */
export function resolveVariables(map: VariablesMap, count: number, lead: { name?: string | null }): string[] | null {
  const out: string[] = []
  for (let n = 1; n <= count; n++) {
    const s = map[String(n)]
    if (!s) return null
    const full = cleanVar(lead.name ?? '')
    let v = ''
    if (s.source === 'lead.name') v = full
    else if (s.source === 'lead.first_name') v = full.split(' ')[0] ?? ''
    else v = cleanVar(s.value ?? '')
    if (!v) v = cleanVar(s.fallback ?? '')
    if (!v) return null
    out.push(v)
  }
  return out
}

export function renderPreview(body: string, vars: string[]): string {
  return body.replace(/\{\{(\d+)\}\}/g, (_, d) => vars[Number(d) - 1] ?? `{{${d}}}`)
}

/** Os 5 modelos rascunhados em docs/whatsapp-oficial.md (ainda não criados na Meta). */
export const DRAFT_TEMPLATES: { name: string; category: 'MARKETING' | 'UTILITY'; bodyText: string; bodyExamples: string[]; variables: string[]; buttons: TemplateButton[] }[] = [
  { name: 'confirmacao_reuniao', category: 'UTILITY', bodyText: 'Olá {{1}}, sua reunião com {{2}} está confirmada para {{3}} às {{4}}. Responda *REMARCAR* se precisar de outro horário.', bodyExamples: ['Maria', 'Alberto', '15/12', '14:00'], variables: ['nome', 'consultor', 'data', 'hora'], buttons: [] },
  { name: 'lembrete_reuniao', category: 'UTILITY', bodyText: 'Olá {{1}}, lembrando da nossa conversa amanhã às {{2}}. Posso confirmar sua presença?', bodyExamples: ['Maria', '14:00'], variables: ['nome', 'hora'], buttons: [] },
  { name: 'remarcar_reuniao', category: 'UTILITY', bodyText: 'Olá {{1}}, vamos remarcar sua reunião? Me diga o melhor dia e horário e eu ajusto na agenda.', bodyExamples: ['Maria'], variables: ['nome'], buttons: [] },
  { name: 'retomada_contato', category: 'MARKETING', bodyText: 'Olá {{1}}, aqui é da equipe de {{2}}. Você pediu informações sobre planos de saúde e ficou uma dúvida em aberto. Quer retomar a conversa?', bodyExamples: ['Maria', 'Alberto Apolinário Corretor'], variables: ['nome', 'corretora'], buttons: [{ type: 'QUICK_REPLY', text: 'Sim, quero' }, { type: 'QUICK_REPLY', text: 'Agora não' }] },
  { name: 'abertura_contato_optin', category: 'MARKETING', bodyText: 'Olá {{1}}, tudo bem? Vi que você demonstrou interesse em revisar o seu plano de saúde. Posso te explicar em poucos minutos como funciona a análise, sem compromisso?', bodyExamples: ['Maria'], variables: ['nome'], buttons: [{ type: 'QUICK_REPLY', text: 'Pode explicar' }, { type: 'QUICK_REPLY', text: 'Agora não' }] },
]
