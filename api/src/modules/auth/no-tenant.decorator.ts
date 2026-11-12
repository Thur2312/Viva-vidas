import { SetMetadata } from '@nestjs/common'

export const NO_TENANT_KEY = 'isNoTenant'

/**
 * Marca uma rota como GENUINAMENTE não multi-tenant.
 *
 * Existe por causa da inversão do TenantGuard. Antes, ele LIBERAVA quando não
 * achava `companyId` no request — e como a proteção depende da convenção de
 * nomear o parâmetro `companyId` em vez de `id`, qualquer rota que escorregasse
 * dessa convenção ficava sem isolamento nenhum, em silêncio. A convenção está
 * documentada em companies-management.controller.ts:88-106 e é violada no
 * próprio arquivo que a documenta.
 *
 * Com o default invertido, "esqueci de escopar" vira 403 em vez de vazamento, e
 * a exceção passa a ser explícita e revisável: quem marca com @NoTenant() está
 * afirmando que a rota não pertence a nenhuma empresa.
 *
 * Use APENAS em: health checks, catálogos globais (já protegidos por
 * SystemAdminGuard), configuração pública e rotas cujo tenant é resolvido por
 * outro mecanismo comprovado (webhook com segredo, chave de API por subdomínio).
 *
 * NÃO use para silenciar um 403 — se a rota lê ou escreve dado de empresa, o
 * certo é escopar a query, não marcar a exceção.
 */
export const NoTenant = () => SetMetadata(NO_TENANT_KEY, true)
