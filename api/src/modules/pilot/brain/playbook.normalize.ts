import { ApprovedFact, Objection, PlaybookData, Predicate, PredicateOp, ProfileField } from './types'

// Porta de normalizePlaybook do painel (web/src/components/agente/playbook-api.ts). O DTO só exige
// "objeto"; tudo que vem da API ou de uma linha legada passa por aqui antes de validar, renderizar,
// gravar ou chegar ao cérebro, para nenhum campo faltante virar TypeError nos prompts.

const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v)
const str = (v: unknown) => (typeof v === 'string' ? v : '')
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0)
const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
const objs = (v: unknown): Record<string, any>[] => (Array.isArray(v) ? v.filter(isObj) : [])

const OPS = new Set<PredicateOp>(['eq', 'gt', 'gte', 'lt', 'lte', 'presente', 'ausente'])

/** Predicado válido ou undefined: folha com campo string e operador conhecido; grupo com all/any. */
export function normalizePredicate(p: unknown): Predicate | undefined {
  if (!isObj(p)) return undefined
  if ('campo' in p) {
    if (typeof p.campo !== 'string' || !OPS.has(p.op)) return undefined
    const v = p.valor
    const valorOk = typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v))
    if (p.op === 'presente' || p.op === 'ausente' || !valorOk) return { campo: p.campo, op: p.op }
    return { campo: p.campo, op: p.op, valor: v }
  }
  const group = (v: unknown) => (Array.isArray(v) ? v.map(normalizePredicate).filter((x): x is Predicate => !!x) : undefined)
  const all = group(p.all)
  const any = group(p.any)
  if (!all && !any) return undefined
  // Grupo que ficou vazio é mantido: a validação aponta "está vazio" em vez de sumir com o critério.
  return { ...(all ? { all } : {}), ...(any ? { any } : {}) }
}

/** Copia só as chaves conhecidas, com tipos coagidos e padrões. Ignora `exemplos` (nunca vira conteúdo). */
export function normalizePlaybook(raw: unknown): PlaybookData {
  const x = isObj(raw) ? raw : {}
  const oferta = isObj(x.oferta) ? x.oferta : {}
  const criterios = isObj(x.criterios) ? x.criterios : {}
  const tom = isObj(x.tom) ? x.tom : {}
  const passagem = isObj(x.passagemHumano) ? x.passagemHumano : {}
  const agenda = isObj(x.agenda) ? x.agenda : {}
  const cadencia = isObj(x.cadencia) ? x.cadencia : {}
  const qualificado = normalizePredicate(criterios.qualificado)
  const desqualificado = normalizePredicate(criterios.desqualificado)
  return {
    oferta: { descricao: str(oferta.descricao), publico: str(oferta.publico) },
    campos: objs(x.campos).map((c): ProfileField => {
      const valores = strs(c.valores)
      return {
        chave: str(c.chave),
        pergunta: str(c.pergunta),
        porque: str(c.porque),
        obrigatorio: c.sensivel ? false : !!c.obrigatorio,
        ordem: num(c.ordem),
        sensivel: !!c.sensivel,
        ...(valores.length ? { valores } : {}),
      }
    }),
    criterios: { ...(qualificado ? { qualificado } : {}), ...(desqualificado ? { desqualificado } : {}) },
    objecoes: objs(x.objecoes).map((o): Objection => ({ id: str(o.id), gatilho: str(o.gatilho), resposta: str(o.resposta), nuncaDizer: strs(o.nuncaDizer) })),
    fatos: objs(x.fatos).map((f): ApprovedFact => ({ id: str(f.id), texto: str(f.texto) })),
    tom: { formalidade: str(tom.formalidade), tamanho: str(tom.tamanho), emoji: str(tom.emoji), frases: strs(tom.frases) },
    regrasProibidas: strs(x.regrasProibidas),
    passagemHumano: { quando: strs(passagem.quando) },
    agenda: { tiposReuniao: strs(agenda.tiposReuniao), duracaoMin: num(agenda.duracaoMin), janelas: str(agenda.janelas), prometer: str(agenda.prometer) },
    cadencia: { maxTentativas: num(cadencia.maxTentativas), mensagem: str(cadencia.mensagem) },
    ...(str(x.livre).trim() ? { livre: str(x.livre).trim().slice(0, 40_000) } : {}),
  }
}
