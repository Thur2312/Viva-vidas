import { Reflector } from '@nestjs/core'
import { TrackingController } from './tracking.controller'
import { TrackingService } from './tracking.service'
import { TrackingAnalyticsService } from './services/tracking-analytics.service'
import { TrackingActionConfigService } from './services/tracking-action-config.service'
import { IS_PUBLIC_KEY } from 'src/modules/auth/public.decorator'
import { buildPageviewEvent, buildFormSubmitEvent } from 'test/builders/tracking.builder'

/**
 * Spec do TrackingController — garante que:
 *  - POST /tracking/collect/:subdomain delega para TrackingService.collectEvent
 *  - A rota está marcada como @Public (não exige JWT)
 *  - GET /tracking/list/:companyId delega para service.getLeadTracking
 *  - GET /tracking/events/* delegam para TrackingAnalyticsService
 *
 * O controller é uma camada fina de roteamento; sua lógica é mínima.
 */
describe('TrackingController', () => {
  let controller: TrackingController
  let service: jest.Mocked<TrackingService>
  let analyticsService: jest.Mocked<TrackingAnalyticsService>
  let actionConfigService: jest.Mocked<TrackingActionConfigService>
  let actionConfigAuditService: any

  beforeEach(() => {
    service = {
      collectEvent: jest.fn().mockResolvedValue({ ok: true }),
      getLeadTracking: jest.fn().mockResolvedValue([]),
    } as any

    analyticsService = {
      filterTrackingEvents: jest.fn().mockResolvedValue({ data: [], total: 0, page: 1, limit: 25, totalPages: 1 }),
      getVisitorTimeline: jest.fn().mockResolvedValue({ visitorId: '', identity: null, identities: [], events: [] }),
      getTrackingFilterOptions: jest.fn().mockResolvedValue({ events: [], campaigns: [] }),
    } as any

    actionConfigService = {
      list: jest.fn().mockResolvedValue([]),
      upsertMany: jest.fn().mockResolvedValue([]),
      remove: jest.fn().mockResolvedValue({ removed: 0 }),
    } as any

    actionConfigAuditService = {
      list: jest.fn().mockResolvedValue({ logs: [], total: 0, skip: 0, take: 50 }),
    } as any

    controller = new TrackingController(
      service,
      analyticsService,
      actionConfigService,
      actionConfigAuditService,
    )
  })

  describe('POST /tracking/collect/:subdomain', () => {
    it('está definido', () => {
      expect(controller).toBeDefined()
      expect(controller.collectEvent).toBeDefined()
    })

    it('delega para service.collectEvent com dto e subdomain', async () => {
      const dto = buildPageviewEvent()
      const result = await controller.collectEvent('my-subdomain', dto)

      expect(service.collectEvent).toHaveBeenCalledWith(dto, 'my-subdomain')
      expect(service.collectEvent).toHaveBeenCalledTimes(1)
      expect(result).toEqual({ ok: true })
    })

    it('propaga erros do service (ex: DTO inválido)', async () => {
      service.collectEvent.mockRejectedValue(new Error('client_hash inválido'))
      const dto = buildPageviewEvent({ client_hash: '' })

      await expect(controller.collectEvent('sub', dto)).rejects.toThrow('client_hash inválido')
    })

    it('funciona com form_submit (event completo)', async () => {
      const dto = buildFormSubmitEvent({ form_email: 'a@b.com' })
      await controller.collectEvent('my-sub', dto)

      expect(service.collectEvent).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'form_submit', form_email: 'a@b.com' }),
        'my-sub',
      )
    })

    it('é público (decorator @Public aplicado via reflect-metadata)', () => {
      const reflector = new Reflector()
      const isPublic = reflector.get<boolean>(IS_PUBLIC_KEY, controller.collectEvent)
      expect(isPublic).toBe(true)
    })
  })

  describe('GET /tracking/list/:companyId', () => {
    it('delega para service.getLeadTracking com email + phone + companyId', async () => {
      service.getLeadTracking.mockResolvedValue([{ id: 1 }] as any)

      const result = await controller.getLeadTracking('co-1', 'a@b.com', '11999998888')

      expect(service.getLeadTracking).toHaveBeenCalledWith('a@b.com', '11999998888', 'co-1')
      expect(result).toEqual([{ id: 1 }])
    })

    it('passa strings vazias corretamente quando params ausentes', async () => {
      await controller.getLeadTracking('co-1', undefined as any, undefined as any)
      expect(service.getLeadTracking).toHaveBeenCalledWith(undefined, undefined, 'co-1')
    })
  })

  describe('GET /tracking/events/filter/:companyId', () => {
    it('delega para analyticsService.filterTrackingEvents com filtros', async () => {
      const filters = { events: ['pageview'], page: 2, limit: 50 }
      await controller.filterTrackingEvents('co-1', filters as any)
      expect(analyticsService.filterTrackingEvents).toHaveBeenCalledWith('co-1', filters)
    })
  })

  describe('GET /tracking/events/visitor/:companyId/:visitorId', () => {
    it('delega para analyticsService.getVisitorTimeline', async () => {
      await controller.getVisitorTimeline('co-1', '11111111-2222-4333-8444-555555555555')
      expect(analyticsService.getVisitorTimeline).toHaveBeenCalledWith(
        'co-1',
        '11111111-2222-4333-8444-555555555555',
      )
    })
  })

  describe('GET /tracking/events/filter-options/:companyId', () => {
    it('delega para analyticsService.getTrackingFilterOptions', async () => {
      await controller.getTrackingFilterOptions('co-1')
      expect(analyticsService.getTrackingFilterOptions).toHaveBeenCalledWith('co-1')
    })
  })
})
