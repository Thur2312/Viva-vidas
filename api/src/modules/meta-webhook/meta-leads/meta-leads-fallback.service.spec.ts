import { MetaLeadsFallbackService } from './meta-leads-fallback.service'
import { makeChangeValue } from './__fixtures__/meta-lead-factories'
import { CreateLeadDto } from 'src/modules/admin/leads-management/dto/create-leads-management.dto'

jest.mock('src/shared/util/utils', () => ({
  formatPhone: jest.fn((p: string) => p),
  formatName: jest.fn((n: string) => n),
  parseUtms: jest.fn((u: string) => {
    if (!u) return {}
    const params: Record<string, string> = {}
    u.split('&').forEach(part => {
      const [k, v] = part.split('=')
      if (k && v) params[k] = v
    })
    return params
  }),
}))

function createMockPrisma() {
  return {
    events: {
      create: jest.fn(),
    },
    leads: {
      findFirst: jest.fn(),
      create: jest.fn(),
    },
    customers: {
      findFirst: jest.fn(),
      create: jest.fn(),
    },
    genericDnd: {
      findFirst: jest.fn(),
      create: jest.fn(),
    },
    $transaction: jest.fn(),
  }
}

function createMockLeadsUsageService() {
  return {
    incrementLeadCount: jest.fn().mockResolvedValue(undefined),
    logLeadOverage: jest.fn().mockResolvedValue(undefined),
  }
}

function makeCreateLeadDto(overrides?: Partial<CreateLeadDto>): CreateLeadDto {
  return {
    name: 'Test Lead',
    email: 'test@example.com',
    phone: '+5511999887766',
    city: 'Sao Paulo',
    state: 'SP',
    source: 'Meta Lead Ads',
    canal: 'facebook',
    companyId: 'comp-test-001',
    utms: '',
    externalUserId: 'lg_test_001',
    page_id: 'page_123',
    form_id: 'form_456',
    ...overrides,
  }
}

