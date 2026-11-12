import { Db } from '../pg.service'
import { RequestCtx } from './audit.service'

/**
 * Gancho para módulos que guardam dado pessoal derivado de um lead fora do núcleo do piloto (ex.: voz).
 * O DataSubjectService e o RetentionService chamam os ganchos registrados, sem importar o módulo dono
 * (evita dependência circular). Registro em memória, idempotente por `name`.
 *
 * Contrato: cada gancho deve ser idempotente (repetir conclui o trabalho) e falhar ALTO: se não conseguir
 * apagar o dado (ex.: gravação no provedor), lança erro e o pedido do titular fica `em_andamento`.
 */
export interface SubjectDataHook {
  name: string
  /** Dados do lead para o pedido de acesso (art. 18, II). Sem segredos (nada de URL/ref de gravação). */
  exportLead?(leadId: string, db: Db): Promise<unknown>
  /** Antes da anonimização: apaga transcrições/gravações. Devolve contadores para a auditoria. */
  anonymizeLead?(leadId: string, ctx: RequestCtx, db: Db): Promise<Record<string, number>>
  /** Antes de apagar o lead (as linhas caem por cascata; o que está fora do banco precisa ser apagado aqui). */
  eraseLead?(leadId: string, ctx: RequestCtx, db: Db): Promise<Record<string, number>>
  /** Chamado pela retenção diária. */
  purgeExpired?(now: Date, ctx: RequestCtx, db: Db): Promise<Record<string, number>>
}

const hooks = new Map<string, SubjectDataHook>()

export function registerSubjectHook(h: SubjectDataHook) {
  hooks.set(h.name, h)
}
export function subjectHooks(): SubjectDataHook[] {
  return [...hooks.values()]
}
export function clearSubjectHooks() {
  hooks.clear()
}
