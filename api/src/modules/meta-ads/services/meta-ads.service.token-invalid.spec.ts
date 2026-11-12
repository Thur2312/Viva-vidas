import { Test, TestingModule } from '@nestjs/testing'
import { BadRequestException } from '@nestjs/common'
import { PrismaService } from 'src/database/prisma.service'
import { UserNotificationService } from 'src/modules/admin/notifications/user-notification.service'
import {
  META_TOKEN_INVALID_MESSAGE,
  META_TOKEN_DECRYPT_FAILED_MESSAGE,
} from 'src/shared/util/meta-token-invalid.utils'
import { RedisService } from 'src/shared/redis/redis.service'
import { FileStorageService } from '../../files/storage/file-storage.service'
import { AdsPerformanceService } from '../../ads-performance/ads-performance.service'
import { MetaAdsMapper } from '../mappers/meta-ads.mapper'
import { InsightsSyncStrategy } from '../strategies/insights-sync.strategy'
import { AdsSyncStrategy } from '../strategies/ads-sync.strategy'
import { BreakdownSyncStrategy } from '../strategies/breakdown-sync.strategy'
import { MetaGraphError } from '../strategies/base-sync.strategy'
import { MetaAdsService } from './meta-ads.service'

jest.mock('src/shared/util/encryption.utils', () => ({
  decryptIntegrationData: jest.fn((v: any) => v),
  looksEncrypted: jest.fn(() => false),
}))

const { looksEncrypted } = jest.requireMock('src/shared/util/encryption.utils')

/**
 * O sync de Ads era o unico caminho Meta fora da maquina de estados de token invalido
 * criada no incidente de 28/08. Em 31/08 a digienge repetiu o incidente: os 105 chunks
 * falharam com 190/460, o sync devolveu `errors: 0` e ainda carimbou `metaLastSync`
 * como se tivesse sincronizado — com a tela seguindo em "conectado".
 */
