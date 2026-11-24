import { PlaybookData, Predicate } from './types'

export interface PlaybookCompleteness {
  complete: boolean
  missing: string[]
}

// Robusto a dado cru (API/linha legada): não-string conta como vazio, não-lista como lista vazia. Nunca lança.
const vazio = (s: unknown) => typeof s !== 'string' || s.trim() === ''
const lista = <T>(v: unknown): T[] => (Array.isArray(v) ? (v.filter((x) => x && typeof x === 'object') as T[]) : [])
const positivo = (v: unknown) => typeof v === 'number' && v > 0

function predicateErrors(p: Predicate, chaves: Set<string>, rotulo: string, out: string[]) {
  if (!p || typeof p !== 'object') {
    out.push(`criterios: ${rotulo} inválido`)
    return
  }
  if ('campo' in p) {
    if (typeof p.campo !== 'string' || !chaves.has(p.campo)) out.push(`criterios: ${rotulo} usa campo inexistente (${String(p.campo)})`)
    return
  }
  const filhos = [...lista<Predicate>(p.all), ...lista<Predicate>(p.any)]
  if (filhos.length === 0) out.push(`criterios: ${rotulo} está vazio`)
  for (const f of filhos) predicateErrors(f, chaves, rotulo, out)
}

export const MIN_LIVRE = 200

export function validatePlaybook(raw: PlaybookData): PlaybookCompleteness {
  const missing: string[] = []
  const d = (raw && typeof raw === 'object' ? raw : {}) as Partial<PlaybookData>

  // Modo livre: o texto do dono basta (sem formulário). Texto curto demais não orienta nada.
  if (typeof d.livre === 'string' && d.livre.trim().length > 0) {
    return d.livre.trim().length >= MIN_LIVRE ? { complete: true, missing: [] } : { complete: false, missing: [`livre: escreva ao menos ${MIN_LIVRE} caracteres`] }
  }

  if (vazio(d.oferta?.descricao)) missing.push('oferta: descreva o que a corretora vende')
  if (vazio(d.oferta?.publico)) missing.push('oferta: informe o público')

  const campos = lista<PlaybookData['campos'][number]>(d.campos)
  if (campos.length === 0) missing.push('campos: cadastre ao menos um campo de qualificação')
  const vistas = new Set<string>()
  const duplicadas = new Set<string>()
  for (const c of campos) {
    if (vazio(c.chave)) missing.push('campos: há campo sem chave')
    else if (vistas.has(c.chave)) duplicadas.add(c.chave)
    vistas.add(c.chave)
    if (!c.sensivel && vazio(c.pergunta)) missing.push(`campos: falta a pergunta (${c.chave})`)
    if (c.sensivel && c.obrigatorio) missing.push(`campos: campo sensível não pode ser obrigatório (${c.chave})`)
  }
  for (const k of duplicadas) missing.push(`campos: chave duplicada (${k})`)
  if (campos.length > 0 && !campos.some((c) => c.obrigatorio && !c.sensivel)) {
    missing.push('campos: marque ao menos um campo obrigatório')
  }

  const chaves = new Set(campos.map((c) => c.chave).filter((k): k is string => typeof k === 'string'))
  if (!d.criterios?.qualificado) missing.push('criterios: defina quando o lead é qualificado')
  else predicateErrors(d.criterios.qualificado, chaves, 'qualificado', missing)
  if (d.criterios?.desqualificado) predicateErrors(d.criterios.desqualificado, chaves, 'desqualificado', missing)

  const objecoes = lista<PlaybookData['objecoes'][number]>(d.objecoes)
  if (objecoes.length === 0) missing.push('objecoes: cadastre ao menos uma objeção')
  for (const o of objecoes) {
    if (vazio(o.gatilho) || vazio(o.resposta)) missing.push(`objecoes: preencha gatilho e resposta (${o.id})`)
  }

  const fatos = lista<PlaybookData['fatos'][number]>(d.fatos)
  if (fatos.length === 0) missing.push('fatos: cadastre ao menos um fato aprovado')
  for (const f of fatos) if (vazio(f.texto)) missing.push(`fatos: texto vazio (${f.id})`)

  if (vazio(d.tom?.formalidade)) missing.push('tom: informe a formalidade')
  const textos = (v: unknown) => (Array.isArray(v) ? v : [])
  if (textos(d.passagemHumano?.quando).length === 0) missing.push('passagemHumano: informe quando repassar para uma pessoa')
  if (textos(d.agenda?.tiposReuniao).length === 0) missing.push('agenda: informe os tipos de reunião')
  if (!positivo(d.agenda?.duracaoMin)) missing.push('agenda: informe a duração da reunião')
  if (!positivo(d.cadencia?.maxTentativas)) missing.push('cadencia: informe o número de tentativas')

  return { complete: missing.length === 0, missing }
}
