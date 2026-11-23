import { validatePlaybook } from './playbook.validate'
import { evalPredicate } from './profile'
import { Action, PlaybookData, Profile } from './types'

export interface PolicyInput {
  playbook: PlaybookData | null
  profile: Profile
  signals: {
    pediuHumano: boolean
    falouSaude: boolean
    naoEntendeu: boolean
    objecaoId: string | null
    perguntaFatoId: string | null
  }
  failedUnderstandingStreak: number
}

const repassar = (motivo: Extract<Action, { tipo: 'repassar_humano' }>['motivo']): Action => ({
  tipo: 'repassar_humano',
  motivo,
})

/** Decide a próxima ação. Código puro e determinístico, sem I/O nem LLM. */
export function decideAction(i: PolicyInput): Action {
  const { playbook, profile, signals } = i
  if (!playbook || !validatePlaybook(playbook).complete) return repassar('playbook_incompleto')
  if (signals.pediuHumano) return repassar('pediu_humano')
  if (signals.falouSaude) return repassar('saude')
  if (i.failedUnderstandingStreak >= 2) return repassar('nao_entendeu')

  if (signals.objecaoId) {
    const conhecida = playbook.objecoes.some((o) => o.id === signals.objecaoId)
    return conhecida ? { tipo: 'tratar_objecao', objecaoId: signals.objecaoId } : repassar('sem_base')
  }
  if (signals.perguntaFatoId) {
    const conhecido = playbook.fatos.some((f) => f.id === signals.perguntaFatoId)
    return conhecido ? { tipo: 'responder_duvida', fatoId: signals.perguntaFatoId } : repassar('sem_base')
  }

  const { qualificado, desqualificado } = playbook.criterios
  if (desqualificado && evalPredicate(desqualificado, profile) === true) return { tipo: 'aguardar' }
  if (qualificado && evalPredicate(qualificado, profile) === true) return { tipo: 'propor_horario' }

  const proximo = playbook.campos
    .filter((c) => c.obrigatorio && !c.sensivel && !profile[c.chave])
    .sort((a, b) => a.ordem - b.ordem)[0]
  if (proximo) return { tipo: 'perguntar_campo', campo: proximo.chave }

  return { tipo: 'propor_horario' }
}
