export type HandoffReason =
  | 'pediu_humano'
  | 'saude'
  | 'sem_base'
  | 'nao_entendeu'
  | 'playbook_incompleto'
  | 'guardacorpo'

export type Action =
  | { tipo: 'perguntar_campo'; campo: string }
  | { tipo: 'tratar_objecao'; objecaoId: string }
  | { tipo: 'responder_duvida'; fatoId: string }
  | { tipo: 'propor_horario' }
  | { tipo: 'repassar_humano'; motivo: HandoffReason }
  | { tipo: 'aguardar' }

export interface ProfileEntry {
  valor: string | number | boolean
  confianca: number
  msgId: string
}

export type Profile = Record<string, ProfileEntry>

export type PredicateOp = 'eq' | 'gt' | 'gte' | 'lt' | 'lte' | 'presente' | 'ausente'

export type Predicate =
  | { all?: Predicate[]; any?: Predicate[] }
  | { campo: string; op: PredicateOp; valor?: string | number | boolean }

export interface ProfileField {
  chave: string
  pergunta: string
  porque: string
  obrigatorio: boolean
  ordem: number
  sensivel: boolean
  valores?: string[]
}

export interface Objection {
  id: string
  gatilho: string
  resposta: string
  nuncaDizer: string[]
}

export interface ApprovedFact {
  id: string
  texto: string
}

export interface PlaybookData {
  oferta: { descricao: string; publico: string }
  campos: ProfileField[]
  criterios: { qualificado?: Predicate; desqualificado?: Predicate }
  objecoes: Objection[]
  fatos: ApprovedFact[]
  tom: { formalidade: string; tamanho: string; emoji: string; frases: string[] }
  regrasProibidas: string[]
  passagemHumano: { quando: string[] }
  agenda: { tiposReuniao: string[]; duracaoMin: number; janelas: string; prometer: string }
  cadencia: { maxTentativas: number; mensagem: string }
  /** Instruções e exemplos rotulados "EXEMPLO (não ativo)"; nunca conteúdo usável. */
  exemplos?: Record<string, string>
}
