import { MetaLeadsRoutingService } from './meta-leads-routing.service'
import { MetaLeadData } from './types/meta-lead.types'

function createMockPrisma() {
  return {
    leads: {
      findFirst: jest.fn(),
    },
    adsPerformance: {
      findFirst: jest.fn(),
    },
  }
}

function createMockMetaLeadFormsService() {
  return {
    findCampaignByFormId: jest.fn(),
  }
}

function makeLeadData(overrides?: Partial<MetaLeadData>): MetaLeadData {
  return {
    id: 'lg_001',
    created_time: '2024-04-08T12:00:00+0000',
    field_data: [],
    ...overrides,
  }
}

describe('MetaLeadsRoutingService', () => {
  let service: MetaLeadsRoutingService
  let prisma: ReturnType<typeof createMockPrisma>
  let formsService: ReturnType<typeof createMockMetaLeadFormsService>

  const companyId = 'comp-test-001'

  beforeEach(() => {
    prisma = createMockPrisma()
    formsService = createMockMetaLeadFormsService()
    service = new MetaLeadsRoutingService(prisma as any, formsService as any)
    jest.clearAllMocks()
  })

  // ===== Priority Chain =====

  describe('findCampaignForLead', () => {
    it('Priority 0: should return campaign from explicit form mapping', async () => {
      formsService.findCampaignByFormId.mockResolvedValue('campaign-from-mapping')

      const result = await service.findCampaignForLead(companyId, makeLeadData(), 'page_1', 'form_1')

      expect(result).toBe('campaign-from-mapping')
      expect(formsService.findCampaignByFormId).toHaveBeenCalledWith('form_1', companyId)
      expect(prisma.leads.findFirst).not.toHaveBeenCalled()
    })

    it('Priority 1: should return campaign from existing lead with same form_id', async () => {
      formsService.findCampaignByFormId.mockResolvedValue(null)
      prisma.leads.findFirst.mockResolvedValueOnce({ campaignId: 'campaign-from-form-history' })

      const result = await service.findCampaignForLead(companyId, makeLeadData(), 'page_1', 'form_1')

      expect(result).toBe('campaign-from-form-history')
      expect(prisma.leads.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ form_id: 'form_1', companyId }),
        }),
      )
    })

    it('Priority 2: should return campaign from existing lead with same page_id', async () => {
      formsService.findCampaignByFormId.mockResolvedValue(null)
      prisma.leads.findFirst
        .mockResolvedValueOnce(null) // form_id query
        .mockResolvedValueOnce({ campaignId: 'campaign-from-page-history' }) // page_id query

      const result = await service.findCampaignForLead(companyId, makeLeadData(), 'page_1', 'form_1')

      expect(result).toBe('campaign-from-page-history')
    })

    it('Priority 3: should return campaign from AdsPerformance', async () => {
      formsService.findCampaignByFormId.mockResolvedValue(null)
      prisma.leads.findFirst.mockResolvedValue(null)
      prisma.adsPerformance.findFirst.mockResolvedValue({ campaignId: 'campaign-from-ads' })

      const leadData = makeLeadData({ campaign_id: 'meta_camp_123' })
      const result = await service.findCampaignForLead(companyId, leadData, 'page_1', 'form_1')

      expect(result).toBe('campaign-from-ads')
      expect(prisma.adsPerformance.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            externalCampaignId: 'meta_camp_123',
            companyId,
            campaignId: { not: null },
          }),
        }),
      )
    })

    it('Priority 4: should return null when no route found', async () => {
      formsService.findCampaignByFormId.mockResolvedValue(null)
      prisma.leads.findFirst.mockResolvedValue(null)
      prisma.adsPerformance.findFirst.mockResolvedValue(null)

      const leadData = makeLeadData({ campaign_id: 'camp_x' })
      const result = await service.findCampaignForLead(companyId, leadData, 'page_1', 'form_1')

      expect(result).toBeNull()
    })

    it('should skip form-based lookups when formId is empty', async () => {
      prisma.leads.findFirst.mockResolvedValueOnce({ campaignId: 'campaign-from-page' })

      const result = await service.findCampaignForLead(companyId, makeLeadData(), 'page_1', '')

      expect(formsService.findCampaignByFormId).not.toHaveBeenCalled()
      expect(result).toBe('campaign-from-page')
    })

    it('should skip page_id lookup when pageId is empty', async () => {
      formsService.findCampaignByFormId.mockResolvedValue(null)
      prisma.leads.findFirst.mockResolvedValue(null)

      const result = await service.findCampaignForLead(companyId, makeLeadData(), '', 'form_1')

      // leads.findFirst called once for form_id, NOT for page_id
      expect(prisma.leads.findFirst).toHaveBeenCalledTimes(1)
      expect(result).toBeNull()
    })

    it('should skip AdsPerformance lookup when campaign_id is undefined', async () => {
      formsService.findCampaignByFormId.mockResolvedValue(null)
      prisma.leads.findFirst.mockResolvedValue(null)

      const result = await service.findCampaignForLead(companyId, makeLeadData({ campaign_id: undefined }), 'page_1', 'form_1')

      expect(prisma.adsPerformance.findFirst).not.toHaveBeenCalled()
      expect(result).toBeNull()
    })

    it('should stop at first match (priority 0 found, no further queries)', async () => {
      formsService.findCampaignByFormId.mockResolvedValue('first-match')

      await service.findCampaignForLead(companyId, makeLeadData({ campaign_id: 'camp_x' }), 'page_1', 'form_1')

      expect(prisma.leads.findFirst).not.toHaveBeenCalled()
      expect(prisma.adsPerformance.findFirst).not.toHaveBeenCalled()
    })

    it('should always include companyId in queries (multi-tenant isolation)', async () => {
      formsService.findCampaignByFormId.mockResolvedValue(null)
      prisma.leads.findFirst.mockResolvedValue(null)
      prisma.adsPerformance.findFirst.mockResolvedValue(null)

      const leadData = makeLeadData({ campaign_id: 'camp_1' })
      await service.findCampaignForLead(companyId, leadData, 'page_1', 'form_1')

      expect(formsService.findCampaignByFormId).toHaveBeenCalledWith('form_1', companyId)

      for (const call of prisma.leads.findFirst.mock.calls) {
        expect(call[0].where).toHaveProperty('companyId', companyId)
      }

      expect(prisma.adsPerformance.findFirst.mock.calls[0][0].where).toHaveProperty('companyId', companyId)
    })
  })
})
