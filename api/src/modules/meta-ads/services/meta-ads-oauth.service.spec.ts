import { Test, TestingModule } from '@nestjs/testing'
import { ConfigService } from '@nestjs/config'
import { NotFoundException } from '@nestjs/common'
import { PrismaService } from 'src/database/prisma.service'
import { MetaAdsOAuthService } from './meta-ads-oauth.service'
import { MetaLeadFormsService } from './meta-lead-forms.service'

jest.mock('src/shared/util/encryption.utils', () => ({
  encrypt: jest.fn((v: string) => `enc(${v})`),
  decrypt: jest.fn((v: string) => v.replace(/^enc\(|\)$/g, '')),
  decryptIntegrationData: jest.fn((v: string) => v),
  looksEncrypted: jest.fn(() => false),
}))

describe('MetaAdsOAuthService.handleCallback', () => {
  let service: MetaAdsOAuthService
  let prisma: {
    metaOAuthState: { findUnique: jest.Mock; delete: jest.Mock }
    integrations: {
      findFirst: jest.Mock
      findUnique: jest.Mock
      create: jest.Mock
      update: jest.Mock
      updateMany: jest.Mock
    }
    platforms: { findFirst: jest.Mock }
    companies: { findUnique: jest.Mock }
    triggerTrackingEvent: { updateMany: jest.Mock }
  }
  let config: { get: jest.Mock }
  let metaLeadForms: { resubscribeMappedPages: jest.Mock }

  const validState = {
    id: 1,
    state: 'state-token-abc',
    companyId: 'company-uuid-1',
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
  }

  beforeEach(async () => {
    jest.clearAllMocks()
    prisma = {
      metaOAuthState: { findUnique: jest.fn(), delete: jest.fn() },
      integrations: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        // clearMetaTokenInvalid: count > 0 = havia flag (dispara o release)
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      platforms: { findFirst: jest.fn() },
      companies: { findUnique: jest.fn() },
      triggerTrackingEvent: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    }
    process.env.TENANT_BASE_DOMAIN = 'hdmfy.com' // sem default no codigo; o spec fixa o dominio
    config = {
      get: jest.fn((k: string) => {
        const map: Record<string, string> = {
          FRONTEND_URL: 'https://app.test',
          FB_APP_ID: 'app-id',
          FB_APP_SECRET: 'app-secret',
          FB_REDIRECT_URI: 'https://api.test/meta-ads/oauth/callback',
          FB_API_VERSION: 'v25.0',
        }
        return map[k]
      }),
    }

    metaLeadForms = { resubscribeMappedPages: jest.fn().mockResolvedValue(undefined) }

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MetaAdsOAuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: config },
        { provide: MetaLeadFormsService, useValue: metaLeadForms },
      ],
    }).compile()

    service = module.get<MetaAdsOAuthService>(MetaAdsOAuthService)

    // Stub dos métodos privados que fazem HTTP pra Graph API
    jest.spyOn(service as any, 'exchangeCodeForToken').mockResolvedValue('short-token')
    jest.spyOn(service as any, 'exchangeForLongLivedToken').mockResolvedValue({
      accessToken: 'long-token',
      expiresIn: 5184000,
    })
    jest.spyOn(service as any, 'fetchUserProfile').mockResolvedValue({
      id: 'fb-user-1',
      name: 'Test User',
      email: 'test@example.com',
    })
  })

  it('atualiza Integration existente sem chamar create', async () => {
    prisma.metaOAuthState.findUnique.mockResolvedValue(validState)
    prisma.metaOAuthState.delete.mockResolvedValue({})
    prisma.companies.findUnique.mockResolvedValue({ subdomain: 'digienge' })
    prisma.integrations.findFirst.mockResolvedValue({ id: 42, companiesId: 'company-uuid-1' })
    prisma.integrations.update.mockResolvedValue({})

    const result = await service.handleCallback('auth-code', 'state-token-abc')

    expect(prisma.integrations.create).not.toHaveBeenCalled()
    expect(prisma.platforms.findFirst).not.toHaveBeenCalled()
    expect(prisma.integrations.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 42 },
        data: expect.objectContaining({
          metaAccessToken: 'enc(long-token)',
          metaFacebookUserId: 'fb-user-1',
          metaOAuthMethod: 'OAUTH',
          status: 'ACTIVE',
        }),
      }),
    )
    expect(result.success).toBe(true)
    expect(result.redirectUrl).toBe('https://digienge.hdmfy.com/settings/integration?success=true')
  })

  it('reinscreve paginas leadgen mapeadas apos OAuth conectar (reautorizacao derruba a inscricao)', async () => {
    prisma.metaOAuthState.findUnique.mockResolvedValue(validState)
    prisma.metaOAuthState.delete.mockResolvedValue({})
    prisma.companies.findUnique.mockResolvedValue({ subdomain: 'digienge' })
    prisma.integrations.findFirst.mockResolvedValue({ id: 42, companiesId: 'company-uuid-1' })
    prisma.integrations.update.mockResolvedValue({})

    const result = await service.handleCallback('auth-code', 'state-token-abc')

    expect(result.success).toBe(true)
    expect(metaLeadForms.resubscribeMappedPages).toHaveBeenCalledWith('company-uuid-1')
  })

  it('nao quebra o callback quando a reinscricao de paginas falha (nao-fatal)', async () => {
    prisma.metaOAuthState.findUnique.mockResolvedValue(validState)
    prisma.metaOAuthState.delete.mockResolvedValue({})
    prisma.companies.findUnique.mockResolvedValue({ subdomain: 'digienge' })
    prisma.integrations.findFirst.mockResolvedValue({ id: 42, companiesId: 'company-uuid-1' })
    prisma.integrations.update.mockResolvedValue({})
    metaLeadForms.resubscribeMappedPages.mockRejectedValue(new Error('graph down'))

    const result = await service.handleCallback('auth-code', 'state-token-abc')

    expect(result.success).toBe(true)
    expect(result.redirectUrl).toContain('success=true')
  })

  it('cria Integration quando nao existe e Platform meta existe', async () => {
    prisma.metaOAuthState.findUnique.mockResolvedValue(validState)
    prisma.metaOAuthState.delete.mockResolvedValue({})
    prisma.companies.findUnique.mockResolvedValue({ subdomain: 'digienge' })
    prisma.integrations.findFirst.mockResolvedValue(null)
    prisma.platforms.findFirst.mockResolvedValue({ id: 'platform-meta-uuid' })
    prisma.integrations.create.mockResolvedValue({ id: 99, companiesId: 'company-uuid-1' })
    prisma.integrations.update.mockResolvedValue({})

    const result = await service.handleCallback('auth-code', 'state-token-abc')

    expect(prisma.platforms.findFirst).toHaveBeenCalledWith({
      where: { type: 'meta', deleted_at: null },
    })
    expect(prisma.integrations.create).toHaveBeenCalledWith({
      data: {
        platformsId: 'platform-meta-uuid',
        companiesId: 'company-uuid-1',
        status: 'ACTIVE',
      },
    })
    expect(prisma.integrations.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 99 },
        data: expect.objectContaining({ metaOAuthMethod: 'OAUTH' }),
      }),
    )
    expect(result.success).toBe(true)
    expect(result.redirectUrl).toBe('https://digienge.hdmfy.com/settings/integration?success=true')
  })

  it('retorna erro pedindo superadmin quando Platform meta nao existe', async () => {
    prisma.metaOAuthState.findUnique.mockResolvedValue(validState)
    prisma.metaOAuthState.delete.mockResolvedValue({})
    prisma.companies.findUnique.mockResolvedValue({ subdomain: 'digienge' })
    prisma.integrations.findFirst.mockResolvedValue(null)
    prisma.platforms.findFirst.mockResolvedValue(null)

    const result = await service.handleCallback('auth-code', 'state-token-abc')

    expect(prisma.integrations.create).not.toHaveBeenCalled()
    expect(prisma.integrations.update).not.toHaveBeenCalled()
    expect(result.success).toBe(false)
    expect(result.redirectUrl).toContain('https://digienge.hdmfy.com/settings/integration')
    expect(result.redirectUrl).toContain('error=oauth_failed')
    expect(decodeURIComponent(result.redirectUrl)).toContain('superadmin')
  })

  it('auto-cria nova Integration quando a existente esta soft-deleted', async () => {
    prisma.metaOAuthState.findUnique.mockResolvedValue(validState)
    prisma.metaOAuthState.delete.mockResolvedValue({})
    prisma.companies.findUnique.mockResolvedValue({ subdomain: 'digienge' })
    // findFirst filtra deleted_at: null — então retorna null mesmo se houver uma soft-deleted
    prisma.integrations.findFirst.mockResolvedValue(null)
    prisma.platforms.findFirst.mockResolvedValue({ id: 'platform-meta-uuid' })
    prisma.integrations.create.mockResolvedValue({ id: 123, companiesId: 'company-uuid-1' })
    prisma.integrations.update.mockResolvedValue({})

    const result = await service.handleCallback('auth-code', 'state-token-abc')

    expect(prisma.integrations.findFirst).toHaveBeenCalledWith({
      where: expect.objectContaining({ deleted_at: null }),
    })
    expect(prisma.integrations.create).toHaveBeenCalledTimes(1)
    expect(result.success).toBe(true)
  })

  it('fallback pra FRONTEND_URL quando company nao tem subdomain', async () => {
    prisma.metaOAuthState.findUnique.mockResolvedValue(validState)
    prisma.metaOAuthState.delete.mockResolvedValue({})
    prisma.companies.findUnique.mockResolvedValue({ subdomain: null })
    prisma.integrations.findFirst.mockResolvedValue({ id: 42, companiesId: 'company-uuid-1' })
    prisma.integrations.update.mockResolvedValue({})

    const result = await service.handleCallback('auth-code', 'state-token-abc')

    expect(prisma.companies.findUnique).toHaveBeenCalledWith({
      where: { id: 'company-uuid-1' },
      select: { subdomain: true },
    })
    expect(result.success).toBe(true)
    expect(result.redirectUrl).toBe('https://app.test/settings/integration?success=true')
  })

  it('token novo limpa o flag de invalidacao e libera a fila retida', async () => {
    // O flag descreve o token ANTIGO; sem esta limpeza o CAPI continuaria em hold
    // mesmo depois da reconexao. O release zera nextAttemptAt para os eventos
    // voltarem no proximo ciclo do cron, nao em ate 60min.
    prisma.metaOAuthState.findUnique.mockResolvedValue(validState)
    prisma.metaOAuthState.delete.mockResolvedValue({})
    prisma.companies.findUnique.mockResolvedValue({ subdomain: 'digienge' })
    prisma.integrations.findFirst.mockResolvedValue({ id: 42, companiesId: 'company-uuid-1' })
    prisma.integrations.update.mockResolvedValue({})
    prisma.integrations.updateMany.mockResolvedValue({ count: 1 })

    const result = await service.handleCallback('auth-code', 'state-token-abc')

    expect(result.success).toBe(true)
    expect(prisma.integrations.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          companiesId: 'company-uuid-1',
          metaTokenInvalidAt: { not: null },
        }),
        data: { metaTokenInvalidAt: null, metaTokenInvalidReason: null },
      }),
    )
    expect(prisma.triggerTrackingEvent.updateMany).toHaveBeenCalledWith({
      where: { companyId: 'company-uuid-1', status: 'PENDING', nextAttemptAt: { not: null } },
      data: { nextAttemptAt: null },
    })
  })

  it('sem flag para limpar (count 0), nao mexe na fila', async () => {
    prisma.metaOAuthState.findUnique.mockResolvedValue(validState)
    prisma.metaOAuthState.delete.mockResolvedValue({})
    prisma.companies.findUnique.mockResolvedValue({ subdomain: 'digienge' })
    prisma.integrations.findFirst.mockResolvedValue({ id: 42, companiesId: 'company-uuid-1' })
    prisma.integrations.update.mockResolvedValue({})
    prisma.integrations.updateMany.mockResolvedValue({ count: 0 })

    await service.handleCallback('auth-code', 'state-token-abc')

    expect(prisma.triggerTrackingEvent.updateMany).not.toHaveBeenCalled()
  })
})

