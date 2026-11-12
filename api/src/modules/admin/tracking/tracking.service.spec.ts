import { HttpException, HttpStatus } from '@nestjs/common'
import { mockDeep, DeepMockProxy } from 'jest-mock-extended'
import { PrismaService } from 'src/database/prisma.service'
import { TrackingService } from './tracking.service'
import { TrackingEventService } from './services/tracking-event.service'
import { TrackingLeadService } from './services/tracking-lead.service'
import { TrackingAuthService } from './services/tracking-auth.service'
import { TrackingCollectService } from './services/tracking-collect.service'
import { TrackingQueryService } from './services/tracking-query.service'
import { TrackingQueueProducer } from './queue/tracking-queue.producer'
import { CompanyInactiveError } from 'src/shared/errors/company-inactive.error'
import { buildPageviewEvent } from 'test/builders/tracking.builder'

/**
 * Spec do TrackingService (facade) — apenas roteamento para sub-services.
 *
 * Cobre:
 *  - collectEvent delega para TrackingCollectService
 *  - createTrackingByKey faz validação + resolve auth + enfileira
 *  - hasRecentOptin delega para TrackingAuthService
 *  - getLeadTracking delega para TrackingQueryService
 */
describe('TrackingService', () => {
  let service: TrackingService
  let prisma: DeepMockProxy<PrismaService>
  let authService: jest.Mocked<TrackingAuthService>
  let collectService: jest.Mocked<TrackingCollectService>
  let queryService: jest.Mocked<TrackingQueryService>
  let queueProducer: jest.Mocked<TrackingQueueProducer>
  let companyStatus: { isActive: jest.Mock }

  beforeEach(() => {
    prisma = mockDeep<PrismaService>()
    authService = {
      hasRecentOptin: jest.fn().mockResolvedValue(false),
      findCampaignByKey: jest.fn().mockResolvedValue(null),
      findCompanyBySecretKey: jest.fn().mockResolvedValue(null),
    } as any
    collectService = { collectEvent: jest.fn().mockResolvedValue({ ok: true }) } as any
    queryService = { getLeadTracking: jest.fn().mockResolvedValue([]) } as any
    queueProducer = { enqueueTracking: jest.fn().mockResolvedValue(undefined) } as any
    companyStatus = { isActive: jest.fn().mockResolvedValue(true) }

    service = new TrackingService(
      prisma as any,
      {} as TrackingEventService,
      {} as TrackingLeadService,
      authService,
      collectService,
      queryService,
      queueProducer,
      companyStatus as any,
    )
  })

  describe('collectEvent (facade)', () => {
    it('delega para TrackingCollectService.collectEvent', async () => {
      const dto = buildPageviewEvent()
      const result = await service.collectEvent(dto, 'sub-1')

      expect(collectService.collectEvent).toHaveBeenCalledWith(dto, 'sub-1')
      expect(result).toEqual({ ok: true })
    })
  })

  describe('createTrackingByKey', () => {
    it('rejeita quando action está ausente', async () => {
      await expect(service.createTrackingByKey({ email: 'a@b.com' })).rejects.toThrow(
        new HttpException('O parâmetro action é obrigatório', HttpStatus.BAD_REQUEST),
      )
    })

    it('rejeita quando email e phone ausentes', async () => {
      await expect(service.createTrackingByKey({ action: 'OPTIN' })).rejects.toThrow(HttpException)
    })

    it('rejeita quando key e subdomain inválidos', async () => {
      await expect(
        service.createTrackingByKey({ action: 'OPTIN', email: 'a@b.com', key: 'bad', subdomain: 'nada' }),
      ).rejects.toThrow(
        new HttpException('Key ou subdomain inválido', HttpStatus.UNAUTHORIZED),
      )
    })

    it('resolve auth por campaign key e enfileira no RabbitMQ', async () => {
      authService.findCampaignByKey.mockResolvedValue({
        campaignId: 'c1',
        companyId: 'co1',
      } as any)

      const result = await service.createTrackingByKey({
        action: 'OPTIN',
        email: 'a@b.com',
        key: 'valid-key',
      })

      expect(queueProducer.enqueueTracking).toHaveBeenCalledWith(
        expect.objectContaining({
          authType: 'campaign',
          companyId: 'co1',
          campaignId: 'c1',
        }),
      )
      expect(result).toEqual({ ok: true })
    })

    it('resolve auth por company secret key', async () => {
      authService.findCompanyBySecretKey.mockResolvedValue({ id: 'co-xyz' } as any)

      await service.createTrackingByKey({
        action: 'OPTIN',
        email: 'a@b.com',
        key: 'secret-key',
        campaignId: 'cx',
      })

      expect(queueProducer.enqueueTracking).toHaveBeenCalledWith(
        expect.objectContaining({
          authType: 'company',
          companyId: 'co-xyz',
          campaignId: 'cx',
        }),
      )
    })

    it('fallback por subdomain', async () => {
      ;(prisma.client.companies.findFirst as any).mockResolvedValue({ id: 'co-sub' })

      await service.createTrackingByKey({
        action: 'OPTIN',
        email: 'a@b.com',
        subdomain: 'test',
      })

      expect(queueProducer.enqueueTracking).toHaveBeenCalledWith(
        expect.objectContaining({ companyId: 'co-sub' }),
      )
    })

    /**
     * Levantado em teste manual: o pixel da empresa desativada continuava criando Lead e
     * Customer EM TEXTO PURO, por cima do selo de `Customers`. Nenhum dos tres caminhos de
     * resolucao filtrava status — so `findCompanyBySecretKey` filtrava, no proprio WHERE.
     */
    describe('empresa inativa', () => {
      it('recusa a chave de CAMPANHA de empresa desativada', async () => {
        authService.findCampaignByKey.mockResolvedValue({ campaignId: 'c1', companyId: 'co1' } as any)
        companyStatus.isActive.mockResolvedValue(false)

        await expect(
          service.createTrackingByKey({ action: 'OPTIN', email: 'a@b.com', key: 'valid-key' }),
        ).rejects.toThrow(CompanyInactiveError)

        expect(queueProducer.enqueueTracking).not.toHaveBeenCalled()
      })

      it('recusa o fallback por SUBDOMINIO de empresa desativada', async () => {
        ;(prisma.client.companies.findFirst as any).mockResolvedValue({ id: 'co-sub' })
        companyStatus.isActive.mockResolvedValue(false)

        await expect(
          service.createTrackingByKey({ action: 'OPTIN', email: 'a@b.com', subdomain: 'test' }),
        ).rejects.toThrow(CompanyInactiveError)

        expect(queueProducer.enqueueTracking).not.toHaveBeenCalled()
      })

      it('recusa a secretKey de empresa desativada', async () => {
        authService.findCompanyBySecretKey.mockResolvedValue({ id: 'co-xyz' } as any)
        companyStatus.isActive.mockResolvedValue(false)

        await expect(
          service.createTrackingByKey({ action: 'OPTIN', email: 'a@b.com', key: 'secret-key' }),
        ).rejects.toThrow(CompanyInactiveError)
      })

      /** O status vem do CompanyStatusService porque as duas buscas de chave sao cacheadas 1h. */
      it('consulta o status pelo companyId resolvido, nao pela chave', async () => {
        authService.findCampaignByKey.mockResolvedValue({ campaignId: 'c1', companyId: 'co1' } as any)

        await service.createTrackingByKey({ action: 'OPTIN', email: 'a@b.com', key: 'valid-key' })

        expect(companyStatus.isActive).toHaveBeenCalledWith('co1')
      })
    })
  })

  describe('hasRecentOptin', () => {
    it('delega para TrackingAuthService.hasRecentOptin', async () => {
      authService.hasRecentOptin.mockResolvedValue(true)

      const result = await service.hasRecentOptin('a@b.com', 'co-1', 30)

      expect(authService.hasRecentOptin).toHaveBeenCalledWith('a@b.com', 'co-1', 30)
      expect(result).toBe(true)
    })
  })

  describe('getLeadTracking', () => {
    it('delega para TrackingQueryService.getLeadTracking', async () => {
      queryService.getLeadTracking.mockResolvedValue([{ id: 1 }] as any)

      const result = await service.getLeadTracking('a@b.com', '11999998888', 'co-1')

      expect(queryService.getLeadTracking).toHaveBeenCalledWith('a@b.com', '11999998888', 'co-1')
      expect(result).toEqual([{ id: 1 }])
    })
  })
})
