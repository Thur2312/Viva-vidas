import { MetaLeadsReconciliationService } from './meta-leads-reconciliation.service'
import { makeGraphApiLeadResponse } from './__fixtures__/meta-lead-factories'

const MAPPING_A = { formId: 'form_456', pageId: 'page_123', campaignId: 'camp-hdm-1', companyId: 'co-1' }
const MAPPING_B = { formId: 'form_999', pageId: 'page_888', campaignId: 'camp-hdm-2', companyId: 'co-2' }

function createMockPrisma() {
  return {
    metaLeadFormMapping: { findMany: jest.fn().mockResolvedValue([]) },
    $queryRaw: jest.fn().mockResolvedValue([]),
  }
}

function createMockRedis() {
  return { tryAcquireLock: jest.fn().mockResolvedValue(true) }
}

function createMockLeadsService() {
  return { createLead: jest.fn().mockResolvedValue({ id: 1 }) }
}

function createMockConfigService() {
  return { getMetaAccessToken: jest.fn().mockResolvedValue('user-token') }
}

function createMockMapperService() {
  return {
    mapMetaLeadToDto: jest.fn().mockImplementation((leadData: any) => ({
      name: 'Mapped',
      email: 'mapped@test.com',
      externalUserId: leadData.id,
      source: 'Meta Lead Ads',
    })),
  }
}

function createMockFallbackService() {
  return { saveRawEvent: jest.fn().mockResolvedValue(undefined) }
}

// fetch mock: page token lookup responde {access_token}, /leads responde a lista
function mockGraphApi(fetchSpy: jest.SpyInstance, leadsByForm: Record<string, any>) {
  fetchSpy.mockImplementation(async (url: any) => {
    const u = String(url)
    if (u.includes('fields=access_token')) {
      return { ok: true, json: async () => ({ access_token: 'page-token' }) } as any
    }
    const formId = Object.keys(leadsByForm).find(f => u.includes(`/${f}/leads`))
    if (formId) {
      const body = leadsByForm[formId]
      return { ok: true, json: async () => (typeof body === 'function' ? body(u) : body) } as any
    }
    return { ok: true, json: async () => ({ data: [] }) } as any
  })
}

