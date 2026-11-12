import { WebhookMetaLeadsService } from './webhook-meta-leads.service'
import { MetaLeadWebhookPayload } from './types/meta-lead.types'
import {
  makeWebhookPayload,
  makeChangeValue,
  makeMultiEntryPayload,
  makeGraphApiLeadResponse,
} from './__fixtures__/meta-lead-factories'

function createMockPrisma() {
  return {
    companies: { findFirst: jest.fn() },
    campaigns: { findFirst: jest.fn() },
  }
}

function createMockLeadsService() {
  return {
    createLead: jest.fn().mockResolvedValue({ id: 1 }),
  }
}

function createMockMetaLeadFormsService() {
  return {
    listCampaignVerifyTokensByCompanyId: jest.fn().mockResolvedValue([]),
    findCampaignByFormId: jest.fn().mockResolvedValue(null),
  }
}

function createMockConfigService() {
  return {
    getVerifyTokenForSubdomain: jest.fn(),
    getWebhookConfig: jest.fn(),
    getMetaAccessToken: jest.fn(),
    validateSignature: jest.fn(),
  }
}

function createMockMapperService() {
  return {
    mapMetaLeadToDto: jest.fn().mockReturnValue({
      name: 'Test',
      email: 'test@test.com',
      phone: '+5511999',
      companyId: 'comp-1',
      source: 'Meta Lead Ads',
      canal: 'facebook',
      utms: '',
      city: '',
      state: '',
    }),
  }
}

function createMockRoutingService() {
  return {
    findCampaignForLead: jest.fn(),
  }
}

function createMockFallbackService() {
  return {
    saveRawEvent: jest.fn().mockResolvedValue(undefined),
    createLeadWithoutCampaign: jest.fn().mockResolvedValue({ id: 1 }),
  }
}

