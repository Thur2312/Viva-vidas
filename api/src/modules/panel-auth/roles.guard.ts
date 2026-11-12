import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { IS_PUBLIC_KEY } from '../auth/public.decorator'
import { ROLES_KEY } from './roles.decorator'
import { PanelRole, ROLE_RANK, isPanelRole } from './panel-roles'

/** Global (APP_GUARD), depois do JwtAuthGuard. Rotas @Public() e sem @Roles passam. */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const targets = [ctx.getHandler(), ctx.getClass()]
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) return true
    const required = this.reflector.getAllAndOverride<PanelRole[]>(ROLES_KEY, targets)
    if (!required?.length) return true

    const role = ctx.switchToHttp().getRequest().user?.role
    // Falha fechada: sem usuario/papel valido ou papel desconhecido => 403.
    if (!isPanelRole(role)) throw new ForbiddenException('Acesso negado')
    const min = Math.min(...required.map((r) => ROLE_RANK[r] ?? Infinity))
    if (ROLE_RANK[role] < min) throw new ForbiddenException('Acesso negado')
    return true
  }
}