describe('MetaAdsOAuthService.getConnectionStatus', () => {
  let service: MetaAdsOAuthService
  let prisma: any
  let config: any

  const integracaoViva = {
    id: 7,
    companiesId: 'company-uuid-1',
    metaAccessToken: 'enc-token',
    metaOAuthMethod: 'OAUTH',
    metaTokenExpiresAt: new Date(Date.now() + 30 * 86400000),
    metaOAuthConnectedAt: new Date('2026-05-22T19:52:41Z'),
    metaFacebookUserId: 'fb-1',
    metaFacebookName: 'Rulian',
    metaFacebookEmail: 'r@x.com',
    metaTokenInvalidAt: null as Date | null,
    metaTokenInvalidReason: null as string | null,
  }

  beforeEach(() => {
    jest.clearAllMocks()
    prisma = {
      integrations: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      triggerTrackingEvent: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      client: { companyMember: { findMany: jest.fn().mockResolvedValue([]) } },
    }
    config = { get: jest.fn() }
    service = new MetaAdsOAuthService(prisma, config, {} as any)
  })

  it('token saudavel: needsReconnect false', async () => {
    prisma.integrations.findFirst.mockResolvedValue({ ...integracaoViva })

    const status = await service.getConnectionStatus('company-uuid-1')

    expect(status.connected).toBe(true)
    expect(status.isExpired).toBe(false)
    expect(status.needsReconnect).toBe(false)
    expect(status.invalidatedAt).toBeNull()
  })

  it('token revogado: needsReconnect true mesmo com expiresAt no futuro', async () => {
    // O caso digienge: metaTokenExpiresAt em 09/09, token morto desde 28/08 — a
    // tela dizia "Configurado" verde porque so olhava a data.
    const invalidadoEm = new Date('2026-08-28T19:50:54Z')
    prisma.integrations.findFirst.mockResolvedValue({
      ...integracaoViva,
      metaTokenInvalidAt: invalidadoEm,
      metaTokenInvalidReason: 'Error validating access token: session invalidated',
    })

    const status = await service.getConnectionStatus('company-uuid-1')

    expect(status.connected).toBe(true)
    expect(status.isExpired).toBe(false)
    expect(status.needsReconnect).toBe(true)
    expect(status.invalidatedAt).toEqual(invalidadoEm)
    expect(status.invalidReason).toContain('session invalidated')
  })

  it('sem integracao: needsReconnect false e connected false', async () => {
    prisma.integrations.findFirst.mockResolvedValue(null)

    const status = await service.getConnectionStatus('company-uuid-1')

    expect(status.connected).toBe(false)
    expect(status.needsReconnect).toBe(false)
  })

  it('probe com 190 marca a integracao e o retorno ja reflete o flag', async () => {
    prisma.integrations.findFirst.mockResolvedValue({ ...integracaoViva })
    prisma.integrations.updateMany.mockResolvedValue({ count: 1 })
    prisma.integrations.findUnique.mockResolvedValue({
      ...integracaoViva,
      metaTokenInvalidAt: new Date(),
      metaTokenInvalidReason: 'morto',
    })
    global.fetch = jest.fn().mockResolvedValue({
      json: async () => ({ error: { code: 190, error_subcode: 460, message: 'morto' } }),
    }) as any

    const status = await service.getConnectionStatus('company-uuid-1', true)

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/me?fields=id&access_token='),
      expect.any(Object),
    )
    expect(prisma.integrations.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ metaTokenInvalidAt: expect.any(Date) }),
      }),
    )
    expect(status.needsReconnect).toBe(true)
  })

  it('probe com sucesso limpa o flag (auto-cura)', async () => {
    prisma.integrations.findFirst.mockResolvedValue({
      ...integracaoViva,
      metaTokenInvalidAt: new Date('2026-08-28T19:50:54Z'),
    })
    prisma.integrations.updateMany.mockResolvedValue({ count: 1 })
    prisma.integrations.findUnique.mockResolvedValue({ ...integracaoViva })
    global.fetch = jest.fn().mockResolvedValue({
      json: async () => ({ id: 'fb-user-1' }),
    }) as any

    const status = await service.getConnectionStatus('company-uuid-1', true)

    expect(prisma.integrations.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { metaTokenInvalidAt: null, metaTokenInvalidReason: null },
      }),
    )
    expect(status.needsReconnect).toBe(false)
  })

  it('probe com timeout de rede nao muda nada — Meta fora do ar nao e veredito', async () => {
    prisma.integrations.findFirst.mockResolvedValue({ ...integracaoViva })
    prisma.integrations.findUnique.mockResolvedValue({ ...integracaoViva })
    global.fetch = jest.fn().mockRejectedValue(new Error('ETIMEDOUT')) as any

    const status = await service.getConnectionStatus('company-uuid-1', true)

    expect(prisma.integrations.updateMany).not.toHaveBeenCalled()
    expect(status.connected).toBe(true)
    expect(status.needsReconnect).toBe(false)
  })
})

