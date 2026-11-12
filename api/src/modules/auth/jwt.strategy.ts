import { Injectable, UnauthorizedException } from '@nestjs/common'
import { PassportStrategy } from '@nestjs/passport'
import { ExtractJwt, Strategy } from 'passport-jwt'
import { ACCESS_TOKEN_ISSUER, isPanelRole } from '../panel-auth/panel-roles'

/**
 * Valida o access token do painel (emitido por `panel-auth`): HS256 FIXO (alg none e demais
 * algoritmos sao recusados), assinado com SECRETKEY, emissor conferido, expiracao obrigatoria.
 * So Bearer (sem cookie: nao ha CSRF a considerar).
 *
 * `req.user`: { id, sub, tenant, role, ... } — `companyMember` fica vazio de proposito: este
 * backend nao tem multi-empresa, entao o TenantGuard nunca libera um companyId arbitrario.
 */
export interface JwtPayload {
  sub: string
  tenant: string
  role: string
  iss?: string
  exp?: number
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.SECRETKEY,
      algorithms: ['HS256'],
      issuer: ACCESS_TOKEN_ISSUER,
    })
  }

  async validate(payload: JwtPayload) {
    // exp obrigatorio: token sem expiracao nunca e aceito.
    if (!payload || typeof payload.exp !== 'number' || typeof payload.sub !== 'string' || typeof payload.tenant !== 'string' || !isPanelRole(payload.role)) {
      throw new UnauthorizedException('Invalid token')
    }
    return {
      id: payload.sub,
      sub: payload.sub,
      tenant: payload.tenant,
      role: payload.role,
      jwtRole: payload.role,
      companyMember: [],
      effectiveMemberships: [],
    }
  }
}
