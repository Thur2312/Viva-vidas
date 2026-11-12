import { createHash } from 'crypto'

/**
 * Captura do CORPO CRU para validacao de assinatura.
 *
 * POR QUE E UM ARQUIVO PROPRIO: isto vivia inline no `verify` do body-parser em `main.ts`,
 * onde nao dava para testar e onde a allowlist ja dessincronizou duas vezes — cada vez
 * derrubando webhook legitimo em silencio (`/api/meta-leads` e `/api/whatsapp-meta` ficaram
 * de fora e a Meta passou a ter assinatura "invalida"). Fora do `main.ts`, a lista vira dado
 * conferivel por teste.
 */

/**
 * Toda rota que valida HMAC sobre o corpo PRECISA estar aqui.
 *
 * O `verify` do body-parser so roda para as rotas listadas — de proposito: guardar o corpo
 * cru de TODA requisicao dobraria a memoria por request sem servir a ninguem.
 *
 * ⚠️ Rota nova que valide assinatura e nao entre nesta lista falha com "assinatura invalida"
 * ou 500 de misconfiguration, e o log aponta para o provedor em vez de para cá.
 */
export const WEBHOOK_RAW_BODY_PREFIXES: readonly string[] = [
  '/api/meta-leads',
  '/api/whatsapp-meta',
]

/** Header com o sha256 que a borda anuncia ter enviado. */
export const BODY_SHA256_HEADER = 'x-hdm-body-sha256'

export function needsRawBody(url: string | undefined): boolean {
  return !!url && WEBHOOK_RAW_BODY_PREFIXES.some(prefix => url.startsWith(prefix))
}

export interface RawBodyTarget {
  url?: string
  headers?: Record<string, unknown>
  rawBody?: Buffer
}

/**
 * Grava `req.rawBody` e confere a ancora de integridade.
 *
 * **Grava BUFFER, nao string.** `buf.toString('utf8')` decodifica como UTF-8 e troca qualquer
 * byte invalido por U+FFFD — `0xFF` vira `EF BF BD` — de forma IRREVERSIVEL. O HMAC passa
 * entao a ser calculado sobre lixo e o webhook legitimo e recusado com 401, em silencio.
 * Medido: corpo JSON com byte invalido e SEM charset declarado atravessa o parser (200) com o
 * rawBody ja corrompido. (Charset nao-UTF-8 DECLARADO e outro caso — o body-parser recusa com
 * 415, que e falha alta e clara, nao corrupcao silenciosa.)
 *
 * A verificacao de integridade **nunca recusa a requisicao**: o alarme e para NOS. Recusar
 * transformaria um problema nosso em falha do provedor — e para o Asaas, 15 falhas
 * consecutivas pausam a fila do cliente e o que passar de 14 dias e descartado. Divergencia
 * aqui significa que algo no caminho mexeu nos bytes, e o lugar de descobrir isso e o log.
 *
 * @returns `null` quando integro (ou quando nao ha o que conferir); a mensagem de erro quando
 *   divergiu — devolvida em vez de logada aqui para o util nao depender de logger.
 */
export function captureRawBody(req: RawBodyTarget, buf: Buffer): string | null {
  if (!needsRawBody(req.url)) return null

  req.rawBody = buf

  const anunciado = req.headers?.[BODY_SHA256_HEADER]
  if (typeof anunciado !== 'string' || !anunciado) return null

  const recebido = createHash('sha256').update(buf).digest('hex')
  if (recebido === anunciado) return null

  return (
    `[integridade] corpo divergiu no caminho url=${req.url} bytes=${buf.length} ` +
    `anunciado=${anunciado.slice(0, 16)}… recebido=${recebido.slice(0, 16)}…`
  )
}
