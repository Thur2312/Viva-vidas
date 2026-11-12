import { HttpException } from '@nestjs/common'
import { mockDeep, DeepMockProxy } from 'jest-mock-extended'
import { PrismaService } from 'src/database/prisma.service'
import { TrackingAnalyticsService } from './tracking-analytics.service'
import { FilterTrackingActionsDto } from '../dto/filter-tracking-actions.dto'
import { FilterTrackingEventsDto } from '../dto/filter-tracking-events.dto'

/**
 * TrackingAnalyticsService — alimenta a aba "Tracking" em /analysis.
 *
 * Responsabilidades testadas:
 *  1) Resolver client_hash a partir do companyId (Companies.subdomain)
 *  2) Cache em memoria do client_hash (TTL)
 *  3) Construcao de WHERE dinamico com filtros opcionais
 *  4) Filtro identifiedOnly via EXISTS visitor_identities
 *  5) Paginacao + total count
 *  6) Enrichment com nomes de campanha
 *  7) Drill-down por visitor (timeline cronologica + identidade)
 *  8) Filter options (eventos distintos + campanhas)
 *  9) Validacao de visitorId UUID
 */
describe('TrackingAnalyticsService', () => {
  let service: TrackingAnalyticsService
  let prisma: DeepMockProxy<PrismaService>

  const COMPANY_ID = 'company-abc'
  const SUBDOMAIN = 'macloapp'
  const CLIENT_HASH = 'macloapp'
  const VISITOR_UUID = '11111111-2222-4333-8444-555555555555'
  const SESSION_UUID = '99999999-aaaa-4bbb-8ccc-dddddddddddd'

  beforeEach(() => {
    prisma = mockDeep<PrismaService>()
    service = new TrackingAnalyticsService(prisma as any)
    ;(prisma.companies.findUnique as any).mockResolvedValue({ subdomain: SUBDOMAIN })
    ;(prisma.$queryRawUnsafe as any).mockResolvedValue([])
    ;(prisma.campaigns.findMany as any).mockResolvedValue([])
    ;(prisma.tracking.findMany as any).mockResolvedValue([])
  })

  // ============================================================
  // 1) Resolucao de client_hash + cache
  // ============================================================
  describe('resolveClientHash (via filterTrackingEvents)', () => {
    it('lookup Companies.subdomain e usa lowercase como client_hash', async () => {
      ;(prisma.companies.findUnique as any).mockResolvedValue({ subdomain: 'MACLOAPP' })
      await service.filterTrackingEvents(COMPANY_ID, {})
      expect(prisma.companies.findUnique).toHaveBeenCalledWith({
        where: { id: COMPANY_ID },
        select: { subdomain: true },
      })
      const sqlCall = (prisma.$queryRawUnsafe as any).mock.calls[0]
      expect(sqlCall[1]).toBe('macloapp')
    })

    it('lanca HttpException quando empresa nao tem subdomain', async () => {
      ;(prisma.companies.findUnique as any).mockResolvedValue({ subdomain: null })
      await expect(service.filterTrackingEvents(COMPANY_ID, {})).rejects.toThrow(HttpException)
    })

    it('cacheia client_hash entre chamadas (1 unico findUnique)', async () => {
      await service.filterTrackingEvents(COMPANY_ID, {})
      await service.filterTrackingEvents(COMPANY_ID, {})
      await service.filterTrackingEvents(COMPANY_ID, {})
      expect(prisma.companies.findUnique).toHaveBeenCalledTimes(1)
    })
  })

  // ============================================================
  // 2) Construcao do WHERE dinamico
  // ============================================================
  describe('filterTrackingEvents - WHERE clause', () => {
    it('inclui apenas client_hash quando filtros vazios', async () => {
      await service.filterTrackingEvents(COMPANY_ID, {})
      const [sql, ...params] = (prisma.$queryRawUnsafe as any).mock.calls[0]
      expect(sql).toContain('te.client_hash = $1')
      expect(sql).not.toContain('te.event = ANY')
      expect(params[0]).toBe(CLIENT_HASH)
    })

    it('aplica filtros de data como timestamptz', async () => {
      const filters: FilterTrackingEventsDto = {
        startDate: '2026-04-01T00:00:00Z',
        endDate: '2026-04-19T23:59:59Z',
      }
      await service.filterTrackingEvents(COMPANY_ID, filters)
      const [sql, ...params] = (prisma.$queryRawUnsafe as any).mock.calls[0]
      expect(sql).toContain('te.created_at >= $2::timestamptz')
      expect(sql).toContain('te.created_at <= $3::timestamptz')
      expect(params[1]).toBe('2026-04-01T00:00:00Z')
      expect(params[2]).toBe('2026-04-19T23:59:59Z')
    })

    it('aplica filtro events com ANY array', async () => {
      await service.filterTrackingEvents(COMPANY_ID, { events: ['pageview', 'click'] })
      const [sql, ...params] = (prisma.$queryRawUnsafe as any).mock.calls[0]
      expect(sql).toContain('te.event = ANY($2::text[])')
      expect(params[1]).toEqual(['pageview', 'click'])
    })

    it('aplica filtro campaignIds com ANY array', async () => {
      await service.filterTrackingEvents(COMPANY_ID, { campaignIds: ['camp-1', 'camp-2'] })
      const [sql, ...params] = (prisma.$queryRawUnsafe as any).mock.calls[0]
      expect(sql).toContain('te.campaign_id = ANY($2::text[])')
      expect(params[1]).toEqual(['camp-1', 'camp-2'])
    })

    it('aplica urlSearch com wildcards ILIKE em page e url', async () => {
      await service.filterTrackingEvents(COMPANY_ID, { urlSearch: 'checkout' })
      const [sql, ...params] = (prisma.$queryRawUnsafe as any).mock.calls[0]
      expect(sql).toContain('(te.page ILIKE $2 OR te.url ILIKE $2)')
      expect(params[1]).toBe('%checkout%')
    })

    it('aplica filtros UTM com igualdade exata', async () => {
      await service.filterTrackingEvents(COMPANY_ID, {
        utmSource: 'fb',
        utmMedium: 'cpc',
        utmCampaign: 'lancamento',
      })
      const [sql, ...params] = (prisma.$queryRawUnsafe as any).mock.calls[0]
      expect(sql).toContain('te.utm_source = $2')
      expect(sql).toContain('te.utm_medium = $3')
      expect(sql).toContain('te.utm_campaign = $4')
      expect(params.slice(1, 4)).toEqual(['fb', 'cpc', 'lancamento'])
    })

    it('aplica visitorId e sessionId como UUID', async () => {
      await service.filterTrackingEvents(COMPANY_ID, {
        visitorId: VISITOR_UUID,
        sessionId: SESSION_UUID,
      })
      const [sql, ...params] = (prisma.$queryRawUnsafe as any).mock.calls[0]
      expect(sql).toContain('te.visitor_id = $2::uuid')
      expect(sql).toContain('te.session_id = $3::uuid')
      expect(params[1]).toBe(VISITOR_UUID)
      expect(params[2]).toBe(SESSION_UUID)
    })

    it('aplica formEmail com ILIKE wildcards', async () => {
      await service.filterTrackingEvents(COMPANY_ID, { formEmail: 'arthur' })
      const [sql, ...params] = (prisma.$queryRawUnsafe as any).mock.calls[0]
      expect(sql).toContain('te.form_email ILIKE $2')
      expect(params[1]).toBe('%arthur%')
    })

    it('aplica identifiedOnly via EXISTS subquery em visitor_identities', async () => {
      await service.filterTrackingEvents(COMPANY_ID, { identifiedOnly: true })
      const [sql] = (prisma.$queryRawUnsafe as any).mock.calls[0]
      expect(sql).toContain('EXISTS')
      expect(sql).toContain('visitor_identities vi2')
      expect(sql).toContain('vi2.visitor_id = te.visitor_id')
    })

    it('NAO aplica identifiedOnly quando false/undefined', async () => {
      await service.filterTrackingEvents(COMPANY_ID, { identifiedOnly: false })
      const [sql] = (prisma.$queryRawUnsafe as any).mock.calls[0]
      expect(sql).not.toContain('EXISTS')
    })
  })

  // ============================================================
  // 3) Paginacao + total
  // ============================================================
  describe('filterTrackingEvents - paginacao', () => {
    it('default page=1 limit=25', async () => {
      ;(prisma.$queryRawUnsafe as any)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ count: BigInt(0) }])
      const result = await service.filterTrackingEvents(COMPANY_ID, {})
      expect(result.page).toBe(1)
      expect(result.limit).toBe(25)
      expect(result.totalPages).toBe(1)
    })

    it('calcula offset corretamente', async () => {
      ;(prisma.$queryRawUnsafe as any)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ count: BigInt(100) }])
      await service.filterTrackingEvents(COMPANY_ID, { page: 3, limit: 10 })
      const dataCall = (prisma.$queryRawUnsafe as any).mock.calls[0]
      const params = dataCall.slice(1)
      // ultimos 2 params = limit, offset
      expect(params[params.length - 2]).toBe(10)
      expect(params[params.length - 1]).toBe(20) // (3-1)*10
    })

    it('retorna totalPages calculado', async () => {
      ;(prisma.$queryRawUnsafe as any)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ count: BigInt(57) }])
      const result = await service.filterTrackingEvents(COMPANY_ID, { limit: 10 })
      expect(result.total).toBe(57)
      expect(result.totalPages).toBe(6)
    })
  })

  // ============================================================
  // 3.1) Resiliencia: COUNT capado + fallback degraded
  // ============================================================
  describe('filterTrackingEvents - resiliencia', () => {
    it('COUNT usa subquery capada (LIMIT 10001) em vez de COUNT(*) completo', async () => {
      ;(prisma.$queryRawUnsafe as any)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ count: BigInt(0) }])
      await service.filterTrackingEvents(COMPANY_ID, {})
      const countSql = (prisma.$queryRawUnsafe as any).mock.calls[1][0]
      expect(countSql).toContain('FROM (SELECT 1 FROM tracking_events te WHERE')
      expect(countSql).toContain('LIMIT 10001')
    })

    it('marca capped e fixa total no teto quando ha mais que o cap', async () => {
      ;(prisma.$queryRawUnsafe as any)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ count: BigInt(10001) }])
      const result = await service.filterTrackingEvents(COMPANY_ID, { limit: 25 })
      expect(result.capped).toBe(true)
      expect(result.total).toBe(10000)
      expect(result.totalPages).toBe(400)
    })

    it('nao marca capped quando total abaixo do teto', async () => {
      ;(prisma.$queryRawUnsafe as any)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ count: BigInt(500) }])
      const result = await service.filterTrackingEvents(COMPANY_ID, {})
      expect(result.capped).toBe(false)
      expect(result.total).toBe(500)
    })

    it('retorna resposta vazia degraded quando a query falha (sem lancar)', async () => {
      ;(prisma.$queryRawUnsafe as any).mockRejectedValue(new Error('timeout'))
      const result = await service.filterTrackingEvents(COMPANY_ID, { page: 2, limit: 10 })
      expect(result).toEqual({
        data: [],
        total: 0,
        page: 2,
        limit: 10,
        totalPages: 1,
        degraded: true,
      })
    })
  })

  // ============================================================
  // 4) Enrichment com nomes de campanha
  // ============================================================
  describe('filterTrackingEvents - enrichment', () => {
    it('busca nomes das campanhas presentes nos eventos', async () => {
      const row = {
        id: BigInt(1),
        client_hash: CLIENT_HASH,
        campaign_id: 'camp-xyz',
        visitor_id: VISITOR_UUID,
        session_id: SESSION_UUID,
        event: 'pageview',
        created_at: new Date(),
        identified_email: null,
        identified_name: null,
      }
      ;(prisma.$queryRawUnsafe as any)
        .mockResolvedValueOnce([row])
        .mockResolvedValueOnce([{ count: BigInt(1) }])
      ;(prisma.campaigns.findMany as any).mockResolvedValue([
        { campaignId: 'camp-xyz', name: 'Campanha XYZ' },
      ])

      const result = await service.filterTrackingEvents(COMPANY_ID, {})
      expect(prisma.campaigns.findMany).toHaveBeenCalledWith({
        where: { campaignId: { in: ['camp-xyz'] }, companyId: COMPANY_ID },
        select: { campaignId: true, name: true },
      })
      expect(result.data[0].campaignName).toBe('Campanha XYZ')
    })

    it('NAO busca campanhas quando nao ha campaign_id nos resultados', async () => {
      ;(prisma.$queryRawUnsafe as any)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ count: BigInt(0) }])
      await service.filterTrackingEvents(COMPANY_ID, {})
      expect(prisma.campaigns.findMany).not.toHaveBeenCalled()
    })
  })

  // ============================================================
  // 5) Drill-down por visitor
  // ============================================================
  describe('getVisitorTimeline', () => {
    it('rejeita visitorId nao-UUID', async () => {
      await expect(service.getVisitorTimeline(COMPANY_ID, 'not-a-uuid')).rejects.toThrow(
        HttpException,
      )
    })

    it('busca identidade e eventos do visitante', async () => {
      const identity = {
        visitor_id: VISITOR_UUID,
        email: 'arthur@example.com',
        nome: 'Arthur',
        telefone: null,
        fbc: null,
        fbp: null,
        campaign_id: null,
        form_config_id: null,
        created_at: new Date(),
        updated_at: new Date(),
      }
      const event = {
        id: BigInt(1),
        client_hash: CLIENT_HASH,
        campaign_id: null,
        visitor_id: VISITOR_UUID,
        session_id: SESSION_UUID,
        event: 'pageview',
        created_at: new Date(),
      }
      ;(prisma.$queryRawUnsafe as any)
        .mockResolvedValueOnce([identity])
        .mockResolvedValueOnce([event])

      const result = await service.getVisitorTimeline(COMPANY_ID, VISITOR_UUID)
      expect(result.identity?.email).toBe('arthur@example.com')
      expect(result.events).toHaveLength(1)
      expect(result.events[0].event).toBe('pageview')
    })

    it('retorna identity null quando visitante anonimo', async () => {
      ;(prisma.$queryRawUnsafe as any).mockResolvedValueOnce([]).mockResolvedValueOnce([])
      const result = await service.getVisitorTimeline(COMPANY_ID, VISITOR_UUID)
      expect(result.identity).toBeNull()
      expect(result.events).toEqual([])
    })

    it('ordena eventos ASC (cronologico)', async () => {
      ;(prisma.$queryRawUnsafe as any).mockResolvedValueOnce([]).mockResolvedValueOnce([])
      await service.getVisitorTimeline(COMPANY_ID, VISITOR_UUID)
      const eventsSql = (prisma.$queryRawUnsafe as any).mock.calls[1][0]
      expect(eventsSql).toContain('ORDER BY te.created_at ASC')
    })

    it('limita o drill-down a 2000 eventos (LIMIT)', async () => {
      ;(prisma.$queryRawUnsafe as any).mockResolvedValueOnce([]).mockResolvedValueOnce([])
      await service.getVisitorTimeline(COMPANY_ID, VISITOR_UUID)
      const eventsSql = (prisma.$queryRawUnsafe as any).mock.calls[1][0]
      expect(eventsSql).toContain('LIMIT 2000')
    })
  })

  // ============================================================
  // 6) Filter options
  // ============================================================
  describe('getTrackingFilterOptions', () => {
    it('retorna eventos distintos de Tracking.action + todas campanhas da empresa', async () => {
      ;(prisma.tracking.findMany as any).mockResolvedValue([
        { action: 'OPTIN' },
        { action: 'click' },
        { action: 'page_view' },
      ])
      ;(prisma.campaigns.findMany as any).mockResolvedValue([
        { campaignId: 'camp-1', name: 'Campanha 1' },
        { campaignId: 'camp-2', name: 'Campanha 2' },
      ])

      const result = await service.getTrackingFilterOptions(COMPANY_ID)

      expect(prisma.tracking.findMany).toHaveBeenCalledWith({
        where: { companyId: COMPANY_ID },
        distinct: ['action'],
        select: { action: true },
        orderBy: { action: 'asc' },
      })
      expect(prisma.campaigns.findMany).toHaveBeenCalledWith({
        where: { companyId: COMPANY_ID },
        select: { campaignId: true, name: true },
        orderBy: { name: 'asc' },
      })
      expect(result.events).toEqual(['OPTIN', 'click', 'page_view'])
      expect(result.campaigns).toEqual([
        { id: 'camp-1', name: 'Campanha 1' },
        { id: 'camp-2', name: 'Campanha 2' },
      ])
    })

    it('filtra actions null/vazias do Tracking', async () => {
      ;(prisma.tracking.findMany as any).mockResolvedValue([
        { action: 'OPTIN' },
        { action: null },
        { action: '' },
        { action: '   ' },
        { action: 'click' },
      ])

      const result = await service.getTrackingFilterOptions(COMPANY_ID)
      expect(result.events).toEqual(['OPTIN', 'click'])
    })

    it('usa name do campaignId quando name e null', async () => {
      ;(prisma.campaigns.findMany as any).mockResolvedValue([
        { campaignId: 'camp-x', name: null },
      ])
      const result = await service.getTrackingFilterOptions(COMPANY_ID)
      expect(result.campaigns).toEqual([{ id: 'camp-x', name: 'camp-x' }])
    })

    it('valida empresa via resolveClientHash (lanca se sem subdomain)', async () => {
      ;(prisma.companies.findUnique as any).mockResolvedValue({ subdomain: null })
      await expect(service.getTrackingFilterOptions(COMPANY_ID)).rejects.toThrow(HttpException)
    })

    it('NAO usa raw SQL para opcoes (apenas Prisma)', async () => {
      await service.getTrackingFilterOptions(COMPANY_ID)
      // $queryRawUnsafe nao deve ter sido chamado para events/campaigns
      // (resolveClientHash usa findUnique, nao raw SQL)
      expect(prisma.$queryRawUnsafe).not.toHaveBeenCalled()
    })
  })

  // ============================================================
  // Sub-aba "Acoes" - filterTrackingActions (tabela Tracking)
  // ============================================================
  describe('filterTrackingActions', () => {
    beforeEach(() => {
      ;(prisma.tracking.findMany as any).mockResolvedValue([])
      ;(prisma.tracking.count as any).mockResolvedValue(0)
    })

    it('WHERE minimo tem apenas companyId', async () => {
      await service.filterTrackingActions(COMPANY_ID, {})
      const call = (prisma.tracking.findMany as any).mock.calls[0][0]
      expect(call.where).toEqual({ companyId: COMPANY_ID })
      expect(call.orderBy).toEqual({ timestamp: 'desc' })
      expect(call.include).toEqual({ campaign: { select: { name: true } } })
    })

    it('aplica intervalo de datas em timestamp', async () => {
      const filters: FilterTrackingActionsDto = {
        startDate: '2026-04-01T00:00:00Z',
        endDate: '2026-04-19T23:59:59Z',
      }
      await service.filterTrackingActions(COMPANY_ID, filters)
      const call = (prisma.tracking.findMany as any).mock.calls[0][0]
      expect(call.where.timestamp.gte).toEqual(new Date('2026-04-01T00:00:00Z'))
      expect(call.where.timestamp.lte).toEqual(new Date('2026-04-19T23:59:59Z'))
    })

    it('actions: fase 1 busca identidades distinct(email,phone) com OR insensitive das acoes', async () => {
      ;(prisma.tracking.findMany as any)
        .mockResolvedValueOnce([
          { email: 'a@b.com', phone: null },
          { email: null, phone: '11999' },
        ])
        .mockResolvedValueOnce([])
      await service.filterTrackingActions(COMPANY_ID, { actions: ['OPTIN', 'click'] })

      const phase1 = (prisma.tracking.findMany as any).mock.calls[0][0]
      expect(phase1.where).toEqual({
        companyId: COMPANY_ID,
        OR: [
          { action: { equals: 'OPTIN', mode: 'insensitive' } },
          { action: { equals: 'click', mode: 'insensitive' } },
        ],
      })
      expect(phase1.select).toEqual({ email: true, phone: true })
      expect(phase1.distinct).toEqual(['email', 'phone'])
    })

    it('actions: fase 2 retorna eventos de leads identificados (lead-centric)', async () => {
      ;(prisma.tracking.findMany as any)
        .mockResolvedValueOnce([
          { email: 'a@b.com', phone: null },
          { email: null, phone: '11999' },
          { email: 'a@b.com', phone: '11999' },
          { email: '', phone: '  ' },
        ])
        .mockResolvedValueOnce([])
      await service.filterTrackingActions(COMPANY_ID, { actions: ['OPTIN'] })

      const phase2 = (prisma.tracking.findMany as any).mock.calls[1][0]
      expect(phase2.where.companyId).toBe(COMPANY_ID)
      expect(phase2.where.OR).toBeUndefined()
      expect(phase2.where.AND).toEqual([
        { OR: [{ email: { in: ['a@b.com'] } }, { phone: { in: ['11999'] } }] },
      ])
    })

    it('actions: early return { data: [], total: 0 } quando nenhum lead bate', async () => {
      ;(prisma.tracking.findMany as any).mockResolvedValueOnce([])
      const result = await service.filterTrackingActions(COMPANY_ID, {
        actions: ['acao-inexistente'],
      })
      expect(result).toEqual({ data: [], total: 0, page: 1, limit: 25, totalPages: 0 })
      expect((prisma.tracking.findMany as any).mock.calls.length).toBe(1)
      expect((prisma.tracking.count as any).mock.calls.length).toBe(0)
    })

    it('actions + dateRange: intervalo aplicado nas duas fases', async () => {
      ;(prisma.tracking.findMany as any)
        .mockResolvedValueOnce([{ email: 'a@b.com', phone: null }])
        .mockResolvedValueOnce([])
      await service.filterTrackingActions(COMPANY_ID, {
        actions: ['OPTIN'],
        startDate: '2026-04-01T00:00:00Z',
        endDate: '2026-04-19T23:59:59Z',
      })
      const phase1 = (prisma.tracking.findMany as any).mock.calls[0][0]
      const phase2 = (prisma.tracking.findMany as any).mock.calls[1][0]
      expect(phase1.where.timestamp).toEqual({
        gte: new Date('2026-04-01T00:00:00Z'),
        lte: new Date('2026-04-19T23:59:59Z'),
      })
      expect(phase2.where.timestamp).toEqual({
        gte: new Date('2026-04-01T00:00:00Z'),
        lte: new Date('2026-04-19T23:59:59Z'),
      })
    })

    it('actions + hasEmail: empilham em where.AND sem perder o OR de identidade', async () => {
      ;(prisma.tracking.findMany as any)
        .mockResolvedValueOnce([{ email: 'a@b.com', phone: null }])
        .mockResolvedValueOnce([])
      await service.filterTrackingActions(COMPANY_ID, {
        actions: ['OPTIN'],
        hasEmail: true,
      })
      const phase2 = (prisma.tracking.findMany as any).mock.calls[1][0]
      expect(phase2.where.AND).toEqual([
        { OR: [{ email: { in: ['a@b.com'] } }] },
        { email: { not: null } },
        { email: { not: '' } },
      ])
    })

    it('actions: lead identificado so por phone (email null) e incluido', async () => {
      ;(prisma.tracking.findMany as any)
        .mockResolvedValueOnce([{ email: null, phone: '11999' }])
        .mockResolvedValueOnce([])
      await service.filterTrackingActions(COMPANY_ID, { actions: ['click'] })
      const phase2 = (prisma.tracking.findMany as any).mock.calls[1][0]
      expect(phase2.where.AND).toEqual([{ OR: [{ phone: { in: ['11999'] } }] }])
    })

    it('aplica campaignIds com in', async () => {
      await service.filterTrackingActions(COMPANY_ID, { campaignIds: ['camp-1', 'camp-2'] })
      const call = (prisma.tracking.findMany as any).mock.calls[0][0]
      expect(call.where.campaignId).toEqual({ in: ['camp-1', 'camp-2'] })
    })

    it('aplica ILIKE em email, name, phone, urlSearch e tag', async () => {
      await service.filterTrackingActions(COMPANY_ID, {
        email: 'arthur',
        name: 'Arthur',
        phone: '11999',
        urlSearch: 'checkout',
        tag: 'black-friday',
      })
      const call = (prisma.tracking.findMany as any).mock.calls[0][0]
      expect(call.where.email).toEqual({ contains: 'arthur', mode: 'insensitive' })
      expect(call.where.name).toEqual({ contains: 'Arthur', mode: 'insensitive' })
      expect(call.where.phone).toEqual({ contains: '11999', mode: 'insensitive' })
      expect(call.where.url).toEqual({ contains: 'checkout', mode: 'insensitive' })
      expect(call.where.tag).toEqual({ contains: 'black-friday', mode: 'insensitive' })
    })

    it('aplica filtros UTM e Facebook Lead Ads (igualdade)', async () => {
      await service.filterTrackingActions(COMPANY_ID, {
        utmSource: 'fb',
        utmMedium: 'cpc',
        utmCampaign: 'lancamento',
        utmTerm: 'palavra',
        utmContent: 'variante-a',
        adId: 'ad-1',
        adsetId: 'adset-1',
        formId: 'form-1',
      })
      const call = (prisma.tracking.findMany as any).mock.calls[0][0]
      expect(call.where.utm_source).toBe('fb')
      expect(call.where.utm_medium).toBe('cpc')
      expect(call.where.utm_campaign).toBe('lancamento')
      expect(call.where.utm_term).toBe('palavra')
      expect(call.where.utm_content).toBe('variante-a')
      expect(call.where.ad_id).toBe('ad-1')
      expect(call.where.adset_id).toBe('adset-1')
      expect(call.where.form_id).toBe('form-1')
    })

    it('hasEmail=true exige email nao nulo e nao vazio', async () => {
      await service.filterTrackingActions(COMPANY_ID, { hasEmail: true })
      const call = (prisma.tracking.findMany as any).mock.calls[0][0]
      expect(call.where.AND).toEqual([
        { email: { not: null } },
        { email: { not: '' } },
      ])
    })

    it('calcula paginacao e totalPages corretamente', async () => {
      ;(prisma.tracking.count as any).mockResolvedValue(57)
      const result = await service.filterTrackingActions(COMPANY_ID, { page: 3, limit: 10 })
      const call = (prisma.tracking.findMany as any).mock.calls[0][0]
      expect(call.skip).toBe(20)
      expect(call.take).toBe(10)
      expect(result.total).toBe(57)
      expect(result.page).toBe(3)
      expect(result.limit).toBe(10)
      expect(result.totalPages).toBe(6)
    })

    it('mapeia campaign.name no resultado', async () => {
      ;(prisma.tracking.findMany as any).mockResolvedValue([
        {
          id: 'row-1',
          timestamp: new Date('2026-04-19T10:00:00Z'),
          action: 'OPTIN',
          email: 'a@b.com',
          name: 'A',
          phone: null,
          url: '/checkout',
          referral: null,
          ip: '1.2.3.4',
          device: 'mobile',
          sessionId: 'sess-1',
          campaignId: 'camp-1',
          campaign: { name: 'Campanha Teste' },
          tag: null,
          trackingTitle: null,
          trackingIconUrl: null,
          trackingObs: null,
          utms: null,
          utm_source: null,
          utm_medium: null,
          utm_campaign: null,
          utm_content: null,
          utm_term: null,
          utm_var1: null,
          fbc: null,
          gclid: null,
          ad_id: null,
          ad_name: null,
          adset_id: null,
          adset_name: null,
          page_id: null,
          page_name: null,
          form_id: null,
          form_name: null,
        },
      ])
      ;(prisma.tracking.count as any).mockResolvedValue(1)
      const result = await service.filterTrackingActions(COMPANY_ID, {})
      expect(result.data[0].campaignName).toBe('Campanha Teste')
      expect(result.data[0].action).toBe('OPTIN')
      expect(result.data[0].email).toBe('a@b.com')
    })
  })

  // ============================================================
  // Sub-aba "Acoes" - getTrackingActionsFilterOptions
  // ============================================================
  describe('getTrackingActionsFilterOptions', () => {
    it('normaliza OPTIN/optin para lowercase e dedup', async () => {
      ;(prisma.tracking.findMany as any).mockResolvedValue([
        { action: 'OPTIN' },
        { action: 'optin' },
        { action: 'click' },
        { action: 'Session' },
        { action: null },
        { action: '' },
        { action: '  ' },
      ])
      ;(prisma.campaigns.findMany as any).mockResolvedValue([])

      const result = await service.getTrackingActionsFilterOptions(COMPANY_ID)
      expect(result.actions).toEqual(['click', 'optin', 'session'])
      expect(prisma.tracking.findMany).toHaveBeenCalledWith({
        where: { companyId: COMPANY_ID },
        distinct: ['action'],
        select: { action: true },
        orderBy: { action: 'asc' },
      })
    })

    it('retorna campanhas da empresa com id e name', async () => {
      ;(prisma.tracking.findMany as any).mockResolvedValue([])
      ;(prisma.campaigns.findMany as any).mockResolvedValue([
        { campaignId: 'camp-a', name: 'Alpha' },
        { campaignId: 'camp-b', name: null },
      ])
      const result = await service.getTrackingActionsFilterOptions(COMPANY_ID)
      expect(result.campaigns).toEqual([
        { id: 'camp-a', name: 'Alpha' },
        { id: 'camp-b', name: 'camp-b' },
      ])
    })
  })

  // ============================================================
  // Volume por acao — o que ordena o catalogo
  // ============================================================
  describe('getTrackingActionUsage', () => {
    const group = (action: string, count: number, ts?: string) => ({
      action,
      _count: { _all: count },
      _max: { timestamp: ts ? new Date(ts) : null },
    })

    it('SOMA as contagens ao juntar OPTIN e optin', async () => {
      // A armadilha da feature: o groupBy nao aceita lower(action), entao a acao
      // mais usada da empresa volta partida em duas linhas. Ficar com uma e
      // descartar a outra reportaria metade dos eventos.
      ;(prisma.tracking.groupBy as any).mockResolvedValue([
        group('OPTIN', 2000, '2026-08-18'),
        group('optin', 1059, '2026-06-24'),
      ])

      const [row] = await service.getTrackingActionUsage(COMPANY_ID)

      expect(row.action).toBe('optin')
      expect(row.eventCount).toBe(3059)
    })

    it('ao juntar, fica com a data MAIS RECENTE', async () => {
      ;(prisma.tracking.groupBy as any).mockResolvedValue([
        group('OPTIN', 1, '2025-01-01'),
        group('optin', 1, '2026-08-18'),
      ])

      const [row] = await service.getTrackingActionUsage(COMPANY_ID)

      expect(row.lastSeenAt).toEqual(new Date('2026-08-18'))
    })

    it('ordena por volume, desempatando por nome', async () => {
      ;(prisma.tracking.groupBy as any).mockResolvedValue([
        group('acceced', 1),
        group('optin', 3059),
        group('zeta', 1),
      ])

      const rows = await service.getTrackingActionUsage(COMPANY_ID)

      expect(rows.map((r) => r.action)).toEqual(['optin', 'acceced', 'zeta'])
    })

    it('descarta acao nula, vazia ou so espaco', async () => {
      ;(prisma.tracking.groupBy as any).mockResolvedValue([
        group('optin', 10),
        group(null as any, 5),
        group('', 3),
        group('   ', 2),
      ])

      const rows = await service.getTrackingActionUsage(COMPANY_ID)

      expect(rows).toHaveLength(1)
      expect(rows[0].action).toBe('optin')
    })

    it('acao sem timestamp devolve lastSeenAt null', async () => {
      ;(prisma.tracking.groupBy as any).mockResolvedValue([group('optin', 1)])

      const [row] = await service.getTrackingActionUsage(COMPANY_ID)

      expect(row.lastSeenAt).toBeNull()
    })

    it('agrupa com filtro de companyId — isolamento multi-tenant', async () => {
      ;(prisma.tracking.groupBy as any).mockResolvedValue([])

      await service.getTrackingActionUsage(COMPANY_ID)

      expect(prisma.tracking.groupBy).toHaveBeenCalledWith({
        by: ['action'],
        where: { companyId: COMPANY_ID },
        _count: { _all: true },
        _max: { timestamp: true },
      })
    })
  })
})