describe('MetaLeadsFallbackService', () => {
  let service: MetaLeadsFallbackService
  let prisma: ReturnType<typeof createMockPrisma>
  let leadsUsage: ReturnType<typeof createMockLeadsUsageService>

  const companyId = 'comp-test-001'

  beforeEach(() => {
    prisma = createMockPrisma()
    leadsUsage = createMockLeadsUsageService()
    service = new MetaLeadsFallbackService(prisma as any, leadsUsage as any)
    jest.clearAllMocks()
  })

  // ===== saveRawEvent =====

  describe('saveRawEvent', () => {
    it('should create Events record with source, reason and change value fields', async () => {
      const changeValue = makeChangeValue({ leadgen_id: 'lg_999' })

      await service.saveRawEvent(companyId, changeValue, 'NO_ACCESS_TOKEN')

      expect(prisma.events.create).toHaveBeenCalledWith({
        data: {
          companyId,
          platformData: expect.objectContaining({
            source: 'meta_lead_ads',
            reason: 'NO_ACCESS_TOKEN',
            leadgen_id: 'lg_999',
            form_id: changeValue.form_id,
            page_id: changeValue.page_id,
          }),
        },
      })
    })

    it('should include lead_data when provided', async () => {
      const changeValue = makeChangeValue()
      const leadData = { id: 'lg_001', created_time: '2024', field_data: [] } as any

      await service.saveRawEvent(companyId, changeValue, 'GRAPH_API_ERROR', leadData)

      const callData = prisma.events.create.mock.calls[0][0].data.platformData
      expect(callData.lead_data).toEqual(leadData)
    })

    it('should set lead_data to null when not provided', async () => {
      const changeValue = makeChangeValue()

      await service.saveRawEvent(companyId, changeValue, 'FETCH_FAILED')

      const callData = prisma.events.create.mock.calls[0][0].data.platformData
      expect(callData.lead_data).toBeNull()
    })

    it('should not throw when prisma.events.create fails', async () => {
      prisma.events.create.mockRejectedValue(new Error('DB error'))

      await expect(
        service.saveRawEvent(companyId, makeChangeValue(), 'ERROR'),
      ).resolves.not.toThrow()
    })
  })

  // ===== createLeadWithoutCampaign =====

  describe('createLeadWithoutCampaign', () => {
    beforeEach(() => {
      // Default: no existing lead, customer created, board created
      prisma.leads.findFirst.mockResolvedValue(null)
      prisma.customers.findFirst.mockResolvedValue(null)
      prisma.customers.create.mockResolvedValue({ customerId: 42 })
      prisma.genericDnd.findFirst.mockResolvedValue(null)
      prisma.genericDnd.create.mockResolvedValue({ id: 'dnd-1' })
      prisma.leads.create.mockResolvedValue({ id: 1, name: 'Test Lead', email: 'test@example.com', source: 'Meta Lead Ads' })
      prisma.$transaction.mockImplementation(async (cb: any) => {
        const tx = {
          genericDndCard: { create: jest.fn().mockResolvedValue({ id: 'card-1' }) },
          genericDndColumnSet: {
            findMany: jest.fn().mockResolvedValue([{
              id: 'set-1',
              columns: [{ id: 'col-1', position: 0 }],
            }]),
            create: jest.fn(),
          },
          genericDndCardPosition: {
            count: jest.fn().mockResolvedValue(0),
            create: jest.fn(),
          },
        }
        return cb(tx)
      })
    })

    it('should create new lead when no existing match found', async () => {
      const dto = makeCreateLeadDto()

      await service.createLeadWithoutCampaign(companyId, dto)

      expect(prisma.leads.create).toHaveBeenCalledTimes(1)
      expect(prisma.leads.create.mock.calls[0][0].data).toMatchObject({
        companyId,
        source: 'Meta Lead Ads',
        page_id: 'page_123',
        form_id: 'form_456',
      })
    })

    it('should return existing lead when matched by externalUserId (dedup)', async () => {
      const existingLead = { id: 99, name: 'Existing', externalUserId: 'lg_test_001' }
      prisma.leads.findFirst.mockResolvedValue(existingLead)

      const result = await service.createLeadWithoutCampaign(companyId, makeCreateLeadDto())

      expect(result).toEqual(existingLead)
      expect(prisma.leads.create).not.toHaveBeenCalled()
    })

    it('should dedup query include externalUserId, email, and phone in OR', async () => {
      prisma.leads.findFirst.mockResolvedValue(null)
      const dto = makeCreateLeadDto({ externalUserId: 'lg_x', email: 'a@b.com', phone: '+5511' })

      await service.createLeadWithoutCampaign(companyId, dto)

      const where = prisma.leads.findFirst.mock.calls[0][0].where
      expect(where.AND).toBeDefined()
      const orClause = where.AND[0].OR
      expect(orClause).toEqual(
        expect.arrayContaining([
          { externalUserId: 'lg_x' },
          { email: 'a@b.com' },
          { phone: '+5511' },
        ]),
      )
    })

    it('should always filter dedup by companyId', async () => {
      prisma.leads.findFirst.mockResolvedValue(null)

      await service.createLeadWithoutCampaign(companyId, makeCreateLeadDto())

      const where = prisma.leads.findFirst.mock.calls[0][0].where
      expect(where.AND[1]).toEqual({ companyId })
    })

    it('should create customer when none exists for email', async () => {
      prisma.customers.findFirst.mockResolvedValue(null)

      await service.createLeadWithoutCampaign(companyId, makeCreateLeadDto())

      expect(prisma.customers.create).toHaveBeenCalledTimes(1)
    })

    it('should reuse existing customer when found by email', async () => {
      prisma.customers.findFirst.mockResolvedValue({ customerId: 77 })

      await service.createLeadWithoutCampaign(companyId, makeCreateLeadDto())

      expect(prisma.customers.create).not.toHaveBeenCalled()
      expect(prisma.leads.create.mock.calls[0][0].data.customerId).toBe(77)
    })

    it('should find or create "Leads" GenericDnd board', async () => {
      prisma.genericDnd.findFirst.mockResolvedValue(null)

      await service.createLeadWithoutCampaign(companyId, makeCreateLeadDto())

      expect(prisma.genericDnd.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { title: 'Leads', companyId },
        }),
      )
      expect(prisma.genericDnd.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ title: 'Leads', companyId, type: 'lead' }),
        }),
      )
    })

    it('should reuse existing "Leads" board', async () => {
      prisma.genericDnd.findFirst.mockResolvedValue({ id: 'existing-dnd' })

      await service.createLeadWithoutCampaign(companyId, makeCreateLeadDto())

      expect(prisma.genericDnd.create).not.toHaveBeenCalled()
    })

    it('should call leadsUsageService.incrementLeadCount fire-and-forget', async () => {
      await service.createLeadWithoutCampaign(companyId, makeCreateLeadDto())

      expect(leadsUsage.incrementLeadCount).toHaveBeenCalledWith(companyId)
    })

    it('should call leadsUsageService.logLeadOverage fire-and-forget', async () => {
      await service.createLeadWithoutCampaign(companyId, makeCreateLeadDto())

      expect(leadsUsage.logLeadOverage).toHaveBeenCalledWith(
        expect.objectContaining({
          companyId,
          campaignId: null,
          campaignName: null,
        }),
      )
    })

    it('should persist all Meta Lead fields in created lead', async () => {
      const dto = makeCreateLeadDto({
        ad_id: 'ad_test',
        ad_name: 'Ad Test',
        adset_id: 'adset_test',
        adset_name: 'Adset Test',
        street_address: 'Rua X',
        zip_code: '01001',
        country: 'Brasil',
        date_of_birth: '1990-01-01',
        gender: 'M',
        cpf: '123.456.789-00',
        marital_status: 'Solteiro',
        first_name: 'John',
        last_name: 'Doe',
        work_email: 'work@test.com',
        work_phone_number: '+551130001000',
        meta_campaign_id: 'mc_1',
        meta_campaign_name: 'Campaign X',
        is_organic: true,
        meta_created_time: '2024-04-08T12:00:00',
        military_status: 'N/A',
        relationship_status: 'Single',
      })

      await service.createLeadWithoutCampaign(companyId, dto)

      const data = prisma.leads.create.mock.calls[0][0].data
      expect(data.ad_id).toBe('ad_test')
      expect(data.ad_name).toBe('Ad Test')
      expect(data.adset_id).toBe('adset_test')
      expect(data.street_address).toBe('Rua X')
      expect(data.cpf).toBe('123.456.789-00')
      expect(data.first_name).toBe('John')
      expect(data.last_name).toBe('Doe')
      expect(data.work_email).toBe('work@test.com')
      expect(data.meta_campaign_id).toBe('mc_1')
      expect(data.is_organic).toBe(true)
      expect(data.military_status).toBe('N/A')
      expect(data.relationship_status).toBe('Single')
    })

    it('should run GenericDndCard creation in a $transaction', async () => {
      await service.createLeadWithoutCampaign(companyId, makeCreateLeadDto())

      expect(prisma.$transaction).toHaveBeenCalledTimes(1)
    })
  })
})
