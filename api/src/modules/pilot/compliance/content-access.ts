import { ROLE_RANK, isPanelRole } from '../../panel-auth/panel-roles'

/** Texto que substitui o conteudo para quem nao pode le-lo. */
export const RESTRICTED_TEXT = '[conteúdo restrito ao gestor]'

/**
 * Conteudo de conversa pode revelar dado de saude (LGPD art. 11, corretora de planos). So manager ou owner le;
 * viewer ve que a mensagem existe (autor, direcao, horario), nao o texto. Mesma regra da transcricao de voz.
 */
export function canReadContent(req: any): boolean {
  const role = req?.user?.role
  return isPanelRole(role) && ROLE_RANK[role] >= ROLE_RANK.manager
}
