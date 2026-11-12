import { TrackingLeadService } from './tracking-lead.service'

/**
 * TrackingLeadService — auto-criação idempotente de Lead a partir de eventos de tracking.
 *
 * Cobre:
 *  1) findOrCreateLeadFromTracking: defesa em camadas contra race condition
 *     - Layer 1: Redis SET NX EX serializa workers concorrentes
 *     - Layer 2: try/catch P2002 absorve violação do unique composto
 *  2) createLeadFromTracking: P2002 absorvido → findFirst retorna o lead vencedor
 *  3) Validação: sem email nem phone → retorna null sem chamar nada
 */

const CAMPAIGN = {
  campaignId: 'camp-1',
  companyId: 'comp-1',
  columnSetId: 'cs-1',
  name: 'Campanha 1',
}

const createPrismaMock = () => ({
  leads: {
    findFirst: jest.fn().mockResolvedValue(null),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  customers: {
    findFirst: jest.fn().mockResolvedValue({ customerId: 'cust-1' }),
    create: jest.fn().mockResolvedValue({ customerId: 'cust-1' }),
  },
  dndColumn: {
    findFirst: jest.fn().mockResolvedValue({ id: 'col-1' }),
  },
  genericDnd: {
    findFirst: jest.fn().mockResolvedValue({ id: 'gd-1' }),
    create: jest.fn(),
  },
  $transaction: jest.fn().mockImplementation(async (fn) => {
    if (typeof fn === 'function') {
      return fn({
        genericDndCard: { create: jest.fn().mockResolvedValue({ id: 'card-1' }) },
        genericDndColumnSet: {
          findMany: jest.fn().mockResolvedValue([
            { id: 'cs-1', columns: [{ id: 'col-1', position: 0 }] },
          ]),
          create: jest.fn(),
        },
        genericDndCardPosition: {
          count: jest.fn().mockResolvedValue(0),
          create: jest.fn().mockResolvedValue({ id: 'pos-1' }),
        },
      })
    }
    return undefined
  }),
})

const createRedisMock = () => ({
  tryAcquireLock: jest.fn().mockResolvedValue(true),
})

describe('TrackingLeadService', () => {
  let service: TrackingLeadService
  let prisma: ReturnType<typeof createPrismaMock>
  let redis: ReturnType<typeof createRedisMock>

  beforeEach(() => {
    jest.clearAllMocks()
    prisma = createPrismaMock()
    redis = createRedisMock()
    // `scheduleOnArrival` é fire-and-forget e não faz parte do que este spec cobre.
    service = new TrackingLeadService(prisma as any, redis as any, {
      scheduleOnArrival: jest.fn(),
    } as any)
  })

  // ============================================================
  // findOrCreateLeadFromTracking — Layer 1 (Redis lock) + Layer 2 (P2002 catch)
  // ============================================================

  describe('findOrCreateLeadFromTracking', () => {
    it('retorna null quando email E phone vazios (sem identidade)', async () => {
      const result = await service.findOrCreateLeadFromTracking('', CAMPAIGN, '')

      expect(result).toBeNull()
      expect(redis.tryAcquireLock).not.toHaveBeenCalled()
      expect(prisma.leads.findFirst).not.toHaveBeenCalled()
      expect(prisma.leads.create).not.toHaveBeenCalled()
    })

    it('lock adquirido + lead já existe na mesma campanha: retorna sem criar', async () => {
      ;(prisma.leads.findFirst as jest.Mock).mockResolvedValueOnce({ id: 99 })

      const result = await service.findOrCreateLeadFromTracking('lead@example.com', CAMPAIGN)

      // Lock key inclui companyId + campaignId — leads do mesmo email em campanhas diferentes não competem
      expect(redis.tryAcquireLock).toHaveBeenCalledWith(
        'lead:autocreate:comp-1:camp-1:lead@example.com',
        10,
      )
      // Lookup é campaign-level com OR (email OU phone) — alinhado com @@unique compostos
      expect(prisma.leads.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            campaignId: CAMPAIGN.campaignId,
            companyId: CAMPAIGN.companyId,
            OR: [{ email: 'lead@example.com' }],
          },
        }),
      )
      expect(result).toEqual({ id: 99 })
      expect(prisma.leads.create).not.toHaveBeenCalled()
    })

    it('lookup OR: tracking com email novo + phone existente encontra lead pelo phone (variantes ±DDI ±9º)', async () => {
      // Lead existente cadastrado por phone em tracking anterior; agora chega tracking com email novo + mesmo phone
      const existingByPhone = { id: 50 }
      ;(prisma.leads.findFirst as jest.Mock).mockResolvedValueOnce(existingByPhone)

      const result = await service.findOrCreateLeadFromTracking('novo@example.com', CAMPAIGN, '11999998888')

      // phoneVariants gera as 4 formas: ±55 × ±9º móvel
      const phoneCall = (prisma.leads.findFirst as jest.Mock).mock.calls[0][0]
      expect(phoneCall.where.campaignId).toBe(CAMPAIGN.campaignId)
      expect(phoneCall.where.companyId).toBe(CAMPAIGN.companyId)
      expect(phoneCall.where.OR).toEqual([
        { email: 'novo@example.com' },
        { phone: { in: expect.arrayContaining(['11999998888', '5511999998888', '551199998888', '1199998888']) } },
      ])
      expect(result).toEqual(existingByPhone)
      expect(prisma.leads.create).not.toHaveBeenCalled()
    })

    it('lead já existe em outra campanha: CRIA novo lead na campanha atual', async () => {
      // findFirst com campaign-level scope NÃO encontra (lead da outra campanha não bate o filtro)
      ;(prisma.leads.findFirst as jest.Mock).mockResolvedValueOnce(null)
      const newLead = { id: 5, email: 'lead@example.com', campaignId: CAMPAIGN.campaignId }
      ;(prisma.leads.create as jest.Mock).mockResolvedValueOnce(newLead)

      const result = await service.findOrCreateLeadFromTracking('lead@example.com', CAMPAIGN)

      expect(prisma.leads.create).toHaveBeenCalledTimes(1)
      expect(result).toEqual(newLead)
    })

    it('lock adquirido + lead novo: chama createLeadFromTracking', async () => {
      ;(prisma.leads.findFirst as jest.Mock).mockResolvedValueOnce(null)
      const newLead = {
        id: 1,
        name: '',
        email: 'lead@example.com',
        phone: '',
        companyId: CAMPAIGN.companyId,
        campaignId: CAMPAIGN.campaignId,
      }
      ;(prisma.leads.create as jest.Mock).mockResolvedValueOnce(newLead)

      const result = await service.findOrCreateLeadFromTracking('lead@example.com', CAMPAIGN)

      expect(prisma.leads.create).toHaveBeenCalledTimes(1)
      expect(result).toEqual(newLead)
    })

    it('lock recusado + lead encontrado em re-busca: retorna sem chamar create', async () => {
      redis.tryAcquireLock.mockResolvedValueOnce(false)
      ;(prisma.leads.findFirst as jest.Mock).mockResolvedValueOnce({ id: 77 })

      const result = await service.findOrCreateLeadFromTracking('lead@example.com', CAMPAIGN)

      expect(result).toEqual({ id: 77 })
      expect(prisma.leads.create).not.toHaveBeenCalled()
    })

    it('lock recusado + 3 retries todos vazios + main lookup vazio: cria lead (layer 2 P2002 é a defesa final)', async () => {
      jest.useFakeTimers()
      redis.tryAcquireLock.mockResolvedValueOnce(false)
      ;(prisma.leads.findFirst as jest.Mock)
        .mockResolvedValueOnce(null) // retry #1
        .mockResolvedValueOnce(null) // retry #2
        .mockResolvedValueOnce(null) // retry #3
        .mockResolvedValueOnce(null) // main lookup pre-create
      ;(prisma.leads.create as jest.Mock).mockResolvedValueOnce({ id: 1 })

      const promise = service.findOrCreateLeadFromTracking('lead@example.com', CAMPAIGN)
      // sleep × 3 = 600ms total
      await jest.advanceTimersByTimeAsync(600)
      const result = await promise

      expect(prisma.leads.findFirst).toHaveBeenCalledTimes(4) // 3 retries + 1 main lookup
      expect(prisma.leads.create).toHaveBeenCalledTimes(1)
      expect(result).toEqual({ id: 1 })
      jest.useRealTimers()
    })

    it('lock recusado + retry #2 encontra lead (winner commitou): retorna sem chamar create', async () => {
      jest.useFakeTimers()
      const winner = { id: 88 }
      redis.tryAcquireLock.mockResolvedValueOnce(false)
      ;(prisma.leads.findFirst as jest.Mock)
        .mockResolvedValueOnce(null)   // retry #1: ainda não commitado
        .mockResolvedValueOnce(winner) // retry #2: encontrado!

      const promise = service.findOrCreateLeadFromTracking('lead@example.com', CAMPAIGN)
      await jest.advanceTimersByTimeAsync(400)
      const result = await promise

      expect(result).toEqual(winner)
      expect(prisma.leads.create).not.toHaveBeenCalled()
      jest.useRealTimers()
    })

    it('Redis indisponível (tryAcquireLock retorna true permissivamente): fluxo segue normalmente', async () => {
      redis.tryAcquireLock.mockResolvedValueOnce(true)
      ;(prisma.leads.findFirst as jest.Mock).mockResolvedValueOnce(null)
      ;(prisma.leads.create as jest.Mock).mockResolvedValueOnce({ id: 1 })

      const result = await service.findOrCreateLeadFromTracking('lead@example.com', CAMPAIGN)

      expect(prisma.leads.create).toHaveBeenCalledTimes(1)
      expect(result).toEqual({ id: 1 })
    })

    it('apenas phone (sem email): usa phone canônico (sem 55) como chave do lock', async () => {
      ;(prisma.leads.findFirst as jest.Mock).mockResolvedValueOnce(null)
      ;(prisma.leads.create as jest.Mock).mockResolvedValueOnce({ id: 2 })

      await service.findOrCreateLeadFromTracking('', CAMPAIGN, '11999998888')

      // canonicalPhoneForLock("11999998888") = "11999998888" (sem 55)
      expect(redis.tryAcquireLock).toHaveBeenCalledWith(
        'lead:autocreate:comp-1:camp-1:11999998888',
        10,
      )
    })

    it('phone com prefix 55: lock key usa forma canônica (sem 55)', async () => {
      ;(prisma.leads.findFirst as jest.Mock).mockResolvedValueOnce(null)
      ;(prisma.leads.create as jest.Mock).mockResolvedValueOnce({ id: 2 })

      await service.findOrCreateLeadFromTracking('', CAMPAIGN, '5511999998888')

      // canonicalPhoneForLock("5511999998888") = "11999998888" (mesmo lock que sem 55)
      expect(redis.tryAcquireLock).toHaveBeenCalledWith(
        'lead:autocreate:comp-1:camp-1:11999998888',
        10,
      )
    })

    it('lookup OR: phone com 55 encontra lead salvo em qualquer das 4 formas (cross-match)', async () => {
      const existingByPhoneVariant = { id: 60 }
      ;(prisma.leads.findFirst as jest.Mock).mockResolvedValueOnce(existingByPhoneVariant)

      await service.findOrCreateLeadFromTracking('', CAMPAIGN, '5511999998888')

      // phoneVariants gera 4 formas: ±55 × ±9º. Bate com DB em qualquer dos formatos.
      const call = (prisma.leads.findFirst as jest.Mock).mock.calls[0][0]
      expect(call.where.OR[0].phone.in).toEqual(
        expect.arrayContaining(['5511999998888', '551199998888', '1199998888', '11999998888']),
      )
      expect(prisma.leads.create).not.toHaveBeenCalled()
    })

    it('lookup OR: phone sem 55 encontra lead salvo em qualquer das 4 formas (cross-match)', async () => {
      const existingByPhoneVariant = { id: 61 }
      ;(prisma.leads.findFirst as jest.Mock).mockResolvedValueOnce(existingByPhoneVariant)

      await service.findOrCreateLeadFromTracking('', CAMPAIGN, '11999998888')

      const call = (prisma.leads.findFirst as jest.Mock).mock.calls[0][0]
      expect(call.where.OR[0].phone.in).toEqual(
        expect.arrayContaining(['11999998888', '5511999998888', '551199998888', '1199998888']),
      )
      expect(prisma.leads.create).not.toHaveBeenCalled()
    })

    it('email com case e espaços: lock key usa versão normalizada', async () => {
      ;(prisma.leads.findFirst as jest.Mock).mockResolvedValueOnce(null)
      ;(prisma.leads.create as jest.Mock).mockResolvedValueOnce({ id: 3 })

      await service.findOrCreateLeadFromTracking('  Lead@EXAMPLE.com  ', CAMPAIGN)

      expect(redis.tryAcquireLock).toHaveBeenCalledWith(
        'lead:autocreate:comp-1:camp-1:lead@example.com',
        10,
      )
    })
  })

  // ============================================================
  // createLeadFromTracking — Layer 2 (P2002 catch)
  // ============================================================

  describe('createLeadFromTracking — P2002 catch', () => {
    it('P2002 absorvido → findFirst retorna lead vencedor', async () => {
      const winner = { id: 42, email: 'lead@example.com' }
      const p2002 = Object.assign(new Error('Unique constraint violation'), { code: 'P2002' })

      ;(prisma.leads.create as jest.Mock).mockRejectedValueOnce(p2002)
      ;(prisma.leads.findFirst as jest.Mock).mockResolvedValueOnce(winner)

      const result = await service.createLeadFromTracking('lead@example.com', CAMPAIGN)

      expect(prisma.leads.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            email: 'lead@example.com',
            campaignId: CAMPAIGN.campaignId,
            companyId: CAMPAIGN.companyId,
          }),
        }),
      )
      expect(result).toEqual(winner)
    })

    it('P2002 com phone (sem email): findFirst busca pelas 4 variantes (±55 × ±9º) do phone', async () => {
      const winner = { id: 43, phone: '11999998888' }
      const p2002 = Object.assign(new Error('Unique constraint violation'), { code: 'P2002' })

      ;(prisma.leads.create as jest.Mock).mockRejectedValueOnce(p2002)
      ;(prisma.leads.findFirst as jest.Mock).mockResolvedValueOnce(winner)

      const result = await service.createLeadFromTracking('', CAMPAIGN, '11999998888')

      // Lookup robusto: phone com IN cobre as 4 formas do mesmo móvel BR
      const call = (prisma.leads.findFirst as jest.Mock).mock.calls[0][0]
      expect(call.where.campaignId).toBe(CAMPAIGN.campaignId)
      expect(call.where.companyId).toBe(CAMPAIGN.companyId)
      expect(call.where.phone.in).toEqual(
        expect.arrayContaining(['11999998888', '5511999998888', '551199998888', '1199998888']),
      )
      expect(result).toEqual(winner)
    })

    it('erro diferente de P2002 é re-lançado', async () => {
      const otherErr = Object.assign(new Error('DB timeout'), { code: 'P1008' })
      ;(prisma.leads.create as jest.Mock).mockRejectedValueOnce(otherErr)

      await expect(service.createLeadFromTracking('lead@example.com', CAMPAIGN)).rejects.toThrow('DB timeout')
    })
  })

  // ============================================================
  // name — bug: lead nascia sempre sem nome (`name: ''` hardcoded), mesmo quando
  // o payload do optin já trazia o nome. Nada reconsulta esse campo depois do
  // create, então o evento de trigger/Meta CAPI saía pra sempre só com e-mail.
  // ============================================================

  describe('name no create e no enriquecimento de lead existente', () => {
    it('createLeadFromTracking grava o nome recebido (não mais hardcoded vazio)', async () => {
      ;(prisma.leads.create as jest.Mock).mockResolvedValueOnce({ id: 1 })

      await service.createLeadFromTracking('lead@example.com', CAMPAIGN, '', undefined, undefined, 'Ana Silva')

      expect(prisma.leads.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ name: 'Ana Silva' }) }),
      )
    })

    it('createLeadFromTracking sem nome no payload: continua gravando vazio (não inventa nome)', async () => {
      ;(prisma.leads.create as jest.Mock).mockResolvedValueOnce({ id: 1 })

      await service.createLeadFromTracking('lead@example.com', CAMPAIGN)

      expect(prisma.leads.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ name: '' }) }),
      )
    })

    it('lead existente sem nome + optin novo traz nome: preenche (fillBrowserData)', async () => {
      ;(prisma.leads.findFirst as jest.Mock).mockResolvedValueOnce({ id: 10 })
      ;(prisma.leads.findUnique as jest.Mock).mockResolvedValueOnce({
        name: '', fbc: null, fbp: null, fbclid: null, source_url: null, leadIp: null, browser_data: null,
      })

      await service.findOrCreateLeadFromTracking('lead@example.com', CAMPAIGN, '', undefined, undefined, 'Ana Silva')

      expect(prisma.leads.update).toHaveBeenCalledWith({
        where: { id: 10 },
        data: { name: 'Ana Silva' },
      })
    })

    it('lead existente JÁ tem nome: um optin com nome diferente NÃO sobrescreve', async () => {
      ;(prisma.leads.findFirst as jest.Mock).mockResolvedValueOnce({ id: 11 })
      ;(prisma.leads.findUnique as jest.Mock).mockResolvedValueOnce({
        name: 'Nome Original', fbc: null, fbp: null, fbclid: null, source_url: null, leadIp: null, browser_data: null,
      })

      await service.findOrCreateLeadFromTracking('lead@example.com', CAMPAIGN, '', undefined, undefined, 'Outro Nome')

      expect(prisma.leads.update).not.toHaveBeenCalled()
    })
  })
})
