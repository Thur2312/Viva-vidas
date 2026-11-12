export interface MetaAuthError {
  code: number
  subcode: number | null
  message: string
}

/**
 * Reconhece erro de AUTENTICAÇÃO da Graph API — OAuthException code 190 (token
 * revogado: troca de senha do Facebook = subcode 460, app desautorizado = 458,
 * expirado = 463) e code 102 (sessão inválida) — nos formatos que o codebase produz:
 *  - erro axios:           err.response.data.error   (tracking-sender / dataset-quality)
 *  - response axios crua:  err.data.error
 *  - corpo json de fetch:  { error: { ... } }         (probe do oauth service)
 *
 * Qualquer outra coisa (rate limit, payload inválido, 5xx…) devolve null: esses
 * erros NÃO significam token morto e não podem marcar a integração como inválida.
 */
export function getMetaAuthError(err: any): MetaAuthError | null {
  const candidate = err?.response?.data?.error ?? err?.data?.error ?? err?.error ?? null
  if (!candidate || typeof candidate !== 'object') return null

  const code = Number(candidate.code)
  if (code !== 190 && code !== 102) return null

  return {
    code,
    subcode: candidate.error_subcode != null ? Number(candidate.error_subcode) : null,
    message: candidate.message || 'OAuthException',
  }
}
