import { Injectable, Logger, BadRequestException, NotFoundException, Optional } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PrismaService } from 'src/database/prisma.service'
import { encrypt, decrypt, decryptIntegrationData, looksEncrypted } from 'src/shared/util/encryption.utils'
import { buildTenantBaseUrl } from 'src/shared/util/tenant-url.utils'
import { getMetaAuthError } from 'src/shared/util/meta-auth-error.utils'
import { probeMetaCredentials, MetaProbeResult } from 'src/shared/util/meta-probe.utils'
import {
  META_TOKEN_DECRYPT_FAILED_MESSAGE,
  clearMetaTokenInvalid,
  markMetaTokenInvalid,
  notifyMetaTokenInvalid,
} from 'src/shared/util/meta-token-invalid.utils'
import { UserNotificationService } from 'src/modules/admin/notifications/user-notification.service'
import { META_API_BASE, META_API_VERSION } from '../constants/meta-ads.constants'
import { MetaLeadFormsService } from './meta-lead-forms.service'
import * as crypto from 'crypto'

// ===== Interfaces =====

export interface MetaOAuthLoginResponse {
  loginUrl: string
  state: string
}

export interface MetaOAuthCallbackResult {
  success: boolean
  facebookUserId?: string
  facebookName?: string
  facebookEmail?: string
  tokenExpiresAt?: Date
  redirectUrl: string
}

export interface MetaOAuthStatusResponse {
  connected: boolean
  method: string | null
  isExpired: boolean
  /**
   * Token REVOGADO pelo provedor (OAuthException 190, ex.: troca de senha do
   * Facebook) — distinto de isExpired: expiresAt pode estar no futuro e o token
   * já estar morto. É o que liga o banner "Reconectar" no front.
   */
  needsReconnect: boolean
  invalidatedAt: Date | null
  invalidReason: string | null
  facebookUser: {
    id: string | null
    name: string | null
    email: string | null
  } | null
  expiresAt: Date | null
  connectedAt: Date | null
}

export interface MetaBusinessManager {
  id: string
  name: string
  created_time?: string
  verification_status?: string
}

export interface MetaAdAccount {
  id: string
  name: string
  account_id: string
  account_status: number
  currency?: string
  timezone_name?: string
  business?: { id: string; name: string }
}

@Injectable()
export class MetaAdsOAuthService {
  private readonly logger = new Logger(MetaAdsOAuthService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly metaLeadFormsService: MetaLeadFormsService,
    // @Optional: specs instanciam com 3 argumentos; sem notificador o probe só não avisa.
    @Optional() private readonly userNotificationService?: UserNotificationService,
  ) {}

  /**
   * Gera URL de login do Facebook OAuth
   * Cria state CSRF com TTL de 10 minutos
   */
  async generateLoginUrl(companyId: string): Promise<MetaOAuthLoginResponse> {
    const company = await this.prisma.companies.findUnique({
      where: { id: companyId },
    })

    if (!company) {
      throw new NotFoundException('Empresa nao encontrada')
    }

    const state = crypto.randomBytes(32).toString('hex')
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000) // 10 minutes

    await this.prisma.metaOAuthState.create({
      data: {
        companyId,
        state,
        expiresAt,
      },
    })

    const appId = this.configService.get<string>('FB_APP_ID')
    const redirectUri = this.configService.get<string>('FB_REDIRECT_URI')
    const apiVersion = this.configService.get<string>('FB_API_VERSION') || META_API_VERSION

    const scopes = [
      'ads_read',
      'ads_management',
      'business_management',
      'catalog_management',
      'leads_retrieval',
      'pages_manage_ads',
      'pages_manage_metadata',
      'pages_read_engagement',
      'pages_show_list',
    ].join(',')

    const loginUrl = `https://www.facebook.com/${apiVersion}/dialog/oauth?` +
      `client_id=${appId}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&state=${state}` +
      `&scope=${encodeURIComponent(scopes)}` +
      `&response_type=code`

    this.logger.log(`OAuth login URL gerada para empresa ${companyId}`)

