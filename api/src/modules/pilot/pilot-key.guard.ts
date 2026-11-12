import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common'
import { createHmac, timingSafeEqual } from 'crypto'

/** Tolerancia entre o relogio do chat e o da API. Fora disso a requisicao e tratada como repeticao (replay). */
export const SIGNATURE_MAX_SKEW_SECONDS = 300

const same = (a: string, b: string) => {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

/** Assinatura esperada: HMAC-SHA256(PILOT_API_KEY, `${timestamp}.${corpo cru}`) em hexadecimal. */
export function pilotSignature(key: string, timestamp: string, rawBody: Buffer | string): string {
  return createHmac('sha256', key).update(`${timestamp}.`).update(rawBody).digest('hex')
}

/**
 * Autenticação servidor a servidor para o chat e o agente enviarem mensagens e eventos.
 * Cabeçalho: x-pilot-key. Sem PILOT_API_KEY configurada, as rotas ficam FECHADAS.
 *
 * Com PILOT_SIGNING_REQUIRED=true, alem da chave exige x-pilot-timestamp (epoch em segundos, +-5 min) e
 * x-pilot-signature (ver pilotSignature). Assim uma chave vazada sozinha nao basta e uma requisicao capturada
 * nao pode ser reenviada depois da janela. Desligado por padrao ate o chat passar a assinar.
 */
@Injectable()
export class PilotKeyGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const expected = process.env.PILOT_API_KEY
    const req = ctx.switchToHttp().getRequest()
    const got = req.headers?.['x-pilot-key']
    if (!expected || typeof got !== 'string' || !same(got, expected)) throw new UnauthorizedException('Chave inválida')

    if (process.env.PILOT_SIGNING_REQUIRED === 'true') {
      const ts = req.headers?.['x-pilot-timestamp']
      const sig = req.headers?.['x-pilot-signature']
      const raw: Buffer | undefined = req.rawBody
      const age = typeof ts === 'string' && /^\d{1,12}$/.test(ts) ? Math.abs(Date.now() / 1000 - Number(ts)) : Infinity
      // Corpo vazio e valido (ex.: POST sem payload); sem rawBody capturado a assinatura nao e verificavel.
      if (!raw || typeof sig !== 'string' || age > SIGNATURE_MAX_SKEW_SECONDS || !same(sig, pilotSignature(expected, ts as string, raw))) {
        throw new UnauthorizedException('Assinatura inválida')
      }
    }
    return true
  }
}
