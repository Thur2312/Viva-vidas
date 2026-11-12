import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common'
import { timingSafeEqual } from 'crypto'

/**
 * Autenticação servidor a servidor para o chat e o agente enviarem mensagens e eventos.
 * Cabeçalho: x-pilot-key. Sem PILOT_API_KEY configurada, as rotas ficam FECHADAS.
 */
@Injectable()
export class PilotKeyGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const expected = process.env.PILOT_API_KEY
    const got = ctx.switchToHttp().getRequest().headers?.['x-pilot-key']
    if (!expected || typeof got !== 'string') throw new UnauthorizedException('Chave inválida')
    const a = Buffer.from(got)
    const b = Buffer.from(expected)
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new UnauthorizedException('Chave inválida')
    return true
  }
}
