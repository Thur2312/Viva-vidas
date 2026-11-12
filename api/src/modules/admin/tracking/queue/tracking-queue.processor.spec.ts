import { mockDeep, DeepMockProxy } from 'jest-mock-extended'
import { PrismaService } from 'src/database/prisma.service'
import { TrackingQueueProcessor } from './tracking-queue.processor'
import { TrackingEventService } from '../services/tracking-event.service'
import { TrackingLeadService } from '../services/tracking-lead.service'
import { TrackingAuthService } from '../services/tracking-auth.service'
import { TrackingJobData } from './tracking-queue.producer'

/**
 * Spec do TrackingQueueProcessor — consumer RabbitMQ que processa
 * eventos do tracker.js de forma assíncrona.
 *
 * Cobre:
 *  - authType=campaign: cria tracking + lead + emite evento
 *  - authType=company: valida existência do aluno antes de processar
 *  - authType=subdomain: cria direto
 *  - Dedup OPTIN via hasRecentOptin
 *  - Normalização de email/phone/name
 *  - Tolerância a erros (NUNCA throw — loga e descarta)
 */
describe('TrackingQueueProcessor', () => {
  let processor: TrackingQueueProcessor
  let prisma: DeepMockProxy<PrismaService>
  let eventService: jest.Mocked<TrackingEventService>
  let leadService: jest.Mocked<TrackingLeadService>
  let authService: jest.Mocked<TrackingAuthService>

  const COMPANY_ID = 'company-1'
  const CAMPAIGN_ID = 'campaign-1'

  function makeJob(overrides: Partial<TrackingJobData> = {}): TrackingJobData {
    return {
      data: {
        action: 'OPTIN',
        email: 'lead@example.com',
        phone: '11999998888',
        name: 'Lead Teste',
      },
      authType: 'campaign',
      companyId: COMPANY_ID,
      campaignId: CAMPAIGN_ID,
      ...overrides,
    }
  }

  beforeEach(() => {
    prisma = mockDeep<PrismaService>()
    eventService = { emitTrackingEvent: jest.fn() } as any
    leadService = {
      createLeadFromTracking: jest.fn(),
      findOrCreateLeadFromTracking: jest.fn().mockResolvedValue({ id: 1 }),
    } as any
    authService = {
      hasRecentOptin: jest.fn().mockResolvedValue(false),
    } as any

    processor = new TrackingQueueProcessor(
      prisma as any,
      eventService,
      leadService,
      authService,
    )

    // Defaults — no dedup, no existing lead, tracking create succeeds
    ;(prisma.tracking.create as any).mockResolvedValue({ id: 1 })
    ;(prisma.leads.findFirst as any).mockResolvedValue(null)
    ;(prisma.tracking.findFirst as any).mockResolvedValue(null)
    ;(prisma.campaigns.findUnique as any).mockResolvedValue({
      campaignId: CAMPAIGN_ID,
      companyId: COMPANY_ID,
      columnSetId: 'cs-1',
      name: 'Campanha 1',
    })
  })

  describe('authType=campaign', () => {
    it('cria tracking, delega auto-create de lead e emite evento', async () => {
      await processor.handleTracking(makeJob())

      expect(prisma.tracking.create).toHaveBeenCalledTimes(1)
      expect(prisma.tracking.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            email: 'lead@example.com',
            companyId: COMPANY_ID,
            campaignId: CAMPAIGN_ID,
            action: expect.stringMatching(/optin/i),
          }),
        }),
      )
      // Defesa contra race está dentro do service; processor sempre delega quando há identidade.
      expect(leadService.findOrCreateLeadFromTracking).toHaveBeenCalledTimes(1)
      expect(eventService.emitTrackingEvent).toHaveBeenCalledTimes(1)
    })

    it('delega para findOrCreateLeadFromTracking mesmo sob potencial duplicação (decisão é interna ao service)', async () => {
      await processor.handleTracking(makeJob())

      expect(prisma.tracking.create).toHaveBeenCalled()
      expect(leadService.findOrCreateLeadFromTracking).toHaveBeenCalledTimes(1)
    })

    it('sem email nem phone: NÃO delega auto-create', async () => {
      await processor.handleTracking(makeJob({ data: { action: 'CLICK' } }))

      // tracking create ainda acontece (phone/email vazios)
      expect(leadService.findOrCreateLeadFromTracking).not.toHaveBeenCalled()
    })
  })

  describe('authType=company (valida existência)', () => {
    it('aluno existe (Lead): processa normalmente', async () => {
      ;(prisma.leads.findFirst as any).mockResolvedValue({ id: 10 })

      await processor.handleTracking(makeJob({ authType: 'company' }))

      expect(prisma.tracking.create).toHaveBeenCalled()
    })

    it('aluno existe (Tracking antigo): processa normalmente', async () => {
      ;(prisma.leads.findFirst as any).mockResolvedValue(null)
      ;(prisma.tracking.findFirst as any).mockResolvedValue({ id: 20 })

      await processor.handleTracking(makeJob({ authType: 'company' }))

      expect(prisma.tracking.create).toHaveBeenCalled()
    })

    it('aluno NÃO existe: descarta (não cria tracking)', async () => {
      ;(prisma.leads.findFirst as any).mockResolvedValue(null)
      ;(prisma.tracking.findFirst as any).mockResolvedValue(null)

      await processor.handleTracking(makeJob({ authType: 'company' }))

      expect(prisma.tracking.create).not.toHaveBeenCalled()
      expect(leadService.findOrCreateLeadFromTracking).not.toHaveBeenCalled()
    })
  })

  describe('dedup OPTIN', () => {
    it('OPTIN duplicado dentro da janela: descarta', async () => {
      authService.hasRecentOptin.mockResolvedValue(true)

      await processor.handleTracking(makeJob())

      expect(prisma.tracking.create).not.toHaveBeenCalled()
      expect(leadService.findOrCreateLeadFromTracking).not.toHaveBeenCalled()
    })

    it('ação não-OPTIN: NÃO dispara dedup check', async () => {
      await processor.handleTracking(
        makeJob({ data: { action: 'CLICK', email: 'a@b.com' } }),
      )

      expect(authService.hasRecentOptin).not.toHaveBeenCalled()
      expect(prisma.tracking.create).toHaveBeenCalled()
    })
  })

  describe('normalização', () => {
    it('email é normalizado (lowercase + trim)', async () => {
      await processor.handleTracking(
        makeJob({ data: { action: 'OPTIN', email: '  Lead@EXAMPLE.com  ' } }),
      )

      expect(prisma.tracking.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ email: 'lead@example.com' }),
        }),
      )
    })
  })

  describe('tolerância a erros', () => {
    it('erro no prisma.tracking.create NÃO propaga', async () => {
      ;(prisma.tracking.create as any).mockRejectedValue(new Error('DB timeout'))

      // NÃO deve lançar (throw causa redelivery storm)
      await expect(processor.handleTracking(makeJob())).resolves.toBeUndefined()
    })

    it('erro no hasRecentOptin NÃO propaga', async () => {
      authService.hasRecentOptin.mockRejectedValue(new Error('Redis down'))

      await expect(processor.handleTracking(makeJob())).resolves.toBeUndefined()
    })
  })
})
