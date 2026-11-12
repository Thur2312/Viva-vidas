import { MetaLeadFormsService } from './meta-lead-forms.service'

function createMockPrisma() {
  return {
    metaLeadFormMapping: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 1, ...data })),
      update: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 1, formId: 'f1', ...data })),
    },
    campaigns: { findFirst: jest.fn() },
  }
}

function createMockMetaAdsService() {
  return {
    getMetaCredentials: jest.fn().mockResolvedValue({ accessToken: 'user-token' }),
  }
}

function mockFetchSequence(fetchSpy: jest.SpyInstance, responses: Record<string, any>) {
  fetchSpy.mockImplementation(async (url: any) => {
    const u = String(url)
    if (u.includes('fields=access_token')) {
      return { ok: true, json: async () => responses.pageToken } as any
    }
    if (u.includes('/subscribed_apps')) {
      return { ok: true, json: async () => responses.subscribe } as any
    }
    return { ok: true, json: async () => ({}) } as any
  })
}

describe('MetaLeadFormsService — subscribePageToLeadgen', () => {
  let service: MetaLeadFormsService
  let prisma: ReturnType<typeof createMockPrisma>
  let metaAdsService: ReturnType<typeof createMockMetaAdsService>
  let fetchSpy: jest.SpyInstance

  beforeEach(() => {
    prisma = createMockPrisma()
    metaAdsService = createMockMetaAdsService()
    service = new MetaLeadFormsService(prisma as any, metaAdsService as any)
    fetchSpy = jest.spyOn(global, 'fetch')
    mockFetchSequence(fetchSpy, { pageToken: { access_token: 'page-token' }, subscribe: { success: true } })
  })

  afterEach(() => {
    fetchSpy.mockRestore()
    jest.clearAllMocks()
  })

  it('should subscribe the page (POST subscribed_apps with leadgen) using the PAGE token', async () => {
    const ok = await service.subscribePageToLeadgen('co-1', 'page-1')

    expect(ok).toBe(true)
    const subscribeCall = fetchSpy.mock.calls.find(c => String(c[0]).includes('/subscribed_apps'))
    expect(String(subscribeCall[0])).toContain('subscribed_fields=leadgen')
    expect(String(subscribeCall[0])).toContain('access_token=page-token')
    expect(subscribeCall[1]).toMatchObject({ method: 'POST' })
  })

  it('should return false (non-fatal) when there is no access token for the company', async () => {
    metaAdsService.getMetaCredentials.mockResolvedValue({ accessToken: null })

    const ok = await service.subscribePageToLeadgen('co-1', 'page-1')

    expect(ok).toBe(false)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('should return false (non-fatal) when page token cannot be obtained', async () => {
    mockFetchSequence(fetchSpy, { pageToken: { error: { message: 'no perm' } }, subscribe: { success: true } })

    const ok = await service.subscribePageToLeadgen('co-1', 'page-1')

    expect(ok).toBe(false)
  })

  it('should return false (non-fatal) when Meta rejects the subscription', async () => {
    mockFetchSequence(fetchSpy, { pageToken: { access_token: 'pt' }, subscribe: { error: { message: 'denied' } } })

    const ok = await service.subscribePageToLeadgen('co-1', 'page-1')

    expect(ok).toBe(false)
  })

  it('should return false (non-fatal) when fetch throws', async () => {
    fetchSpy.mockRejectedValue(new Error('network down'))

    const ok = await service.subscribePageToLeadgen('co-1', 'page-1')

    expect(ok).toBe(false)
  })

  describe('createMapping integration', () => {
    it('should subscribe the page after creating a NEW mapping with pageId', async () => {
      const spy = jest.spyOn(service, 'subscribePageToLeadgen').mockResolvedValue(true)

      await service.createMapping({ formId: 'f1', pageId: 'page-1', campaignId: 'c1', companyId: 'co-1' })

      expect(prisma.metaLeadFormMapping.create).toHaveBeenCalled()
      expect(spy).toHaveBeenCalledWith('co-1', 'page-1')
    })

    it('should subscribe using the EXISTING pageId when reactivating a mapping', async () => {
      prisma.metaLeadFormMapping.findFirst.mockResolvedValue({
        id: 7, formId: 'f1', pageId: 'page-old', pageName: 'P', formName: 'F', verifyToken: null,
      })
      const spy = jest.spyOn(service, 'subscribePageToLeadgen').mockResolvedValue(true)

      await service.createMapping({ formId: 'f1', campaignId: 'c2', companyId: 'co-1' })

      expect(prisma.metaLeadFormMapping.update).toHaveBeenCalled()
      expect(spy).toHaveBeenCalledWith('co-1', 'page-old')
    })

    it('should NOT attempt subscription when mapping has no pageId (manual mode)', async () => {
      const spy = jest.spyOn(service, 'subscribePageToLeadgen').mockResolvedValue(true)

      await service.createMapping({ formId: 'f-manual', campaignId: 'c1', companyId: 'co-1' })

      expect(spy).not.toHaveBeenCalled()
    })

    it('should still return the mapping when subscription fails (non-fatal)', async () => {
      jest.spyOn(service, 'subscribePageToLeadgen').mockResolvedValue(false)

      const mapping = await service.createMapping({ formId: 'f1', pageId: 'p1', campaignId: 'c1', companyId: 'co-1' })

      expect(mapping).toMatchObject({ formId: 'f1', campaignId: 'c1' })
    })
  })

  describe('resubscribeMappedPages', () => {
    it('should subscribe each distinct mapped page of the company', async () => {
      prisma.metaLeadFormMapping.findMany.mockResolvedValue([{ pageId: 'p1' }, { pageId: 'p2' }])
      const spy = jest.spyOn(service, 'subscribePageToLeadgen').mockResolvedValue(true)

      await service.resubscribeMappedPages('co-1')

      expect(prisma.metaLeadFormMapping.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ companyId: 'co-1', deleted_at: null }) }),
      )
      expect(spy).toHaveBeenCalledTimes(2)
      expect(spy).toHaveBeenCalledWith('co-1', 'p1')
      expect(spy).toHaveBeenCalledWith('co-1', 'p2')
    })

    it('should do nothing when the company has no active mappings', async () => {
      const spy = jest.spyOn(service, 'subscribePageToLeadgen')

      await service.resubscribeMappedPages('co-1')

      expect(spy).not.toHaveBeenCalled()
    })
  })
})
