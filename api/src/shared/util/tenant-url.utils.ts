/**
 * Compõe a URL base do tenant a partir do subdomain.
 * Retorna fallback (tipicamente FRONTEND_URL) se subdomain ausente.
 *
 * TENANT_BASE_DOMAIN é a MESMA variável que o CloudflareDnsService usa para
 * montar o FQDN do CNAME — as duas precisam concordar, senão o link apontaria
 * para um domínio diferente do que foi provisionado. Sem default: vazia => fallback.
 */
export function buildTenantBaseUrl(
  subdomain: string | null | undefined,
  fallback: string,
): string {
  if (!subdomain) return fallback
  // Sem default embutido: sem TENANT_BASE_DOMAIN cai no fallback (FRONTEND_URL).
  const baseDomain = (process.env.TENANT_BASE_DOMAIN ?? '').trim()
  if (!baseDomain) return fallback
  return `https://${subdomain}.${baseDomain}`
}