    return { loginUrl, state }
  }

  /**
   * Processa callback do Facebook OAuth
   * Valida state CSRF, troca code por token, salva credenciais
   */
  async handleCallback(code: string, state: string): Promise<MetaOAuthCallbackResult> {
    const frontendUrl = this.configService.get<string>('FRONTEND_URL')

    // 1. Valida state CSRF
    const oauthState = await this.prisma.metaOAuthState.findUnique({
      where: { state },
    })

    if (!oauthState) {
      this.logger.warn('OAuth callback com state invalido')
      return {
        success: false,
        redirectUrl: `${frontendUrl}/settings/integration?error=invalid_state`,
      }
    }

    // Resolve tenant URL via company subdomain (oauthState garantidamente valido aqui)
    // Lookup envelopada: DB hiccup nao deve estourar uncaught no callback do OAuth
    let tenantUrl = frontendUrl
    try {
      const company = await this.prisma.companies.findUnique({
        where: { id: oauthState.companyId },
        select: { subdomain: true },
      })
      tenantUrl = buildTenantBaseUrl(company?.subdomain, frontendUrl)
    } catch (error) {
      this.logger.warn(
        `Falha ao resolver subdomain do tenant (companyId=${oauthState.companyId}): ${error.message}. Usando FRONTEND_URL.`,
      )
    }

    if (oauthState.expiresAt < new Date()) {
      await this.prisma.metaOAuthState.delete({ where: { id: oauthState.id } })
      this.logger.warn('OAuth callback com state expirado')
      return {
        success: false,
        redirectUrl: `${tenantUrl}/settings/integration?error=expired_state`,
      }
    }

    const companyId = oauthState.companyId

    // 2. Deleta state usado (one-time use)
    await this.prisma.metaOAuthState.delete({ where: { id: oauthState.id } })

    try {
      // 3. Troca code por short-lived token
      const shortLivedToken = await this.exchangeCodeForToken(code)

      // 4. Troca short-lived por long-lived token (~60 dias)
      const { accessToken: longLivedToken, expiresIn } = await this.exchangeForLongLivedToken(shortLivedToken)

      // 5. Busca perfil do usuario
      const profile = await this.fetchUserProfile(longLivedToken)

      // 6. Criptografa token
      const encryptedToken = encrypt(longLivedToken)

      // 7. Calcula data de expiracao
      const tokenExpiresAt = new Date(Date.now() + expiresIn * 1000)

      // 8. Garante linha Integrations (auto-cria se nao existir)
      let integration = await this.prisma.integrations.findFirst({
        where: {
          companiesId: companyId,
          platform: { type: 'meta' },
          deleted_at: null,
        },
      })

      if (!integration) {
        const platform = await this.prisma.platforms.findFirst({
          where: { type: 'meta', deleted_at: null },
        })
        if (!platform) {
          throw new NotFoundException(
            'Plataforma Meta nao configurada — peca ao superadmin criar em /platforms',
          )
        }
        integration = await this.prisma.integrations.create({
          data: {
            platformsId: platform.id,
            companiesId: companyId,
            status: 'ACTIVE',
          },
        })
        this.logger.log(
          `Integration Meta auto-criada para empresa ${companyId} (id ${integration.id})`,
        )
      }

      await this.prisma.integrations.update({
        where: { id: integration.id },
        data: {
          metaAccessToken: encryptedToken,
          metaFacebookUserId: profile.id,
          metaFacebookName: profile.name,
          metaFacebookEmail: profile.email || null,
          metaTokenExpiresAt: tokenExpiresAt,
          metaOAuthConnectedAt: new Date(),
          metaOAuthMethod: 'OAUTH',
          status: 'ACTIVE',
        },
      })

      // Token novo: o flag de invalidação descreve o token ANTIGO. Limpar aqui é o
      // que religa o CAPI, e o release zera o nextAttemptAt dos eventos retidos —
      // recuperação no próximo ciclo do cron em vez de esperar o hold de 60min.
      try {
        await clearMetaTokenInvalid(this.prisma, companyId)
      } catch (error) {
        this.logger.warn(
          `Falha ao limpar flag de token invalido pos-OAuth (company=${companyId}): ${error.message}`,
        )
      }

      this.logger.log(`OAuth conectado com sucesso para empresa ${companyId} (FB user: ${profile.id})`)

      // Reautorização derruba a inscrição de leadgen das páginas — reinscreve as mapeadas.
      // Não-fatal: falha não pode quebrar o redirect do OAuth.
      try {
        await this.metaLeadFormsService.resubscribeMappedPages(companyId)
      } catch (error) {
        this.logger.warn(`Falha ao reinscrever páginas leadgen pós-OAuth (company=${companyId}): ${error.message}`)
      }

      return {
        success: true,
        facebookUserId: profile.id,
        facebookName: profile.name,
        facebookEmail: profile.email,
        tokenExpiresAt,
        redirectUrl: `${tenantUrl}/settings/integration?success=true`,
      }
    } catch (error) {
      this.logger.error(`Erro no OAuth callback: ${error.message}`)
      return {
        success: false,
        redirectUrl: `${tenantUrl}/settings/integration?error=oauth_failed&message=${encodeURIComponent(error.message)}`,
      }
    }
  }

  /**
   * Retorna status da conexao OAuth.
   *
   * `probe = true` valida o token de verdade contra a Graph API (GET /me): 190/102
   * marca a integracao como invalida (e notifica na transicao); sucesso limpa o
   * flag (auto-cura). Sem probe, o status reflete apenas o estado persistido —
   * `isExpired` e so data e um token revogado por troca de senha continuaria
   * parecendo saudavel (foi o que escondeu o incidente digienge).
   */
  async getConnectionStatus(companyId: string, probe = false): Promise<MetaOAuthStatusResponse> {
    let integration = await this.prisma.integrations.findFirst({
      where: {
        companiesId: companyId,
        platform: { type: 'meta' },
        deleted_at: null,
      },
    })

    if (!integration || !integration.metaAccessToken) {
      return {
        connected: false,
        method: null,
        isExpired: false,
        needsReconnect: false,
        invalidatedAt: null,
        invalidReason: null,
        facebookUser: null,
        expiresAt: null,
        connectedAt: null,
      }
    }

    if (probe) {
      await this.probeToken(integration)
      // Rele: o probe pode ter marcado/limpado o flag nesta mesma requisicao.
      integration =
        (await this.prisma.integrations.findUnique({ where: { id: integration.id } })) ??
        integration
    }

    const isOAuth = integration.metaOAuthMethod === 'OAUTH'
    const isExpired = isOAuth && integration.metaTokenExpiresAt
      ? integration.metaTokenExpiresAt < new Date()
      : false

    return {
      connected: true,
      method: integration.metaOAuthMethod || 'MANUAL',
      isExpired,
      needsReconnect: !!integration.metaTokenInvalidAt,
      invalidatedAt: integration.metaTokenInvalidAt ?? null,
      invalidReason: integration.metaTokenInvalidReason ?? null,
      facebookUser: isOAuth ? {
        id: integration.metaFacebookUserId,
        name: integration.metaFacebookName,
        email: integration.metaFacebookEmail,
      } : null,
      expiresAt: integration.metaTokenExpiresAt,
      connectedAt: integration.metaOAuthConnectedAt,
    }
  }

  /**
   * Sonda TODAS as integracoes Meta ativas com token gravado. Usado pelo cron diario.
   *
   * Existe porque, ate aqui, token morto so aparecia se o CAPI enviasse conversao, se o
   * Dataset Quality rodasse ou se alguem abrisse a tela de Integracoes com `?probe=1`.
   * Um tenant que so usa Meta Ads nao dispara nenhum dos tres e ficava com a integracao
   * silenciosamente morta — foi o que aconteceu com a digienge entre 28 e 31/08.
   *
   * Reusa o `probeToken`: ele ja marca/notifica no 190/102, limpa o flag no sucesso e
   * NAO mexe em nada quando a falha e de rede — indisponibilidade da Meta nao e veredito
   * sobre o token. Nunca lanca: uma integracao problematica nao pode abortar o lote.
   */
  async probeAllActiveTokens(): Promise<{ probed: number }> {
    const integrations = await this.prisma.integrations.findMany({
      where: {
        platform: { type: 'meta' },
        status: 'ACTIVE',
        deleted_at: null,
        metaAccessToken: { not: null },
      },
    })

    for (const integration of integrations) {
      await this.probeToken(integration)
    }

    return { probed: integrations.length }
  }

  /**
   * Sonda o token contra /me (timeout curto, best-effort). 190/102 → marca invalido
   * (+notificacao unica na transicao); sucesso → limpa o flag e libera eventos
   * retidos. Rede/timeout nao muda nada: indisponibilidade da Meta nao e veredito
   * sobre o token.
   */
  private async probeToken(integration: any): Promise<void> {
    try {
      const decrypted = decryptIntegrationData(integration)
      const token = decrypted.metaAccessToken
      // Ciphertext (ENCRYPTION_KEY divergente): nao da para sondar, e reconectar
      // nao e a cura — nao mexe no flag.
      if (!token || looksEncrypted(token)) return

      // Com conta de anuncios gravada, sonda a CONTA e nao o `/me`. Duas razoes:
      // (1) e a pergunta que o sync realmente faz, e (2) token de System User — o que o
      // fallback manual existe para receber — nao tem pessoa por tras para o `/me`
      // descrever, e sondar `/me` arriscaria marcar como morta uma integracao sadia.
      const conta = decrypted.metaAppId
      const resultado = conta
        ? await probeMetaCredentials(conta, token, 5000)
        : await this.probeMeEndpoint(token)

      if (resultado.reason === 'auth') {
        const transicao = await markMetaTokenInvalid(
          this.prisma,
          integration.companiesId,
          resultado.message,
        )
        if (transicao) {
          await notifyMetaTokenInvalid(
            this.prisma,
            this.userNotificationService,
            integration.companiesId,
            resultado.message,
          )
        }
      } else if (resultado.reason === 'ok') {
        await clearMetaTokenInvalid(this.prisma, integration.companiesId)
      }
      // 'no_access' e 'network' nao mudam nada: conta trocada no Gerenciador e Meta fora
      // do ar nao sao veredito sobre o token, e pedir reconexao por causa deles mandaria
      // o cliente trocar o que estava bom.
    } catch (error) {
      this.logger.warn(`Probe do token Meta falhou (best-effort): ${error.message}`)
    }
  }

  /**
   * Sonda `GET /me` — usado so quando a integracao ainda nao tem conta de anuncios
   * escolhida (OAuth conectado, antes do passo de selecionar a conta). Devolve o mesmo
   * formato do `probeMetaCredentials` para o chamador nao precisar saber a diferenca.
   */
  private async probeMeEndpoint(token: string): Promise<MetaProbeResult> {
    try {
      const url = `${META_API_BASE}/${META_API_VERSION}/me?fields=id&access_token=${encodeURIComponent(token)}`
      const response = await fetch(url, { signal: AbortSignal.timeout(5000) })
      const body = await response.json()

      const authError = getMetaAuthError(body)
      if (authError) return { reason: 'auth', message: authError.message }
      if (body?.id) return { reason: 'ok' }
      return { reason: 'network', message: 'resposta inesperada da Meta' }
    } catch (error: any) {
      return { reason: 'network', message: error?.message ?? 'falha de rede' }
    }
  }

  /**
   * Desconecta OAuth: revoga token no Facebook e limpa campos
   */
  async disconnect(companyId: string): Promise<{ success: boolean }> {
    const integration = await this.prisma.integrations.findFirst({
      where: {
        companiesId: companyId,
        platform: { type: 'meta' },
        deleted_at: null,
      },
    })

    if (!integration) {
      throw new NotFoundException('Integracao Meta nao encontrada')
    }

    // Revoga token no Facebook (best-effort)
    if (integration.metaAccessToken && integration.metaOAuthMethod === 'OAUTH') {
      try {
        const decrypted = decryptIntegrationData(integration)
        const revokeUrl = `${META_API_BASE}/${META_API_VERSION}/me/permissions?access_token=${decrypted.metaAccessToken}`
        await fetch(revokeUrl, { method: 'DELETE' })
        this.logger.log(`Token revogado no Facebook para empresa ${companyId}`)
      } catch (error) {
        this.logger.warn(`Falha ao revogar token no Facebook (best-effort): ${error.message}`)
      }
    }

    // Limpa campos OAuth no banco
    await this.prisma.integrations.update({
      where: { id: integration.id },
      data: {
        metaAccessToken: null,
        metaFacebookUserId: null,
        metaFacebookName: null,
        metaFacebookEmail: null,
        metaTokenExpiresAt: null,
        metaOAuthConnectedAt: null,
        metaOAuthMethod: 'MANUAL',
      },
    })

    // O flag descreve um token que nao existe mais. SEM release da fila retida:
    // sem token nao ha o que enviar — liberar so queimaria ciclos do cron.
    try {
      await clearMetaTokenInvalid(this.prisma, companyId, { releaseHeldEvents: false })
    } catch (error) {
      this.logger.warn(`Falha ao limpar flag no disconnect (company=${companyId}): ${error.message}`)
    }

    this.logger.log(`OAuth desconectado para empresa ${companyId}`)

    return { success: true }
  }

  /**
   * Refresh token se proximo de expirar (< 7 dias)
   * Chamado pelo cron diario
   */
  async refreshTokenIfNeeded(integrationId: number): Promise<boolean> {
    const integration = await this.prisma.integrations.findUnique({
      where: { id: integrationId },
    })

    if (!integration || !integration.metaAccessToken || integration.metaOAuthMethod !== 'OAUTH') {
      return false
    }

    // So faz refresh se expira em menos de 7 dias
    const sevenDaysFromNow = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    if (!integration.metaTokenExpiresAt || integration.metaTokenExpiresAt > sevenDaysFromNow) {
      return false
    }

    // Se ja expirou, nao da pra fazer refresh
    if (integration.metaTokenExpiresAt < new Date()) {
      this.logger.warn(`Token ja expirado para integracao ${integrationId}, nao e possivel refresh`)
      return false
    }

    // Token revogado (190) nao se troca por fb_exchange_token — a Meta responderia
    // 190 de novo. Pular evita uma chamada condenada por dia ate a reconexao.
    if (integration.metaTokenInvalidAt) {
      this.logger.warn(
        `Token da integracao ${integrationId} esta invalidado (${integration.metaTokenInvalidReason ?? 'sem motivo registrado'}) — refresh exige reconexao`,
      )
      return false
    }

    try {
      const decrypted = decryptIntegrationData(integration)
      const { accessToken: newToken, expiresIn } = await this.exchangeForLongLivedToken(decrypted.metaAccessToken)

      const encryptedToken = encrypt(newToken)
      const newExpiresAt = new Date(Date.now() + expiresIn * 1000)

      await this.prisma.integrations.update({
        where: { id: integrationId },
        data: {
          metaAccessToken: encryptedToken,
          metaTokenExpiresAt: newExpiresAt,
        },
      })

      // Refresh bem-sucedido prova token vivo — limpa qualquer flag remanescente.
      await clearMetaTokenInvalid(this.prisma, integration.companiesId)

      this.logger.log(`Token refreshed para integracao ${integrationId}, expira em ${newExpiresAt.toISOString()}`)
      return true
    } catch (error) {
      this.logger.error(`Falha ao fazer refresh do token para integracao ${integrationId}: ${error.message}`)
      return false
    }
  }

  /**
   * Limpa states CSRF expirados
   */
  async cleanupExpiredStates(): Promise<number> {
    const result = await this.prisma.metaOAuthState.deleteMany({
      where: {
        expiresAt: { lt: new Date() },
      },
    })

    if (result.count > 0) {
      this.logger.log(`${result.count} OAuth states expirados removidos`)
    }

    return result.count
  }

  /**
   * Lista Business Managers do usuario conectado
   */
  async listBusinessManagers(companyId: string): Promise<MetaBusinessManager[]> {
    const accessToken = await this.getDecryptedOAuthToken(companyId)

    const url = `${META_API_BASE}/${META_API_VERSION}/me/businesses?` +
      `fields=id,name,created_time,verification_status` +
      `&access_token=${accessToken}`

    const response = await fetch(url)
    const result = await response.json()

    if (result.error) {
      throw new BadRequestException(`Erro ao listar Business Managers: ${result.error.message}`)
    }

    return result.data || []
  }

  /**
   * Lista Ad Accounts (de um BM especifico ou todos do usuario)
   */
  async listAdAccounts(companyId: string, businessId?: string): Promise<MetaAdAccount[]> {
    const accessToken = await this.getDecryptedOAuthToken(companyId)

    let allAccounts: MetaAdAccount[] = []
    let url: string

    if (businessId) {
      url = `${META_API_BASE}/${META_API_VERSION}/${businessId}/owned_ad_accounts?` +
        `fields=id,name,account_id,account_status,currency,timezone_name,business{id,name}` +
        `&limit=100` +
        `&access_token=${accessToken}`
    } else {
      url = `${META_API_BASE}/${META_API_VERSION}/me/adaccounts?` +
        `fields=id,name,account_id,account_status,currency,timezone_name,business{id,name}` +
        `&limit=100` +
        `&access_token=${accessToken}`
    }

    // Paginacao
    while (url) {
      const response = await fetch(url)
      const result = await response.json()

      if (result.error) {
        throw new BadRequestException(`Erro ao listar Ad Accounts: ${result.error.message}`)
      }

      if (result.data) {
        allAccounts = allAccounts.concat(result.data)
      }

      url = result.paging?.next || null
    }

    return allAccounts
  }

  /**
   * Seleciona e salva ad account na integracao
   */
  async selectAdAccount(companyId: string, adAccountId: string): Promise<{ success: boolean; adAccountId: string }> {
    const integration = await this.prisma.integrations.findFirst({
      where: {
        companiesId: companyId,
        platform: { type: 'meta' },
        deleted_at: null,
      },
    })

    if (!integration) {
      throw new NotFoundException('Integracao Meta nao encontrada')
    }

    // Normaliza o ID (garante prefixo act_)
    const normalizedId = adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`

    // Criptografa e salva
    const encryptedId = encrypt(normalizedId)

    await this.prisma.integrations.update({
      where: { id: integration.id },
      data: {
        metaAppId: encryptedId,
      },
    })

    this.logger.log(`Ad Account ${normalizedId} selecionada para empresa ${companyId}`)

    return { success: true, adAccountId: normalizedId }
  }

  // ===== Private Helpers =====

  /**
   * Busca e decripta token OAuth da integracao
   */
  private async getDecryptedOAuthToken(companyId: string): Promise<string> {
    const integration = await this.prisma.integrations.findFirst({
      where: {
        companiesId: companyId,
        platform: { type: 'meta' },
        deleted_at: null,
      },
    })

    if (!integration || !integration.metaAccessToken) {
      throw new NotFoundException('Integracao Meta nao encontrada ou sem token')
    }

    if (integration.metaOAuthMethod === 'OAUTH' && integration.metaTokenExpiresAt) {
      if (integration.metaTokenExpiresAt < new Date()) {
        throw new BadRequestException('Token OAuth expirado. Reconecte sua conta Facebook.')
      }
    }

    const decrypted = decryptIntegrationData(integration)

    // ENCRYPTION_KEY divergente: decrypt() devolve o ciphertext intacto. Mandar isso para a
    // Meta rende "Cannot parse access token", que parece token revogado e nao e.
    if (looksEncrypted(decrypted.metaAccessToken)) {
      throw new BadRequestException(META_TOKEN_DECRYPT_FAILED_MESSAGE)
    }

    return decrypted.metaAccessToken
  }

  /**
   * Troca authorization code por short-lived access token
   */
  private async exchangeCodeForToken(code: string): Promise<string> {
    const appId = this.configService.get<string>('FB_APP_ID')
    const appSecret = this.configService.get<string>('FB_APP_SECRET')
    const redirectUri = this.configService.get<string>('FB_REDIRECT_URI')
    const apiVersion = this.configService.get<string>('FB_API_VERSION') || META_API_VERSION

    const url = `${META_API_BASE}/${apiVersion}/oauth/access_token?` +
      `client_id=${appId}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&client_secret=${appSecret}` +
      `&code=${code}`

    const response = await fetch(url)
    const result = await response.json()

    if (result.error) {
      throw new BadRequestException(`Erro ao trocar code por token: ${result.error.message}`)
    }

    if (!result.access_token) {
      throw new BadRequestException('Resposta invalida ao trocar code por token')
    }

    return result.access_token
  }

  /**
   * Troca short-lived token por long-lived token (~60 dias)
   */
  private async exchangeForLongLivedToken(shortLivedToken: string): Promise<{ accessToken: string; expiresIn: number }> {
    const appId = this.configService.get<string>('FB_APP_ID')
    const appSecret = this.configService.get<string>('FB_APP_SECRET')
    const apiVersion = this.configService.get<string>('FB_API_VERSION') || META_API_VERSION

    const url = `${META_API_BASE}/${apiVersion}/oauth/access_token?` +
      `grant_type=fb_exchange_token` +
      `&client_id=${appId}` +
      `&client_secret=${appSecret}` +
      `&fb_exchange_token=${shortLivedToken}`

    const response = await fetch(url)
    const result = await response.json()

    if (result.error) {
      throw new BadRequestException(`Erro ao trocar por long-lived token: ${result.error.message}`)
    }

    if (!result.access_token) {
      throw new BadRequestException('Resposta invalida ao trocar por long-lived token')
    }

    return {
      accessToken: result.access_token,
      expiresIn: result.expires_in || 5184000, // Default 60 dias
    }
  }

  /**
   * Busca perfil do usuario no Facebook
   */
  private async fetchUserProfile(accessToken: string): Promise<{ id: string; name: string; email?: string }> {
    const apiVersion = this.configService.get<string>('FB_API_VERSION') || META_API_VERSION

    const url = `${META_API_BASE}/${apiVersion}/me?fields=id,name,email&access_token=${accessToken}`

    const response = await fetch(url)
    const result = await response.json()

    if (result.error) {
      throw new BadRequestException(`Erro ao buscar perfil do Facebook: ${result.error.message}`)
    }

    return {
      id: result.id,
      name: result.name,
      email: result.email,
    }
  }
}
