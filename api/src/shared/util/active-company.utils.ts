import { ForbiddenException } from '@nestjs/common'

interface MembershipLike {
  companyId: string
  role: string
  status: string
  inherited?: boolean
  viaCompanyId?: string
}

export interface RequestWithUser extends Request {
  user?: {
    id?: string
    email?: string
    systemRole?: string
    jwtCompanyId?: string
    jwtRole?: string
    companyMember?: MembershipLike[]
    /** Diretas + herdadas por SUBTREE; montado no jwt.strategy. */
    effectiveMemberships?: MembershipLike[]
  }
}

export interface ActiveMembership {
  companyId: string
  role: string
  isSystemAdmin: boolean
  /** true = o acesso vem de uma membership SUBTREE numa empresa ancestral. */
  inherited: boolean
  /** Onde mora a linha autoritativa que concede o acesso. */
  viaCompanyId: string
}

/**
 * Resolve a empresa "ativa" do request, priorizando a empresa amarrada ao JWT
 * (companyId definido no login para um subdomain especifico). Para usuarios
 * com multiplas memberships ativas, isso evita pegar empresa errada por acaso.
 */
export function resolveActiveMembership(req: RequestWithUser): ActiveMembership | null {
  const user = req.user
  if (!user) return null

  const isSystemAdmin = user.systemRole === 'ADMIN'
  // Diretas + herdadas por SUBTREE. Cai para companyMember quando a expansao
  // falhou no jwt.strategy ou quando o objeto nao passou por la.
  const members = Array.isArray(user.effectiveMemberships)
    ? user.effectiveMemberships
    : Array.isArray(user.companyMember)
      ? user.companyMember
      : []
  const jwtCompanyId = user.jwtCompanyId

  const toActive = (m: MembershipLike): ActiveMembership => ({
    companyId: m.companyId,
    role: m.role,
    isSystemAdmin,
    inherited: m.inherited === true,
    viaCompanyId: m.viaCompanyId ?? m.companyId,
  })

  // 1. Preferir membership amarrada ao JWT (desde que ATIVA)
  if (jwtCompanyId) {
    const fromJwt = members.find((m) => m.companyId === jwtCompanyId && m.status === 'ACTIVE')
    if (fromJwt) return toActive(fromJwt)
  }

  // 2. Fallback: primeira membership ATIVA (caso comum de single-company users)
  //    Prefere linha DIRETA: numa conta de grupo as herdadas sao muitas, e cair
  //    numa filha por acaso quando existe vinculo proprio seria escolha errada.
  const firstDirect = members.find((m) => m.status === 'ACTIVE' && m.inherited !== true)
  if (firstDirect) return toActive(firstDirect)

  const firstActive = members.find((m) => m.status === 'ACTIVE')
  if (firstActive) return toActive(firstActive)

  // 3. SUPERADMIN do sistema sem membership: usa jwtCompanyId direto
  if (isSystemAdmin && jwtCompanyId) {
    return {
      companyId: jwtCompanyId,
      role: 'SUPERADMIN',
      isSystemAdmin: true,
      inherited: false,
      viaCompanyId: jwtCompanyId,
    }
  }

  return null
}

const ALLOWED_ADMIN_ROLES = new Set(['OWNER', 'ADMIN', 'SUPERADMIN'])

/**
 * Versao nao-lancante de `assertAdminOfActiveCompany`, para quando "nao e admin" nao e o fim
 * da linha e sim um ramo — por exemplo, o auto-cadastro na campanha, que aceita o proprio
 * vendedor OU um gestor daquela empresa.
 */
export function isAdminOfCompany(req: RequestWithUser, companyId: string): boolean {
  const m = resolveActiveMembership(req)
  if (!m) return false
  if (m.isSystemAdmin) return true
  return m.companyId === companyId && ALLOWED_ADMIN_ROLES.has(m.role)
}

/**
 * Garante que o usuario eh admin DESTA empresa (a ativa). Bloqueia o caso de
 * SELLER em A + OWNER em B autenticado contra A passar pelo RolesGuard global.
 * Retorna o companyId resolvido ou lanca 403.
 */
/**
 * @param allowInherited quando false, exige vinculo DIRETO com a empresa ativa
 *   — herdar do pai nao basta. Usar nas operacoes que mexem na identidade da
 *   empresa (membros, secretKey, credenciais de integracao, plano, exclusao,
 *   criacao de filha), onde "sou admin do grupo" nao deve equivaler a "sou admin
 *   desta empresa". Default true: um OWNER do pai e OWNER das filhas, que e a
 *   intencao do recurso.
 */
