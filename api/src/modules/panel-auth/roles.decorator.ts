import { SetMetadata } from '@nestjs/common'
import { PanelRole } from './panel-roles'

export const ROLES_KEY = 'panelRoles'

/**
 * Papel MINIMO exigido (hierarquia owner > manager > viewer).
 * `@Roles('manager')` libera manager e owner; `@Roles('viewer')` libera todos os autenticados.
 * Se varios papeis forem listados vale o menor. Sem @Roles a rota so exige token valido.
 */
export const Roles = (...roles: PanelRole[]) => SetMetadata(ROLES_KEY, roles)