describe('MetaAdsService — token Meta revogado', () => {
  const COMPANY = 'company-uuid-1'
  const TOKEN_REVOGADO = {
    message:
      'Error validating access token: The session has been invalidated because the user ' +
      'changed their password or Facebook has changed the session for security reasons.',
    type: 'OAuthException',
    code: 190,
    error_subcode: 460,
  }

  const integracaoAtiva = {
    id: 101,
    companiesId: COMPANY,
    metaAccessToken: 'token-vivo',
    metaAppId: 'act_1292058248233713',
    metaOAuthMethod: 'OAUTH',
    metaTokenExpiresAt: new Date(Date.now() + 9 * 24 * 60 * 60 * 1000),
    metaTokenInvalidAt: null,
  }

  let service: MetaAdsService
  let prisma: any
  let insightsStrategy: { sync: jest.Mock }
  let breakdownStrategy: { syncBreakdowns: jest.Mock }
  let notifications: { create: jest.Mock }

  beforeEach(async () => {
    jest.clearAllMocks()
    looksEncrypted.mockReturnValue(false)

    prisma = {
      integrations: {
        findFirst: jest.fn().mockResolvedValue(integracaoAtiva),
        update: jest.fn().mockResolvedValue({}),
        // markMetaTokenInvalid: count > 0 = transicao valido -> invalido
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      triggerTrackingEvent: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      companies: { findFirst: jest.fn().mockResolvedValue({ subdomain: 'digienge' }) },
      client: {
        integrations: { update: jest.fn().mockResolvedValue({}) },
        companies: { findFirst: jest.fn().mockResolvedValue({ subdomain: 'digienge' }) },
        companyMember: { findMany: jest.fn().mockResolvedValue([{ userId: 'user-owner' }]) },
      },
    }

    insightsStrategy = { sync: jest.fn() }
    breakdownStrategy = { syncBreakdowns: jest.fn() }
    notifications = { create: jest.fn().mockResolvedValue(undefined) }

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MetaAdsService,
        { provide: PrismaService, useValue: prisma },
        { provide: MetaAdsMapper, useValue: {} },
        { provide: InsightsSyncStrategy, useValue: insightsStrategy },
        { provide: AdsSyncStrategy, useValue: { sync: jest.fn() } },
        { provide: BreakdownSyncStrategy, useValue: breakdownStrategy },
        { provide: AdsPerformanceService, useValue: { autoLinkNewRecords: jest.fn() } },
        { provide: RedisService, useValue: { del: jest.fn(), delByPattern: jest.fn() } },
        { provide: FileStorageService, useValue: {} },
        { provide: UserNotificationService, useValue: notifications },
      ],
    }).compile()

    service = module.get(MetaAdsService)
    jest.spyOn((service as any).logger, 'log').mockImplementation(() => {})
    jest.spyOn((service as any).logger, 'error').mockImplementation(() => {})
  })

  it('190/460 no sync marca a integracao, notifica o gestor e devolve 400', async () => {
    insightsStrategy.sync.mockRejectedValue(new MetaGraphError(TOKEN_REVOGADO))

    await expect(service.syncInsightsToDatabase({ companyId: COMPANY } as any)).rejects.toThrow(
      new BadRequestException(META_TOKEN_INVALID_MESSAGE)
    )

    expect(prisma.integrations.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ companiesId: COMPANY, metaTokenInvalidAt: null }),
        data: expect.objectContaining({ metaTokenInvalidReason: TOKEN_REVOGADO.message }),
      })
    )
    expect(notifications.create).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'meta.token_invalid', userId: 'user-owner' })
    )
  })

  it('NAO carimba metaLastSync quando o sync morreu no token', async () => {
    insightsStrategy.sync.mockRejectedValue(new MetaGraphError(TOKEN_REVOGADO))

    await expect(
      service.syncInsightsToDatabase({ companyId: COMPANY } as any)
    ).rejects.toBeInstanceOf(BadRequestException)

    expect(prisma.client.integrations.update).not.toHaveBeenCalled()
  })

  it('nao renotifica quando o flag ja estava setado (updateMany sem transicao)', async () => {
    prisma.integrations.updateMany.mockResolvedValue({ count: 0 })
    insightsStrategy.sync.mockRejectedValue(new MetaGraphError(TOKEN_REVOGADO))

    await expect(
      service.syncInsightsToDatabase({ companyId: COMPANY } as any)
    ).rejects.toBeInstanceOf(BadRequestException)

    expect(notifications.create).not.toHaveBeenCalled()
  })

  it('flag ja setado: recusa antes de chamar a Meta', async () => {
    prisma.integrations.findFirst.mockResolvedValue({
      ...integracaoAtiva,
      metaTokenInvalidAt: new Date('2026-08-31T12:46:18Z'),
    })

    await expect(service.syncInsightsToDatabase({ companyId: COMPANY } as any)).rejects.toThrow(
      new BadRequestException(META_TOKEN_INVALID_MESSAGE)
    )

    // zero chamada a Graph API: e o que impede o segundo disparo de queimar outras 210
    expect(insightsStrategy.sync).not.toHaveBeenCalled()
  })

  it('rate limit nao marca a integracao nem vira erro de credencial', async () => {
    insightsStrategy.sync.mockRejectedValue(
      new MetaGraphError({ code: 17, message: 'User request limit reached' })
    )

    await expect(
      service.syncInsightsToDatabase({ companyId: COMPANY } as any)
    ).rejects.not.toBeInstanceOf(BadRequestException)

    expect(prisma.integrations.updateMany).not.toHaveBeenCalled()
    expect(notifications.create).not.toHaveBeenCalled()
  })

  describe('ENCRYPTION_KEY divergente nao pode virar "token revogado"', () => {
    // decrypt() devolve o ciphertext intacto quando a chave nao abre o dado. Em 31/08 isso
    // fez a conta virar `act_b25333ac…:4a98…`, a Meta responder 190 "Cannot parse access
    // token" e a integracao 101 ser marcada como revogada — pedindo uma reconexao que nao
    // curava nada e bloqueando todo sync seguinte.
    it('token em ciphertext: recusa sem chamar a Meta e sem marcar', async () => {
      looksEncrypted.mockImplementation((v: string) => v === 'token-vivo')

      await expect(service.syncInsightsToDatabase({ companyId: COMPANY } as any)).rejects.toThrow(
        new BadRequestException(META_TOKEN_DECRYPT_FAILED_MESSAGE)
      )

      expect(insightsStrategy.sync).not.toHaveBeenCalled()
      expect(prisma.integrations.updateMany).not.toHaveBeenCalled()
      expect(notifications.create).not.toHaveBeenCalled()
    })

    it('so a conta em ciphertext ja basta — act_<ciphertext> e requisicao condenada', async () => {
      looksEncrypted.mockImplementation((v: string) => v === 'act_1292058248233713')

      await expect(
        service.syncInsightsToDatabase({ companyId: COMPANY } as any)
      ).rejects.toThrow(new BadRequestException(META_TOKEN_DECRYPT_FAILED_MESSAGE))

      expect(insightsStrategy.sync).not.toHaveBeenCalled()
    })

    it('190 "Cannot parse access token" vindo da Meta NAO marca a integracao', async () => {
      insightsStrategy.sync.mockRejectedValue(
        new MetaGraphError({
          message: 'Invalid OAuth access token - Cannot parse access token',
          type: 'OAuthException',
          code: 190,
        })
      )

      await expect(service.syncInsightsToDatabase({ companyId: COMPANY } as any)).rejects.toThrow(
        new BadRequestException(META_TOKEN_DECRYPT_FAILED_MESSAGE)
      )

      expect(prisma.integrations.updateMany).not.toHaveBeenCalled()
      expect(notifications.create).not.toHaveBeenCalled()
    })

    it('mas 190/460 "session has been invalidated" continua marcando', async () => {
      insightsStrategy.sync.mockRejectedValue(new MetaGraphError(TOKEN_REVOGADO))

      await expect(
        service.syncInsightsToDatabase({ companyId: COMPANY } as any)
      ).rejects.toBeInstanceOf(BadRequestException)

      expect(prisma.integrations.updateMany).toHaveBeenCalled()
    })
  })

  it('nenhum caminho de credencial devolve 401 — 401 desloga o usuario do HDM', async () => {
    const cenarios = [
      async () => {
        prisma.integrations.findFirst.mockResolvedValue({
          ...integracaoAtiva,
          metaTokenInvalidAt: new Date(),
        })
      },
      async () => {
        looksEncrypted.mockImplementation((v: string) => v === 'token-vivo')
      },
      async () => {
        insightsStrategy.sync.mockRejectedValue(new MetaGraphError(TOKEN_REVOGADO))
      },
    ]

    for (const preparar of cenarios) {
      jest.clearAllMocks()
      prisma.integrations.findFirst.mockResolvedValue(integracaoAtiva)
      prisma.integrations.updateMany.mockResolvedValue({ count: 1 })
      looksEncrypted.mockReturnValue(false)
      await preparar()

      const erro: any = await service
        .syncInsightsToDatabase({ companyId: COMPANY } as any)
        .catch((e) => e)

      expect(erro.getStatus?.()).not.toBe(401)
      expect(erro.getStatus?.()).toBe(400)
    }
  })

  it('o sync de breakdowns passa pelo mesmo tratamento', async () => {
    breakdownStrategy.syncBreakdowns.mockRejectedValue(new MetaGraphError(TOKEN_REVOGADO))

    await expect(service.syncBreakdownsToDatabase({ companyId: COMPANY } as any)).rejects.toThrow(
      new BadRequestException(META_TOKEN_INVALID_MESSAGE)
    )

    expect(prisma.integrations.updateMany).toHaveBeenCalled()
  })
})
