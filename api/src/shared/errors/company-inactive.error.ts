/**
 * Empresa desativada recebendo evento de entrada (webhook, pixel, formulario).
 *
 * NAO estende HttpException de proposito: quem lanca isto nao decide o codigo de
 * resposta. Nas superficies autenticadas o desligamento vira 403; nas de
 * webhook, o CompanyInactiveFilter converte para 200 — ver o filtro para o
 * porque.
 */
export class CompanyInactiveError extends Error {
  constructor(
    /** Subdominio ou id da empresa, o que o chamador tiver em maos. */
    readonly company: string,
    /** Provedor/origem do evento, so para o log. */
    readonly source?: string,
  ) {
    super(`Empresa inativa: ${company}`)
    this.name = 'CompanyInactiveError'
  }
}
