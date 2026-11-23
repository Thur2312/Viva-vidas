import { PlaybookData, Predicate } from './types'

export interface PlaybookCompleteness {
  complete: boolean
  missing: string[]
}

const vazio = (s: string | undefined) => !s || s.trim() === ''

function predicateErrors(p: Predicate, chaves: Set<string>, rotulo: string, out: string[]) {
  if ('campo' in p) {
    if (!chaves.has(p.campo)) out.push(`criterios: ${rotulo} usa campo inexistente (${p.campo})`)
    return
  }
  const filhos = [...(p.all ?? []), ...(p.any ?? [])]
  if (filhos.length === 0) out.push(`criterios: ${rotulo} está vazio`)
  for (const f of filhos) predicateErrors(f, chaves, rotulo, out)
}

export function validatePlaybook(d: PlaybookData): PlaybookCompleteness {
  const missing: string[] = []

  if (vazio(d.oferta?.descricao)) missing.push('oferta: descreva o que a corretora vende')
  if (vazio(d.oferta?.publico)) missing.push('oferta: informe o público')

  const campos = d.campos ?? []
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

  const chaves = new Set(campos.map((c) => c.chave))
  if (!d.criterios?.qualificado) missing.push('criterios: defina quando o lead é qualificado')
  else predicateErrors(d.criterios.qualificado, chaves, 'qualificado', missing)
  if (d.criterios?.desqualificado) predicateErrors(d.criterios.desqualificado, chaves, 'desqualificado', missing)

  const objecoes = d.objecoes ?? []
  if (objecoes.length === 0) missing.push('objecoes: cadastre ao menos uma objeção')
  for (const o of objecoes) {
    if (vazio(o.gatilho) || vazio(o.resposta)) missing.push(`objecoes: preencha gatilho e resposta (${o.id})`)
  }

  const fatos = d.fatos ?? []
  if (fatos.length === 0) missing.push('fatos: cadastre ao menos um fato aprovado')
  for (const f of fatos) if (vazio(f.texto)) missing.push(`fatos: texto vazio (${f.id})`)

  if (vazio(d.tom?.formalidade)) missing.push('tom: informe a formalidade')
  if ((d.passagemHumano?.quando ?? []).length === 0) missing.push('passagemHumano: informe quando repassar para uma pessoa')
  if ((d.agenda?.tiposReuniao ?? []).length === 0) missing.push('agenda: informe os tipos de reunião')
  if (!(d.agenda?.duracaoMin > 0)) missing.push('agenda: informe a duração da reunião')
  if (!(d.cadencia?.maxTentativas > 0)) missing.push('cadencia: informe o número de tentativas')

  return { complete: missing.length === 0, missing }
}