describe('WebhookMetaLeadsService', () => {
  let service: WebhookMetaLeadsService
  let prisma: ReturnType<typeof createMockPrisma>
  let leadsService: ReturnType<typeof createMockLeadsService>
  let formsService: ReturnType<typeof createMockMetaLeadFormsService>
  let configService: ReturnType<typeof createMockConfigService>
  let mapperService: ReturnType<typeof createMockMapperService>
  let routingService: ReturnType<typeof createMockRoutingService>
  let fallbackService: ReturnType<typeof createMockFallbackService>
  let fetchSpy: jest.SpyInstance

  beforeEach(() => {
    prisma = createMockPrisma()
    leadsService = createMockLeadsService()
    formsService = createMockMetaLeadFormsService()
    configService = createMockConfigService()
    mapperService = createMockMapperService()
    routingService = createMockRoutingService()
    fallbackService = createMockFallbackService()

    service = new WebhookMetaLeadsService(
      prisma as any,
      leadsService as any,
      formsService as any,
      configService as any,
      mapperService as any,
      routingService as any,
      fallbackService as any,
      // CompanyStatusService: por padrao a empresa esta ativa, para os testes
      // existentes seguirem exercitando o caminho feliz.
      { isActive: jest.fn().mockResolvedValue(true) } as any,
    )

    fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => makeGraphApiLeadResponse(),
      text: async () => '',
    } as any)

    jest.clearAllMocks()
  })

  afterEach(() => {
    fetchSpy.mockRestore()
  })

  // Helper to wait for async fire-and-forget promises
  const flushAsync = () => new Promise(r => setTimeout(r, 50))

  // ===== verifyWebhookByCampaign =====

  describe('verifyWebhookByCampaign', () => {
    it('should return null when mode is not subscribe', async () => {
      const result = await service.verifyWebhookByCampaign('token', 'unsubscribe', 'vt', 'ch')
      expect(result).toBeNull()
    })

    it('should return null when campaign not found by hdmMetaLeadToken', async () => {
      prisma.campaigns.findFirst.mockResolvedValue(null)

      const result = await service.verifyWebhookByCampaign('nonexistent', 'subscribe', 'vt', 'ch')
      expect(result).toBeNull()
    })

    it('should return challenge when token matches campaign.metaLeadsVerifyToken', async () => {
      prisma.campaigns.findFirst.mockResolvedValue({
        campaignId: 'camp-1',
        companyId: 'comp-1',
        metaLeadsVerifyToken: 'my-verify-token',
      })

      const result = await service.verifyWebhookByCampaign('token', 'subscribe', 'my-verify-token', 'challenge123')
      expect(result).toBe('challenge123')
    })

    it('should return challenge when token matches one from listCampaignVerifyTokensByCompanyId', async () => {
      prisma.campaigns.findFirst.mockResolvedValue({
        campaignId: 'camp-1',
        companyId: 'comp-1',
        metaLeadsVerifyToken: null,
      })
      formsService.listCampaignVerifyTokensByCompanyId.mockResolvedValue(['other-token', 'matching-token'])

      const result = await service.verifyWebhookByCampaign('token', 'subscribe', 'matching-token', 'ch')
      expect(result).toBe('ch')
    })

    it('should return challenge when token matches env var META_LEADS_WEBHOOK_VERIFY_TOKEN', async () => {
      prisma.campaigns.findFirst.mockResolvedValue({
        campaignId: 'camp-1',
        companyId: 'comp-1',
        metaLeadsVerifyToken: null,
      })
      formsService.listCampaignVerifyTokensByCompanyId.mockResolvedValue([])

      const originalEnv = process.env.META_LEADS_WEBHOOK_VERIFY_TOKEN
      process.env.META_LEADS_WEBHOOK_VERIFY_TOKEN = 'env-token'

      try {
        const result = await service.verifyWebhookByCampaign('token', 'subscribe', 'env-token', 'challenge')
        expect(result).toBe('challenge')
      } finally {
        if (originalEnv === undefined) delete process.env.META_LEADS_WEBHOOK_VERIFY_TOKEN
        else process.env.META_LEADS_WEBHOOK_VERIFY_TOKEN = originalEnv
      }
    })

    it('should return null when token matches none of the valid tokens', async () => {
      prisma.campaigns.findFirst.mockResolvedValue({
        campaignId: 'camp-1',
        companyId: 'comp-1',
        metaLeadsVerifyToken: 'tok-a',
      })
      formsService.listCampaignVerifyTokensByCompanyId.mockResolvedValue(['tok-b'])

      const result = await service.verifyWebhookByCampaign('token', 'subscribe', 'WRONG', 'ch')
      expect(result).toBeNull()
    })

    it('should filter deleted campaigns (deleted_at: null)', async () => {
      prisma.campaigns.findFirst.mockResolvedValue(null)

      await service.verifyWebhookByCampaign('token', 'subscribe', 'vt', 'ch')

      expect(prisma.campaigns.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ deleted_at: null }),
        }),
      )
    })
  })

  // ===== ingestWebhookByCampaign =====

  describe('ingestWebhookByCampaign', () => {
    it('should return { received: true } when payload.object is not page', async () => {
      const payload: MetaLeadWebhookPayload = { object: 'user', entry: [] }
      const result = await service.ingestWebhookByCampaign('token', payload, Buffer.from('{}'))
      expect(result).toEqual({ received: true })
    })

    it('should return { received: true } when entry is empty', async () => {
      const payload: MetaLeadWebhookPayload = { object: 'page', entry: [] }
      const result = await service.ingestWebhookByCampaign('token', payload, Buffer.from('{}'))
      expect(result).toEqual({ received: true })
    })

    it('should return { received: true } when entry is undefined/null', async () => {
      const payload = { object: 'page', entry: undefined } as any
      const result = await service.ingestWebhookByCampaign('token', payload, Buffer.from('{}'))
      expect(result).toEqual({ received: true })
    })

    it('should return { received: true } when campaign not found', async () => {
      prisma.campaigns.findFirst.mockResolvedValue(null)
      const payload = makeWebhookPayload()

      const result = await service.ingestWebhookByCampaign('nonexistent', payload, Buffer.from('{}'))
      expect(result).toEqual({ received: true })
    })

    it('should validate HMAC signature when appSecret is configured and signature provided', async () => {
      prisma.campaigns.findFirst.mockResolvedValue({ campaignId: 'c1', companyId: 'co1' })
      configService.getWebhookConfig.mockResolvedValue({ accessToken: 'tok', appSecret: 'secret', verifyToken: null })
      configService.validateSignature.mockReturnValue(true)
      configService.getMetaAccessToken.mockResolvedValue('tok')

      const payload = makeWebhookPayload()
      await service.ingestWebhookByCampaign('token', payload, Buffer.from('rawbody'), 'sha256=abc')
      await flushAsync()

      expect(configService.validateSignature).toHaveBeenCalledWith(Buffer.from('rawbody'), 'sha256=abc', 'secret')
    })

    it('should skip signature validation when no appSecret configured', async () => {
      prisma.campaigns.findFirst.mockResolvedValue({ campaignId: 'c1', companyId: 'co1' })
      configService.getWebhookConfig.mockResolvedValue({ accessToken: 'tok', appSecret: null, verifyToken: null })
      configService.getMetaAccessToken.mockResolvedValue('tok')

      const payload = makeWebhookPayload()
      await service.ingestWebhookByCampaign('token', payload, Buffer.from('rawbody'), 'sha256=abc')

      expect(configService.validateSignature).not.toHaveBeenCalled()
    })

    it('FAIL-CLOSED: should REJECT (not process) when appSecret configured and signature256 is missing', async () => {
      prisma.campaigns.findFirst.mockResolvedValue({ campaignId: 'c1', companyId: 'co1' })
      configService.getWebhookConfig.mockResolvedValue({ accessToken: 'tok', appSecret: 'secret', verifyToken: null })
      configService.getMetaAccessToken.mockResolvedValue('tok')

      const payload = makeWebhookPayload()
      const result = await service.ingestWebhookByCampaign('token', payload, Buffer.from('rawbody'), undefined)
      await flushAsync()

      expect(result).toEqual({ received: true })
      expect(configService.validateSignature).not.toHaveBeenCalled()
      // nenhum processamento assíncrono deve ter iniciado
      expect(configService.getMetaAccessToken).not.toHaveBeenCalled()
      expect(leadsService.createLead).not.toHaveBeenCalled()
    })

    it('FAIL-CLOSED: should return { received: true } and NOT process on signature mismatch', async () => {
      prisma.campaigns.findFirst.mockResolvedValue({ campaignId: 'c1', companyId: 'co1' })
      configService.getWebhookConfig.mockResolvedValue({ accessToken: 'tok', appSecret: 'secret', verifyToken: null })
      configService.validateSignature.mockReturnValue(false)
      configService.getMetaAccessToken.mockResolvedValue('tok')

      const payload = makeWebhookPayload()
      const result = await service.ingestWebhookByCampaign('token', payload, Buffer.from('rawbody'), 'sha256=wrong')
      await flushAsync()

      expect(result).toEqual({ received: true })
      expect(configService.getMetaAccessToken).not.toHaveBeenCalled()
      expect(leadsService.createLead).not.toHaveBeenCalled()
    })

    it('should still process normally when appSecret is NOT configured and signature is missing (opt-in)', async () => {
      prisma.campaigns.findFirst.mockResolvedValue({ campaignId: 'c1', companyId: 'co1' })
      configService.getWebhookConfig.mockResolvedValue({ accessToken: 'tok', appSecret: null, verifyToken: null })
      configService.getMetaAccessToken.mockResolvedValue('tok')
      fetchSpy.mockResolvedValue({ ok: true, json: async () => makeGraphApiLeadResponse() } as any)

      const payload = makeWebhookPayload()
      const result = await service.ingestWebhookByCampaign('token', payload, Buffer.from('rawbody'), undefined)
      await flushAsync()

      expect(result).toEqual({ received: true })
      expect(configService.validateSignature).not.toHaveBeenCalled()
      expect(leadsService.createLead).toHaveBeenCalled()
    })

    it('should ignore changes where field is not leadgen', async () => {
      prisma.campaigns.findFirst.mockResolvedValue({ campaignId: 'c1', companyId: 'co1' })
      configService.getWebhookConfig.mockResolvedValue(null)
      configService.getMetaAccessToken.mockResolvedValue('tok')

      const payload: MetaLeadWebhookPayload = {
        object: 'page',
        entry: [{
          id: 'page_1',
          time: 123,
          changes: [
            { field: 'feed', value: makeChangeValue() },
            { field: 'leadgen', value: makeChangeValue({ leadgen_id: 'lg_valid' }) },
          ],
        }],
      }

      await service.ingestWebhookByCampaign('token', payload, Buffer.from('{}'))
      await flushAsync()

      // Only the leadgen change triggers Graph API fetch
      expect(fetchSpy).toHaveBeenCalledTimes(1)
    })

    it('should ignore changes where leadgen_id is missing', async () => {
      prisma.campaigns.findFirst.mockResolvedValue({ campaignId: 'c1', companyId: 'co1' })
      configService.getWebhookConfig.mockResolvedValue(null)
      configService.getMetaAccessToken.mockResolvedValue('tok')

      const payload: MetaLeadWebhookPayload = {
        object: 'page',
        entry: [{
          id: 'page_1',
          time: 123,
          changes: [
            { field: 'leadgen', value: { ...makeChangeValue(), leadgen_id: '' } },
          ],
        }],
      }

      await service.ingestWebhookByCampaign('token', payload, Buffer.from('{}'))
      await flushAsync()

      expect(fetchSpy).not.toHaveBeenCalled()
    })

    it('should process multiple entries with multiple changes', async () => {
      prisma.campaigns.findFirst.mockResolvedValue({ campaignId: 'c1', companyId: 'co1' })
      configService.getWebhookConfig.mockResolvedValue(null)
      configService.getMetaAccessToken.mockResolvedValue('tok')

      const payload = makeMultiEntryPayload(2, 3)

      await service.ingestWebhookByCampaign('token', payload, Buffer.from('{}'))
      await flushAsync()

      // 2 entries * 3 changes = 6 fetch calls
      expect(fetchSpy).toHaveBeenCalledTimes(6)
    })

    it('should return { received: true } immediately (before async processing)', async () => {
      prisma.campaigns.findFirst.mockResolvedValue({ campaignId: 'c1', companyId: 'co1' })
      configService.getWebhookConfig.mockResolvedValue(null)
      configService.getMetaAccessToken.mockResolvedValue(null) // Will fail async

      const result = await service.ingestWebhookByCampaign('token', makeWebhookPayload(), Buffer.from('{}'))

      // Returns immediately without waiting for async
      expect(result).toEqual({ received: true })
    })
  })

  // ===== processLeadAsyncForCampaign (tested via behavior) =====

  describe('processLeadAsyncForCampaign (via ingestWebhookByCampaign)', () => {
    beforeEach(() => {
      prisma.campaigns.findFirst.mockResolvedValue({ campaignId: 'camp-1', companyId: 'co-1' })
      configService.getWebhookConfig.mockResolvedValue(null)
    })

    it('should save raw event with NO_ACCESS_TOKEN when no token available', async () => {
      configService.getMetaAccessToken.mockResolvedValue(null)

      await service.ingestWebhookByCampaign('token', makeWebhookPayload(), Buffer.from('{}'))
      await flushAsync()

      expect(fallbackService.saveRawEvent).toHaveBeenCalledWith(
        'co-1',
        expect.objectContaining({ leadgen_id: 'lg_test_001' }),
        'NO_ACCESS_TOKEN',
      )
    })

    it('MAPPING WINS: should create in the MAPPED campaign when form is linked to ANOTHER campaign', async () => {
      configService.getMetaAccessToken.mockResolvedValue('tok')
      formsService.findCampaignByFormId.mockResolvedValue('camp-mapped-2')

      await service.ingestWebhookByCampaign('token', makeWebhookPayload(), Buffer.from('{}'))
      await flushAsync()

      expect(formsService.findCampaignByFormId).toHaveBeenCalledWith(expect.any(String), 'co-1')
      expect(leadsService.createLead).toHaveBeenCalledWith(
        'camp-mapped-2',
        expect.any(Object),
        { skipApiKeyValidation: true },
      )
    })

    it('should keep the URL-token campaign when form is mapped to the SAME campaign', async () => {
      configService.getMetaAccessToken.mockResolvedValue('tok')
      formsService.findCampaignByFormId.mockResolvedValue('camp-1')

      await service.ingestWebhookByCampaign('token', makeWebhookPayload(), Buffer.from('{}'))
      await flushAsync()

      expect(leadsService.createLead).toHaveBeenCalledWith('camp-1', expect.any(Object), { skipApiKeyValidation: true })
    })

    it('should keep the URL-token campaign when form has NO mapping', async () => {
      configService.getMetaAccessToken.mockResolvedValue('tok')
      formsService.findCampaignByFormId.mockResolvedValue(null)

      await service.ingestWebhookByCampaign('token', makeWebhookPayload(), Buffer.from('{}'))
      await flushAsync()

      expect(leadsService.createLead).toHaveBeenCalledWith('camp-1', expect.any(Object), { skipApiKeyValidation: true })
    })

    it('should call Graph API with correct URL and Bearer token', async () => {
      configService.getMetaAccessToken.mockResolvedValue('my-access-token')

      await service.ingestWebhookByCampaign('token', makeWebhookPayload(), Buffer.from('{}'))
      await flushAsync()

      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining('lg_test_001'),
        expect.objectContaining({
          headers: { Authorization: 'Bearer my-access-token' },
        }),
      )
    })

    it('should save raw event with FETCH_FAILED on Graph API error', async () => {
      configService.getMetaAccessToken.mockResolvedValue('token')
      fetchSpy.mockResolvedValue({ ok: false, text: async () => 'Error 400', status: 400 } as any)

      await service.ingestWebhookByCampaign('token', makeWebhookPayload(), Buffer.from('{}'))
      await flushAsync()

      expect(fallbackService.saveRawEvent).toHaveBeenCalledWith(
        'co-1',
        expect.any(Object),
        'FETCH_FAILED',
      )
    })

    it('should map lead data and create lead via leadsService', async () => {
      configService.getMetaAccessToken.mockResolvedValue('token')

      await service.ingestWebhookByCampaign('token', makeWebhookPayload(), Buffer.from('{}'))
      await flushAsync()

      expect(mapperService.mapMetaLeadToDto).toHaveBeenCalled()
      expect(leadsService.createLead).toHaveBeenCalledWith(
        'camp-1',
        expect.any(Object),
        { skipApiKeyValidation: true },
      )
    })

    it('should save raw event with CREATE_LEAD_ERROR on createLead failure', async () => {
      configService.getMetaAccessToken.mockResolvedValue('token')
      leadsService.createLead.mockRejectedValue(new Error('DB constraint violation'))

      await service.ingestWebhookByCampaign('token', makeWebhookPayload(), Buffer.from('{}'))
      await flushAsync()

      expect(fallbackService.saveRawEvent).toHaveBeenCalledWith(
        'co-1',
        expect.any(Object),
        expect.stringContaining('CREATE_LEAD_ERROR'),
        expect.any(Object),
      )
    })

    it('should pass meta fields (pageId, formId, adId, adsetId) to mapper', async () => {
      configService.getMetaAccessToken.mockResolvedValue('token')

      const payload = makeWebhookPayload({
        entry: [{
          id: 'page_x',
          time: 123,
          changes: [{
            field: 'leadgen',
            value: makeChangeValue({ page_id: 'p1', form_id: 'f1', ad_id: 'a1', adgroup_id: 'ag1' }),
          }],
        }],
      })

      await service.ingestWebhookByCampaign('token', payload, Buffer.from('{}'))
      await flushAsync()

      expect(mapperService.mapMetaLeadToDto).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({
          companyId: 'co-1',
          pageId: 'p1',
          formId: 'f1',
        }),
      )
    })
  })

  // ===== verifyWebhook (subdomain-based) =====

  describe('verifyWebhook (subdomain)', () => {
    it('should return null when mode is not subscribe', async () => {
      const result = await service.verifyWebhook('sub', 'unsubscribe', 'vt', 'ch')
      expect(result).toBeNull()
    })

    it('should return null when company not found by subdomain', async () => {
      prisma.companies.findFirst.mockResolvedValue(null)

      const result = await service.verifyWebhook('unknown', 'subscribe', 'vt', 'ch')
      expect(result).toBeNull()
    })

    it('should collect tokens from campaign tokens, DB verify token, and env', async () => {
      prisma.companies.findFirst.mockResolvedValue({ id: 'comp-1', status: 'ACTIVE' })
      formsService.listCampaignVerifyTokensByCompanyId.mockResolvedValue(['camp-tok'])
      configService.getVerifyTokenForSubdomain.mockResolvedValue('db-tok')

      const result = await service.verifyWebhook('sub', 'subscribe', 'camp-tok', 'challenge')
      expect(result).toBe('challenge')
    })

    it('should return null when no valid tokens configured', async () => {
      prisma.companies.findFirst.mockResolvedValue({ id: 'comp-1', status: 'ACTIVE' })
      formsService.listCampaignVerifyTokensByCompanyId.mockResolvedValue([])
      configService.getVerifyTokenForSubdomain.mockResolvedValue(null)

      const originalMeta = process.env.META_LEADS_WEBHOOK_VERIFY_TOKEN
      const originalWa = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN
      delete process.env.META_LEADS_WEBHOOK_VERIFY_TOKEN
      delete process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN

      try {
        const result = await service.verifyWebhook('sub', 'subscribe', 'any', 'ch')
        expect(result).toBeNull()
      } finally {
        if (originalMeta) process.env.META_LEADS_WEBHOOK_VERIFY_TOKEN = originalMeta
        if (originalWa) process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN = originalWa
      }
    })
  })

  // ===== ingestWebhook (subdomain-based) =====

  describe('ingestWebhook (subdomain)', () => {
    it('should return { received: true } when object is not page', async () => {
      const result = await service.ingestWebhook('sub', { object: 'user', entry: [] }, Buffer.from('{}'))
      expect(result).toEqual({ received: true })
    })

    it('should return { received: true } when company not found', async () => {
      prisma.companies.findFirst.mockResolvedValue(null)
      const result = await service.ingestWebhook('unknown', makeWebhookPayload(), Buffer.from('{}'))
      expect(result).toEqual({ received: true })
    })

    it('should use routingService to discover campaignId for subdomain flow', async () => {
      prisma.companies.findFirst.mockResolvedValue({ id: 'comp-1', status: 'ACTIVE' })
      configService.getWebhookConfig.mockResolvedValue(null)
      configService.getMetaAccessToken.mockResolvedValue('tok')
      routingService.findCampaignForLead.mockResolvedValue('discovered-campaign')

      await service.ingestWebhook('sub', makeWebhookPayload(), Buffer.from('{}'))
      await flushAsync()

      expect(routingService.findCampaignForLead).toHaveBeenCalled()
      expect(leadsService.createLead).toHaveBeenCalledWith(
        'discovered-campaign',
        expect.any(Object),
        { skipApiKeyValidation: true },
      )
    })

    it('should use fallbackService when no campaign found via routing', async () => {
      prisma.companies.findFirst.mockResolvedValue({ id: 'comp-1', status: 'ACTIVE' })
      configService.getWebhookConfig.mockResolvedValue(null)
      configService.getMetaAccessToken.mockResolvedValue('tok')
      routingService.findCampaignForLead.mockResolvedValue(null)

      await service.ingestWebhook('sub', makeWebhookPayload(), Buffer.from('{}'))
      await flushAsync()

      expect(fallbackService.createLeadWithoutCampaign).toHaveBeenCalledWith(
        'comp-1',
        expect.any(Object),
      )
    })

    it('FAIL-CLOSED: should REJECT when appSecret configured and signature256 is missing (subdomain)', async () => {
      prisma.companies.findFirst.mockResolvedValue({ id: 'comp-1', status: 'ACTIVE' })
      configService.getWebhookConfig.mockResolvedValue({ accessToken: 'tok', appSecret: 'secret', verifyToken: null })
      configService.getMetaAccessToken.mockResolvedValue('tok')

      const result = await service.ingestWebhook('sub', makeWebhookPayload(), Buffer.from('rawbody'), undefined)
      await flushAsync()

      expect(result).toEqual({ received: true })
      expect(configService.validateSignature).not.toHaveBeenCalled()
      expect(configService.getMetaAccessToken).not.toHaveBeenCalled()
      expect(leadsService.createLead).not.toHaveBeenCalled()
      expect(fallbackService.createLeadWithoutCampaign).not.toHaveBeenCalled()
    })

    it('FAIL-CLOSED: should REJECT on signature mismatch (subdomain)', async () => {
      prisma.companies.findFirst.mockResolvedValue({ id: 'comp-1', status: 'ACTIVE' })
      configService.getWebhookConfig.mockResolvedValue({ accessToken: 'tok', appSecret: 'secret', verifyToken: null })
      configService.validateSignature.mockReturnValue(false)
      configService.getMetaAccessToken.mockResolvedValue('tok')

      const result = await service.ingestWebhook('sub', makeWebhookPayload(), Buffer.from('rawbody'), 'sha256=wrong')
      await flushAsync()

      expect(result).toEqual({ received: true })
      expect(configService.getMetaAccessToken).not.toHaveBeenCalled()
      expect(leadsService.createLead).not.toHaveBeenCalled()
    })

    it('should process when appSecret configured and signature is VALID (subdomain)', async () => {
      prisma.companies.findFirst.mockResolvedValue({ id: 'comp-1', status: 'ACTIVE' })
      configService.getWebhookConfig.mockResolvedValue({ accessToken: 'tok', appSecret: 'secret', verifyToken: null })
      configService.validateSignature.mockReturnValue(true)
      configService.getMetaAccessToken.mockResolvedValue('tok')
      routingService.findCampaignForLead.mockResolvedValue('c-ok')

      const result = await service.ingestWebhook('sub', makeWebhookPayload(), Buffer.from('rawbody'), 'sha256=valid')
      await flushAsync()

      expect(result).toEqual({ received: true })
      expect(configService.validateSignature).toHaveBeenCalledWith(Buffer.from('rawbody'), 'sha256=valid', 'secret')
      expect(leadsService.createLead).toHaveBeenCalledWith('c-ok', expect.any(Object), { skipApiKeyValidation: true })
    })
  })

  // ===== fetchLeadFromMeta (via behavior) =====

  describe('fetchLeadFromMeta (via Graph API call)', () => {
    beforeEach(() => {
      prisma.campaigns.findFirst.mockResolvedValue({ campaignId: 'c1', companyId: 'co1' })
      configService.getWebhookConfig.mockResolvedValue(null)
      configService.getMetaAccessToken.mockResolvedValue('access-token')
    })

    it('should construct correct URL with leadgen_id and fields', async () => {
      await service.ingestWebhookByCampaign('token', makeWebhookPayload(), Buffer.from('{}'))
      await flushAsync()

      const url = fetchSpy.mock.calls[0][0] as string
      expect(url).toContain('lg_test_001')
      expect(url).toContain('fields=')
      expect(url).toContain('field_data')
      expect(url).toContain('campaign_name')
    })

    it('should set Authorization Bearer header', async () => {
      await service.ingestWebhookByCampaign('token', makeWebhookPayload(), Buffer.from('{}'))
      await flushAsync()

      const opts = fetchSpy.mock.calls[0][1]
      expect(opts.headers.Authorization).toBe('Bearer access-token')
    })

    it('should handle non-200 response as error', async () => {
      fetchSpy.mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => '{"error":{"message":"Invalid token"}}',
      } as any)

      await service.ingestWebhookByCampaign('token', makeWebhookPayload(), Buffer.from('{}'))
      await flushAsync()

      expect(fallbackService.saveRawEvent).toHaveBeenCalledWith(
        'co1',
        expect.any(Object),
        'FETCH_FAILED',
      )
    })
  })
})