export function assertAdminOfActiveCompany(
  req: RequestWithUser,
  opts?: { allowInherited?: boolean },
): string {
  const m = resolveActiveMembership(req)
  if (!m) {
    throw new ForbiddenException('Sem empresa ativa associada ao usuario')
  }
  if (!m.isSystemAdmin && !ALLOWED_ADMIN_ROLES.has(m.role)) {
    throw new ForbiddenException('Acesso restrito a OWNER/ADMIN/SUPERADMIN da empresa ativa')
  }
  if (opts?.allowInherited === false && !m.isSystemAdmin && m.inherited) {
    throw new ForbiddenException(
      'Acesso restrito a membros diretos desta empresa; vinculo herdado do grupo nao basta',
    )
  }
  return m.companyId
}

/**
 * Garante que o usuario e OWNER (papel exato, nem ADMIN nem SUPERADMIN) da empresa ATIVA
 * da sessao. Usada pelas rotas autenticadas de oauth-mcp (/connections, /revoke e,
 * via resolveEffectiveMembership no service, /authorize/complete): o access token OAuth
 * emitido carrega a Chave Secreta da empresa em texto claro, e o plano do recurso exige
 * OWNER-only para quem pode ver/revogar essas conexoes — nao ADMIN.
 *
 * Deliberadamente NAO usa `assertAdminOfActiveCompany`: seu `ALLOWED_ADMIN_ROLES` inclui
 * ADMIN e SUPERADMIN, e o `RolesGuard` global (roles.guard.ts) aceita o papel requerido
 * em QUALQUER membership do usuario — nao so na empresa ativa (`user.companyMember.some(...)`
 * varre todas as empresas). Um usuario ADMIN da empresa ativa mas OWNER de outra empresa
 * passa o `@Roles('OWNER')` do RolesGuard (tem OWNER em algum lugar) e so e barrado aqui,
 * quando resolvemos o papel dele especificamente NA empresa ativa.
 */
export function assertOwnerOfActiveCompany(req: RequestWithUser): string {
  const m = resolveActiveMembership(req)
  if (!m || m.role !== 'OWNER') {
    throw new ForbiddenException('Acesso restrito a OWNER da empresa ativa')
  }
  return m.companyId
}

const GROUP_MANAGE_ROLES = new Set(['OWNER', 'ADMIN', 'SUPERADMIN'])

/**
 * Garante que o usuario e OWNER/ADMIN/SUPERADMIN DIRETO da empresa ativa, e que
 * essa empresa e a informada.
 *
 * Usar nas operacoes que criam custo ou mexem na identidade do grupo — criar
 * empresa-filha, mudar plano, girar secretKey.
 *
 * ADMIN entra aqui por decisao de produto: administrar o grupo (inclusive criar
 * empresa-filha) e atribuicao de admin, nao so do dono. O que continua barrado e
 * o vinculo HERDADO: ser admin do pai nao torna ninguem admin da filha, senao
 * "administrar meu grupo" viraria "administrar cada tenant dentro dele".
 *
 * Este conjunto tem que espelhar tres lugares, ou o usuario ve o menu e leva 403
 * (ou o contrario):
 *   - role_page_access da pagina 'group' (lembrando que PageAccessUserService
 *     normaliza OWNER->ADMIN, entao a linha ADMIN e a que libera o OWNER);
 *   - o gate de UI em hdm-web .../group/page.tsx;
 *   - este Set.
 */
export function assertGroupOwnerOfCompany(req: RequestWithUser, companyId: string): string {
  const m = resolveActiveMembership(req)
  if (!m) {
    throw new ForbiddenException('Sem empresa ativa associada ao usuario')
  }
  if (m.companyId !== companyId) {
    throw new ForbiddenException('Operacao permitida apenas sobre a empresa ativa da sessao')
  }
  if (!m.isSystemAdmin) {
    if (m.inherited) {
      throw new ForbiddenException(
        'Acesso restrito a membros diretos desta empresa; vinculo herdado do grupo nao basta',
      )
    }
    if (!GROUP_MANAGE_ROLES.has(m.role)) {
      throw new ForbiddenException('Acesso restrito a OWNER/ADMIN/SUPERADMIN desta empresa')
    }
  }
  return m.companyId
}