describe('MetaAdsOAuthService.disconnect', () => {
  it('limpa o flag SEM liberar a fila retida', async () => {
    const prisma: any = {
      integrations: {
        findFirst: jest.fn().mockResolvedValue({
          id: 7,
          companiesId: 'company-uuid-1',
          metaAccessToken: 'enc-token',
          metaOAuthMethod: 'MANUAL', // sem revoke fetch no Facebook
        }),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      triggerTrackingEvent: { updateMany: jest.fn() },
    }
    const service = new MetaAdsOAuthService(prisma, { get: jest.fn() } as any, {} as any)

    await service.disconnect('company-uuid-1')

    expect(prisma.integrations.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { metaTokenInvalidAt: null, metaTokenInvalidReason: null },
      }),
    )
    // Sem token nao ha o que enviar: liberar a fila so queimaria ciclos do cron.
    expect(prisma.triggerTrackingEvent.updateMany).not.toHaveBeenCalled()
  })
})

/**
 * Cron diario. Existe porque token morto so aparecia quando o CAPI enviava conversao, o
 * Dataset Quality rodava ou alguem abria a tela de Integracoes com ?probe=1 — um tenant
 * que so usa Meta Ads nao dispara nenhum dos tres e ficava morto em silencio.
 */
describe('MetaAdsOAuthService.probeAllActiveTokens', () => {
  const montar = async (integrations: any[]) => {
    const prisma: any = {
      integrations: {
        findMany: jest.fn().mockResolvedValue(integrations),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      triggerTrackingEvent: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      client: { companyMember: { findMany: jest.fn().mockResolvedValue([]) } },
    }
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MetaAdsOAuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: { get: jest.fn(() => 'v25.0') } },
        { provide: MetaLeadFormsService, useValue: {} },
      ],
    }).compile()
    return { service: module.get<MetaAdsOAuthService>(MetaAdsOAuthService), prisma }
  }

  const integracao = (id: number, companiesId: string) => ({
    id,
    companiesId,
    metaAccessToken: 'token',
    metaOAuthMethod: 'OAUTH',
  })

  beforeEach(() => jest.clearAllMocks())

  it('so busca integracoes ATIVAS, nao deletadas e com token gravado', async () => {
    const { service, prisma } = await montar([])

    await service.probeAllActiveTokens()

    expect(prisma.integrations.findMany).toHaveBeenCalledWith({
      where: {
        platform: { type: 'meta' },
        status: 'ACTIVE',
        deleted_at: null,
        metaAccessToken: { not: null },
      },
    })
  })

  it('sonda cada integracao e marca so as que responderam 190', async () => {
    // digienge/rther/horus dividem o mesmo usuario do Facebook: a troca de senha
    // derruba as tres de uma vez
    const { service, prisma } = await montar([
      integracao(101, 'digienge'),
      integracao(109, 'rther'),
      integracao(131, 'tfa'),
    ])
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({ json: async () => ({ error: { code: 190, error_subcode: 460, message: 'senha' } }) })
      .mockResolvedValueOnce({ json: async () => ({ error: { code: 190, error_subcode: 460, message: 'senha' } }) })
      .mockResolvedValueOnce({ json: async () => ({ id: 'fb-user-1' }) }) as any

    const resultado = await service.probeAllActiveTokens()

    expect(resultado).toEqual({ probed: 3 })
    expect(global.fetch).toHaveBeenCalledTimes(3)

    const marcacoes = prisma.integrations.updateMany.mock.calls.filter(
      ([arg]: any[]) => arg.data.metaTokenInvalidAt instanceof Date,
    )
    expect(marcacoes.map(([arg]: any[]) => arg.where.companiesId)).toEqual(['digienge', 'rther'])
  })

  it('com conta gravada, sonda a CONTA (nao /me) — token de System User nao tem /me util', async () => {
    const { service } = await montar([
      { ...integracao(112, 'maclo'), metaAppId: 'act_1292058248233713', metaOAuthMethod: 'MANUAL' },
    ])
    global.fetch = jest.fn().mockResolvedValue({ json: async () => ({ id: 'act_1292058248233713' }) }) as any

    await service.probeAllActiveTokens()

    const url = (global.fetch as jest.Mock).mock.calls[0][0]
    expect(url).toContain('/act_1292058248233713?fields=id,name,account_status')
    expect(url).not.toContain('/me?')
  })

  it('conta invisivel (100/33) NAO marca o token — o problema e a conta, nao a credencial', async () => {
    const { service, prisma } = await montar([
      { ...integracao(112, 'maclo'), metaAppId: 'act_999' },
    ])
    global.fetch = jest.fn().mockResolvedValue({
      json: async () => ({ error: { code: 100, error_subcode: 33, message: 'Unsupported get request' } }),
    }) as any

    await service.probeAllActiveTokens()

    expect(prisma.integrations.updateMany).not.toHaveBeenCalled()
  })

  it('ENCRYPTION_KEY divergente: nao sonda nem marca ninguem', async () => {
    // Cenario real: numa maquina cujo ENCRYPTION_KEY nao abre os tokens gravados, o
    // decrypt devolve o ciphertext em silencio. Mandar isso para a Meta rende um 190
    // ("Cannot parse access token") que NAO e token revogado — marcar as integracoes
    // por causa disso pediria reconexao a todo mundo sem motivo.
    const { looksEncrypted } = jest.requireMock('src/shared/util/encryption.utils')
    looksEncrypted.mockReturnValue(true)
    const { service, prisma } = await montar([integracao(101, 'digienge')])
    global.fetch = jest.fn() as any

    await expect(service.probeAllActiveTokens()).resolves.toEqual({ probed: 1 })

    expect(global.fetch).not.toHaveBeenCalled()
    expect(prisma.integrations.updateMany).not.toHaveBeenCalled()
    looksEncrypted.mockReturnValue(false)
  })

  it('erro de rede numa integracao nao aborta o lote nem marca ninguem', async () => {
    const { service, prisma } = await montar([integracao(101, 'digienge'), integracao(109, 'rther')])
    global.fetch = jest.fn().mockRejectedValue(new Error('ETIMEDOUT')) as any

    await expect(service.probeAllActiveTokens()).resolves.toEqual({ probed: 2 })
    expect(prisma.integrations.updateMany).not.toHaveBeenCalled()
  })
})
