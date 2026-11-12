import { createParamDecorator, ExecutionContext } from '@nestjs/common'
import { resolveClientIpOrEmpty } from 'src/shared/util/client-ip.util'
import { CdnGeo, resolveCdnGeo } from 'src/shared/util/cdn-geo.util'

/**
 * Proveniência da requisição HTTP OBSERVADA PELO SERVIDOR — usada para inferir a origem de
 * leads que chegam por webhook/POST server-to-server (sem navegador, portanto sem sinal de
 * origem no body).
 *
 * IMPORTANTE: `refererUrl`, `originHost`, `userAgent` e `host` vêm de headers que o cliente
 * controla. São metadado analítico — NÃO usar para autorização/decisão de segurança.
 *
 * `ip` é a exceção: sai de `resolveClientIp`, que conta a cadeia do `X-Forwarded-For` da
 * direita para a esquerda pulando proxy nosso. Antes daqui saía `x-forwarded-for[0]`, que é
 * a ponta que o cliente escreve — quem mandasse o header na mão aparecia como o IP que
 * quisesse em `Leads.leadIp`.
 */
export interface RequestProvenanceData {
  /** URL da página que originou a requisição (header `Referer`), quando há navegador. */
  refererUrl: string
  /** Origem CORS (header `Origin`, apenas esquema+host), quando há navegador. */
  originHost: string
  /** User-Agent do remetente. */
  userAgent: string
  /** IP do remetente (melhor esforço a partir dos headers de proxy). */
  ip: string
  /** Host alvo da requisição. */
  host: string
  /**
   * Cidade/estado que a borda de CDN informou sobre o visitante, quando ela esteve no caminho.
   *
   * Também é a exceção da regra acima: sai de `resolveCdnGeo`, que só lê os headers `cf-*`
   * quando a âncora prova que a requisição passou por uma borda nossa. `null` quando não
   * houve CDN ou quando o managed transform da zona está desligado.
   */
  cdnGeo: CdnGeo | null
}

export const RequestProvenance = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): RequestProvenanceData => {
    const request = ctx.switchToHttp().getRequest()
    const headers = request?.headers ?? {}

    return {
      refererUrl: (headers['referer'] || headers['referrer'] || '').toString(),
      originHost: (headers['origin'] || '').toString(),
      userAgent: (headers['user-agent'] || '').toString(),
      ip: resolveClientIpOrEmpty(request),
      host: (headers['host'] || '').toString(),
      cdnGeo: resolveCdnGeo(request),
    }
  },
)