describe('MetaLeadsReconciliationService', () => {
  let service: MetaLeadsReconciliationService
  let prisma: ReturnType<typeof createMockPrisma>
  let redis: ReturnType<typeof createMockRedis>
  let leadsService: ReturnType<typeof createMockLeadsService>
  let configService: ReturnType<typeof createMockConfigService>
  let mapperService: ReturnType<typeof createMockMapperService>
  let fallbackService: ReturnType<typeof createMockFallbackService>
  let fetchSpy: jest.SpyInstance

  beforeEach(() => {
    prisma = createMockPrisma()
    redis = createMockRedis()
    leadsService = createMockLeadsService()
    configService = createMockConfigService()
    mapperService = createMockMapperService()
    fallbackService = createMockFallbackService()

    service = new MetaLeadsReconciliationService(
      prisma as any,
      redis as any,
      leadsService as any,
      configService as any,
      mapperService as any,
      fallbackService as any,
    )

    fetchSpy = jest.spyOn(global, 'fetch')
    mockGraphApi(fetchSpy, {})
  })

  afterEach(() => {
    fetchSpy.mockRestore()
    jest.clearAllMocks()
  })

  describe('handleCron (lock PM2 cluster)', () => {
    it('should NOT run reconciliation when Redis lock is not acquired', async () => {
      redis.tryAcquireLock.mockResolvedValue(false)
      const spy = jest.spyOn(service, 'reconcileAll')

      await service.handleCron()

      expect(spy).not.toHaveBeenCalled()
    })

    it('should run reconciliation when lock is acquired', async () => {
      const spy = jest.spyOn(service, 'reconcileAll').mockResolvedValue({ mappings: 0, metaLeads: 0, created: 0, errors: 0 } as any)

      await service.handleCron()

      expect(redis.tryAcquireLock).toHaveBeenCalledWith('meta-leads:reconciliation:lock', 300)
      expect(spy).toHaveBeenCalled()
    })

    it('should not throw when reconcileAll rejects (non-fatal cron)', async () => {
      jest.spyOn(service, 'reconcileAll').mockRejectedValue(new Error('boom'))
      await expect(service.handleCron()).resolves.toBeUndefined()
    })
  })

  describe('reconcileAll', () => {
    it('should return zeroed summary when there are no active mappings', async () => {
      const summary = await service.reconcileAll()
      expect(summary).toEqual({ mappings: 0, metaLeads: 0, created: 0, errors: 0 })
      expect(fetchSpy).not.toHaveBeenCalled()
    })

    it('should skip companies without access token', async () => {
      prisma.metaLeadFormMapping.findMany.mockResolvedValue([MAPPING_A])
      configService.getMetaAccessToken.mockResolvedValue(null)

      const summary = await service.reconcileAll()

      expect(summary.created).toBe(0)
      expect(fetchSpy).not.toHaveBeenCalled()
    })

    it('should CREATE missing lead in the MAPPED campaign via real creation flow', async () => {
      prisma.metaLeadFormMapping.findMany.mockResolvedValue([MAPPING_A])
      const missingLead = makeGraphApiLeadResponse({ id: 'lg_missing_1' })
      mockGraphApi(fetchSpy, { form_456: { data: [missingLead] } })
      prisma.$queryRaw.mockResolvedValue([]) // nenhum existente

      const summary = await service.reconcileAll()

      expect(summary).toMatchObject({ mappings: 1, metaLeads: 1, created: 1, errors: 0 })
      expect(leadsService.createLead).toHaveBeenCalledWith(
        'camp-hdm-1',
        expect.objectContaining({ externalUserId: 'lg_missing_1' }),
        { skipApiKeyValidation: true },
      )
      expect(fallbackService.saveRawEvent).toHaveBeenCalledWith(
        'co-1',
        expect.objectContaining({ leadgen_id: 'lg_missing_1', form_id: 'form_456' }),
        'RECONCILED_CREATED',
      )
    })

    it('should SKIP leads that already exist by externalUserId (including soft-deleted)', async () => {
      prisma.metaLeadFormMapping.findMany.mockResolvedValue([MAPPING_A])
      const existingLead = makeGraphApiLeadResponse({ id: 'lg_existing' })
      const missingLead = makeGraphApiLeadResponse({ id: 'lg_new' })
      mockGraphApi(fetchSpy, { form_456: { data: [existingLead, missingLead] } })
      prisma.$queryRaw.mockResolvedValue([{ externalUserId: 'lg_existing' }])

      const summary = await service.reconcileAll()

      expect(summary.created).toBe(1)
      expect(leadsService.createLead).toHaveBeenCalledTimes(1)
      expect(leadsService.createLead).toHaveBeenCalledWith(
        'camp-hdm-1',
        expect.objectContaining({ externalUserId: 'lg_new' }),
        { skipApiKeyValidation: true },
      )
    })

    it('should continue other forms when one form fails on Graph API (non-fatal)', async () => {
      prisma.metaLeadFormMapping.findMany.mockResolvedValue([MAPPING_A, { ...MAPPING_B, companyId: 'co-1' }])
      mockGraphApi(fetchSpy, {
        form_456: { error: { message: 'rate limit' } },
        form_999: { data: [makeGraphApiLeadResponse({ id: 'lg_b1' })] },
      })
      prisma.$queryRaw.mockResolvedValue([])

      const summary = await service.reconcileAll()

      expect(summary.errors).toBe(1)
      expect(summary.created).toBe(1)
      expect(leadsService.createLead).toHaveBeenCalledWith(
        'camp-hdm-2',
        expect.objectContaining({ externalUserId: 'lg_b1' }),
        { skipApiKeyValidation: true },
      )
    })

    it('should count per-lead creation failures as errors and keep going', async () => {
      prisma.metaLeadFormMapping.findMany.mockResolvedValue([MAPPING_A])
      mockGraphApi(fetchSpy, {
        form_456: { data: [makeGraphApiLeadResponse({ id: 'lg_fail' }), makeGraphApiLeadResponse({ id: 'lg_ok' })] },
      })
      prisma.$queryRaw.mockResolvedValue([])
      leadsService.createLead
        .mockRejectedValueOnce(new Error('db down'))
        .mockResolvedValueOnce({ id: 2 })

      const summary = await service.reconcileAll()

      expect(summary.errors).toBe(1)
      expect(summary.created).toBe(1)
    })

    it('should fetch the company token only ONCE per company (multi-mapping)', async () => {
      prisma.metaLeadFormMapping.findMany.mockResolvedValue([
        MAPPING_A,
        { ...MAPPING_A, formId: 'form_2nd' },
      ])
      mockGraphApi(fetchSpy, { form_456: { data: [] }, form_2nd: { data: [] } })

      await service.reconcileAll()

      expect(configService.getMetaAccessToken).toHaveBeenCalledTimes(1)
      expect(configService.getMetaAccessToken).toHaveBeenCalledWith('co-1')
    })

    it('should follow pagination (paging.next) when listing form leads', async () => {
      prisma.metaLeadFormMapping.findMany.mockResolvedValue([MAPPING_A])
      const page2Url = 'https://graph.facebook.com/v25.0/form_456/leads?after=cursor'
      let call = 0
      mockGraphApi(fetchSpy, {
        form_456: () => {
          call++
          return call === 1
            ? { data: [makeGraphApiLeadResponse({ id: 'lg_p1' })], paging: { next: page2Url } }
            : { data: [makeGraphApiLeadResponse({ id: 'lg_p2' })] }
        },
      })
      prisma.$queryRaw.mockResolvedValue([])

      const summary = await service.reconcileAll()

      expect(summary.metaLeads).toBe(2)
      expect(summary.created).toBe(2)
    })

    it('should fall back to the user token when page token is unavailable', async () => {
      prisma.metaLeadFormMapping.findMany.mockResolvedValue([MAPPING_A])
      fetchSpy.mockImplementation(async (url: any, init: any) => {
        const u = String(url)
        if (u.includes('fields=access_token')) {
          return { ok: true, json: async () => ({ error: { message: 'no perm' } }) } as any
        }
        if (u.includes('/form_456/leads')) {
          expect(init?.headers?.Authorization).toBe('Bearer user-token')
          return { ok: true, json: async () => ({ data: [] }) } as any
        }
        return { ok: true, json: async () => ({ data: [] }) } as any
      })

      const summary = await service.reconcileAll()
      expect(summary.errors).toBe(0)
    })
  })
})
