import { Injectable, UnauthorizedException } from '@nestjs/common'
import { PassportStrategy } from '@nestjs/passport'
import { ExtractJwt, Strategy } from 'passport-jwt'
import { ACCESS_TOKEN_ISSUER, isPanelRole } from '../panel-auth/panel-roles'
import { SessionStateService } from '../panel-auth/session-state.service'

/**
 * Valida o access token do painel (emitido por `panel-auth`): HS256 FIXO (alg none e demais
 * algoritmos sao recusados), assinado com SECRETKEY, emissor conferido, expiracao obrigatoria.
 * So Bearer (sem cookie: nao ha CSRF a considerar).
 *
 * Alem da assinatura, confere no banco (com cache de poucos segundos, ver SessionStateService) que o usuario
 * continua ativo e que a `token_version` do token e a atual. Assim, redefinir a senha ou desativar a conta
 * derruba os tokens ja emitidos em segundos, nao em 15 min. O PAPEL vem do banco, nao do token: rebaixar vale na hora.
 *
 * `req.user`: { id, sub, tenant, role, ... } — `companyMember` fica vazio de proposito: este
 * backend nao tem multi-empresa, entao o TenantGuard nunca libera um companyId arbitrario.
 */
export interface JwtPayload {
  sub: string
  tenant: string
  role: string
  tv?: number
  iss?: string
  exp?: number
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly sessions: SessionStateService) {
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
    // Token antigo (sem `tv`) conta como versao 0, igual ao DEFAULT da coluna: o deploy nao desloga ninguem.
    const tv = payload.tv === undefined ? 0 : payload.tv
    const state = await this.sessions.get(payload.sub)
    if (!state || !state.active || !Number.isInteger(tv) || state.tokenVersion !== tv) throw new UnauthorizedException('Invalid token')
    return {
      id: payload.sub,
      sub: payload.sub,
      tenant: state.tenant,
      role: state.role,
      jwtRole: state.role,
      companyMember: [],
      effectiveMemberships: [],
    }
  }
}
