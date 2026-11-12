import { getMetaAuthError } from './meta-auth-error.utils'
import { META_API_BASE, META_API_VERSION } from 'src/modules/meta-ads/constants/meta-ads.constants'

/**
 * `reason` e o unico discriminante — o tsconfig do projeto roda com
 * `strictNullChecks: false`, e sob essa flag um discriminante booleano (`ok: true |
 * false`) nao estreita a uniao.
 */
export type MetaProbeResult =
  /** O token le a conta de anuncios. `accountName` vem do proprio Gerenciador. */
  | { reason: 'ok'; accountName?: string; accountStatus?: number }
  /** OAuthException 190/102 — token revogado, expirado ou app desautorizado. */
  | { reason: 'auth'; message: string }
  /** Token vivo, mas nao enxerga ESTA conta (conta errada, ou falta acesso/permissao). */
  | { reason: 'no_access'; message: string }
  /** Nao deu para decidir: rede, timeout, 5xx. Nunca e veredito sobre o token. */
  | { reason: 'network'; message: string }

/** Normaliza `1292058248233713` ou `act_1292058248233713` para a forma com prefixo. */
export function normalizeAdAccountId(raw: string): string {
  const limpo = raw.trim()
  return limpo.startsWith('act_') ? limpo : `act_${limpo}`
}

/**
 * Sonda o par (conta de anuncios, token) contra a Graph API.
 *
 * Usa `GET /{act_id}` e nao `GET /me` de proposito. Sao duas perguntas diferentes:
 * `/me` so diz que o token existe; `/{act_id}` diz que o token le A CONTA QUE O SYNC VAI
 * USAR — que e a unica coisa que importa aqui. E funciona para qualquer tipo de token,
 * inclusive System User (que nao tem pessoa por tras para o `/me` descrever).
 *
 * Distinguir `auth` de `no_access` e o que decide a mensagem para o usuario: token morto
 * pede token novo; conta invisivel pede conta certa ou acesso concedido no Business
 * Manager. Tratar os dois como "token invalido" mandava a pessoa trocar o que estava bom.
 */
export async function probeMetaCredentials(
  adAccountId: string,
  accessToken: string,
  timeoutMs = 8000,
): Promise<MetaProbeResult> {
  const conta = normalizeAdAccountId(adAccountId)
  const url =
    `${META_API_BASE}/${META_API_VERSION}/${conta}` +
    `?fields=id,name,account_status&access_token=${encodeURIComponent(accessToken)}`

  let body: any
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
    body = await resp.json()
  } catch (error: any) {
    return { reason: 'network', message: error?.message ?? 'falha de rede' }
  }

  const authError = getMetaAuthError(body)
  if (authError) {
    return { reason: 'auth', message: authError.message }
  }

  if (body?.error) {
    // 100/33 e o par que a Meta devolve para "objeto inexistente ou sem permissao" —
    // do lado de fora nao da para separar conta errada de acesso faltando.
    return {
      reason: 'no_access',
      message: body.error.message ?? 'a Meta recusou a leitura desta conta de anuncios',
    }
  }

  if (!body?.id) {
    return { reason: 'network', message: 'resposta inesperada da Meta' }
  }

  return { reason: 'ok', accountName: body.name, accountStatus: body.account_status }
}
