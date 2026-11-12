import { createHmac, timingSafeEqual } from 'crypto'

/**
 * Assinatura de webhook do Twilio (X-Twilio-Signature), implementada à mão conforme a especificação pública:
 * HMAC-SHA1(authToken, URL completa + concatenação, em ordem alfabética das chaves, de "chave+valor" dos
 * parâmetros do POST), em base64. Sem SDK: o algoritmo cabe em poucas linhas e evita uma dependência grande.
 * A comparação é em tempo constante. UNTESTED contra o Twilio real (só contra o algoritmo documentado).
 */
export function twilioSignature(authToken: string, url: string, params: Record<string, string>): string {
  const data = Object.keys(params).sort().reduce((acc, k) => acc + k + params[k], url)
  return createHmac('sha1', authToken).update(Buffer.from(data, 'utf8')).digest('base64')
}

export function validateTwilioSignature(authToken: string, url: string, params: Record<string, string>, header: string | undefined): boolean {
  if (!authToken || !header) return false
  const expected = Buffer.from(twilioSignature(authToken, url, params))
  const got = Buffer.from(header)
  return expected.length === got.length && timingSafeEqual(expected, got)
}
