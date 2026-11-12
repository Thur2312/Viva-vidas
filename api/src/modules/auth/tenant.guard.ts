import { Injectable, CanActivate, ExecutionContext, ForbiddenException, Logger, UnauthorizedException } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { IS_PUBLIC_KEY } from './public.decorator'
import { NO_TENANT_KEY } from './no-tenant.decorator'

/**
 * Nucleo da validacao de tenant, extraido para poder ser chamado DE DENTRO de um handler.
 *
 * Existe por causa do multipart: no Nest os guards rodam ANTES dos interceptors, e
 * FileInterceptor e interceptor. Numa rota de upload o `companyId` vem do body multipart,
 * que ainda nao foi parseado quando o TenantGuard roda — entao o guard nao acha companyId
 * nenhum e libera. Quem precisa validar ali chama esta funcao no handler, onde o body ja
 * existe.
 *
 * UMA divergencia proposital em relacao ao guard: aqui `!user` LANCA, enquanto o guard
 * libera. Dentro de um handler o `!user` e inalcancavel (o JwtAuthGuard ja rodou), e
 * replicar a porta aberta seria contraditorio com o proposito de quem chama isto.
 *
 * As mensagens sao copiadas byte a byte das do guard, sem acento — mensagem de erro e
 * contrato com o front.
 */
export function assertCompanyAccess(req: any, companyId: string): string {
  const user = req?.user
  if (!user) throw new UnauthorizedException('Usuario nao autenticado')

  if (user.systemRole === 'ADMIN') return companyId

  // effectiveMemberships = diretas + herdadas por SUBTREE, montado no
  // jwt.strategy. Cai para companyMember quando a expansao falhou (fallback do
  // try/catch de la) ou quando o objeto veio de um caminho que nao passa pela
  // strategy. Continua SINCRONO de proposito: os 3 call sites de multipart em
  // analysis-import.controller.ts chamam esta funcao de dentro do handler.
  const memberships = Array.isArray(user.effectiveMemberships)
    ? user.effectiveMemberships
    : user.companyMember

  if (!memberships || !Array.isArray(memberships)) {
    throw new ForbiddenException('Acesso negado: usuario sem vinculo com empresas')
  }

  const belongsToCompany = memberships.some(
    (member: any) => member.companyId === companyId && member.status === 'ACTIVE',
  )

  if (!belongsToCompany) {
    throw new ForbiddenException('Acesso negado: voce nao pertence a esta empresa')
  }

  req.validatedCompanyId = companyId

  return companyId
}

/**
 * TenantGuard — valida que o companyId presente no request pertence
 * ao usuario autenticado (via companyMember[]).
 *
 * Extrai companyId de: params > query > body > header (x-company-id / company-id)
 * Se nao encontrar companyId no request, permite (rota pode nao ser multi-tenant).
 * Se encontrar e o usuario nao pertence a empresa, bloqueia com 403.
 *
 * Deve rodar DEPOIS do JwtAuthGuard (ordem importa no APP_GUARD).
 */
@Injectable()
export class TenantGuard implements CanActivate {
  private static readonly logger = new Logger(TenantGuard.name)

  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // Pula rotas @Public()
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ])
    if (isPublic) return true

    const request = context.switchToHttp().getRequest()
    const user = request.user

    // Se nao tem user (JWT falhou mas outro guard permitiu), pula
    if (!user) return true

    // System admin tem acesso a qualquer tenant
    if (user.systemRole === 'ADMIN') return true

    // Extrair companyId de todas as fontes possiveis
    const companyId = this.extractCompanyId(request)

    if (!companyId) {
      // Rota declarada como nao multi-tenant: passa.
      const isNoTenant = this.reflector.getAllAndOverride<boolean>(NO_TENANT_KEY, [
        context.getHandler(),
        context.getClass(),
      ])
      if (isNoTenant) return true

      return this.handleMissingCompanyId(context, request)
    }

    // Valida o vinculo e injeta request.validatedCompanyId
    assertCompanyAccess(request, companyId)

    return true
  }

  /**
   * O que fazer quando a rota nao carrega companyId e nao esta marcada
   * com @NoTenant().
   *
   * Historicamente isto era `return true` — fail-open. Como o isolamento depende
   * de o parametro se chamar `companyId` (e nao `id`, `memberId`, `agencyId`...),
   * qualquer rota fora da convencao ficava sem protecao nenhuma, em silencio.
   *
   * ROLLOUT EM DUAS ETAPAS, via TENANT_GUARD_ENFORCE:
   *   - ausente/'false' (default): so REGISTRA o que seria negado. Nada quebra,
   *     e o log vira o inventario das rotas que precisam de @NoTenant() ou de
   *     escopo de verdade.
   *   - 'true': NEGA. Ligar somente depois que o log estiver limpo.
   *
   * O default é o modo permissivo de proposito: inverter direto em producao
   * derrubaria rotas legitimas antes de alguem saber quais sao.
   */
  private handleMissingCompanyId(context: ExecutionContext, request: any): boolean {
    const route = `${request.method} ${request.route?.path ?? request.url}`
    const handler = `${context.getClass().name}.${context.getHandler().name}`

    if (process.env.TENANT_GUARD_ENFORCE === 'true') {
      throw new ForbiddenException('Acesso negado: rota sem escopo de empresa')
    }

    TenantGuard.logger.warn(
      `[tenant-guard] rota sem companyId (seria NEGADA com TENANT_GUARD_ENFORCE=true): ${route} -> ${handler}`,
    )
    return true
  }

  private extractCompanyId(request: any): string | null {
    // 1. Params da URL (:companyId)
    if (request.params?.companyId) return request.params.companyId

    // 2. Query string (?companyId=xxx)
    if (request.query?.companyId) return request.query.companyId
    if (request.query?.company_id) return request.query.company_id

    // 3. Body do request
    if (request.body?.companyId) return request.body.companyId
    if (request.body?.company_id) return request.body.company_id

    // 3b. Body ANINHADO — `POST /triggers/update-field` e `create-record` mandam
    //     o escopo em `body.data.companyId`. Sem ler aqui, o guard nao via
    //     companyId nenhum e liberava, enquanto o service filtrava por um valor
    //     controlado pelo cliente.
    if (request.body?.data?.companyId) return request.body.data.companyId
    if (request.body?.data?.company_id) return request.body.data.company_id

    // 4. Headers
    if (request.headers?.['x-company-id']) return request.headers['x-company-id']
    if (request.headers?.['company-id']) return request.headers['company-id']

    return null
  }
}
