import { HttpException, HttpStatus } from '@nestjs/common'
import { mockDeep, DeepMockProxy } from 'jest-mock-extended'
import { randomUUID } from 'crypto'
import { PrismaService } from 'src/database/prisma.service'
import { TrackingCollectService } from './tracking-collect.service'
import { TrackingEventService } from './tracking-event.service'
import { TrackingLeadService } from './tracking-lead.service'
import { TrackingAuthService } from './tracking-auth.service'
import {
  buildCollectEventDto,
  buildPageviewEvent,
  buildClickEvent,
  buildFormSubmitEvent,
  buildScrollDepthEvent,
  buildPageExitEvent,
} from 'test/builders/tracking.builder'

/**
 * TrackingCollectService — recebe eventos do tracker.js via POST /tracking/collect/:subdomain.
 *
 * Responsabilidades testadas:
 *  1) Validação fail-fast dos campos obrigatórios do DTO
 *  2) Sanitização de strings (truncagem + validação de email)
 *  3) INSERT em tracking_events via raw SQL para todos os tipos de event
 *  4) Identity stitching em visitor_identities para form_submit + email
 *  5) Fluxo backward-compat: criação de Tracking legacy + Lead vinculado à campaign
 *  6) Dedup de OPTIN via hasRecentOptin
 *  7) Dedup de Lead via findFirst
 *  8) Tolerância a erros no fluxo backward-compat (try/catch)
 */
describe('TrackingCollectService', () => {
  let service: TrackingCollectService
  let prisma: DeepMockProxy<PrismaService>
  let eventService: jest.Mocked<TrackingEventService>
  let leadService: jest.Mocked<TrackingLeadService>
  let authService: jest.Mocked<TrackingAuthService>

  const SUBDOMAIN = 'test-client'
  const COMPANY_ID = 'company-123'
  const CAMPAIGN_ID = 'campaign-abc'

  beforeEach(() => {
    prisma = mockDeep<PrismaService>()
    eventService = { emitTrackingEvent: jest.fn() } as any
    leadService = {
      createLeadFromTracking: jest.fn(),
      findOrCreateLeadFromTracking: jest.fn().mockResolvedValue({ id: 1 }),
    } as any
    authService = { hasRecentOptin: jest.fn().mockResolvedValue(false) } as any

    service = new TrackingCollectService(
      prisma as any,
      eventService,
      leadService,
      authService,
    )

    // Default: $queryRawUnsafe resolves
    ;(prisma.$queryRawUnsafe as any).mockResolvedValue(undefined)
    // Default: no company found (for safe fallback testing)
    ;(prisma.client.companies.findFirst as any).mockResolvedValue(null)
  })

  // ============================================================
  // 1) Validação do DTO (fail-fast)
  // ============================================================

  describe('validação fail-fast', () => {
    it('rejeita client_hash vazio', async () => {
      const dto = buildCollectEventDto({ client_hash: '' })
      await expect(service.collectEvent(dto, SUBDOMAIN)).rejects.toThrow(
        new HttpException('client_hash inválido', HttpStatus.BAD_REQUEST),
      )
    })

    it('rejeita client_hash com caracteres inválidos', async () => {
      const dto = buildCollectEventDto({ client_hash: 'invalid@hash!' })
      await expect(service.collectEvent(dto, SUBDOMAIN)).rejects.toThrow(HttpException)
    })

    it('rejeita client_hash muito longo (> 50)', async () => {
      const dto = buildCollectEventDto({ client_hash: 'a'.repeat(51) })
      await expect(service.collectEvent(dto, SUBDOMAIN)).rejects.toThrow(HttpException)
    })

    it('aceita client_hash válido (alphanumeric + hyphen/underscore)', async () => {
      const dto = buildCollectEventDto({ client_hash: 'valid-hash_123' })
      await expect(service.collectEvent(dto, SUBDOMAIN)).resolves.toEqual({ ok: true })
    })

    it('rejeita visitor_id não-UUID', async () => {
      const dto = buildCollectEventDto({ visitor_id: 'not-a-uuid' })
      await expect(service.collectEvent(dto, SUBDOMAIN)).rejects.toThrow(
        new HttpException('visitor_id inválido', HttpStatus.BAD_REQUEST),
      )
    })

    it('rejeita visitor_id UUID v1 (não v4)', async () => {
      // UUID v1 tem version bit diferente (1 no lugar de 4)
      const dto = buildCollectEventDto({ visitor_id: '550e8400-e29b-11d4-a716-446655440000' })
      await expect(service.collectEvent(dto, SUBDOMAIN)).rejects.toThrow(HttpException)
    })

    it('rejeita session_id não-UUID', async () => {
      const dto = buildCollectEventDto({ session_id: 'garbage' })
      await expect(service.collectEvent(dto, SUBDOMAIN)).rejects.toThrow(
        new HttpException('session_id inválido', HttpStatus.BAD_REQUEST),
      )
    })

    it('rejeita event vazio', async () => {
      const dto = buildCollectEventDto({ event: '' })
      await expect(service.collectEvent(dto, SUBDOMAIN)).rejects.toThrow(HttpException)
    })

    it('rejeita event > 50 chars', async () => {
      const dto = buildCollectEventDto({ event: 'x'.repeat(51) })
      await expect(service.collectEvent(dto, SUBDOMAIN)).rejects.toThrow(HttpException)
    })
  })

  // ============================================================
  // 2) Persistência em tracking_events
  // ============================================================

  describe('persistência em tracking_events', () => {
    it('pageview: insere com campos mínimos', async () => {
      const dto = buildPageviewEvent()
      await service.collectEvent(dto, SUBDOMAIN)

      expect(prisma.$queryRawUnsafe).toHaveBeenCalledTimes(1)
      const [sql, ...params] = (prisma.$queryRawUnsafe as jest.Mock).mock.calls[0]
      expect(sql).toContain('INSERT INTO tracking_events')
      expect(params[0]).toBe(dto.client_hash.toLowerCase()) // client_hash normalized
      expect(params[5]).toBe('pageview') // event position
    })

    it('click: insere coordenadas e viewport', async () => {
      const dto = buildClickEvent()
      await service.collectEvent(dto, SUBDOMAIN)

      const params = (prisma.$queryRawUnsafe as jest.Mock).mock.calls[0].slice(1)
      // click_x=$16, click_y=$17, page_x=$18, page_y=$19, viewport_w=$20, viewport_h=$21, scroll_y=$22
      expect(params[15]).toBe(100) // click_x
      expect(params[16]).toBe(200) // click_y
      expect(params[19]).toBe(1920) // viewport_w
      expect(params[20]).toBe(1080) // viewport_h
    })

    it('scroll_depth: persiste scroll_pct', async () => {
      const dto = buildScrollDepthEvent(75)
      await service.collectEvent(dto, SUBDOMAIN)

      const params = (prisma.$queryRawUnsafe as jest.Mock).mock.calls[0].slice(1)
      // scroll_pct = $23
      expect(params[22]).toBe(75)
    })

    it('page_exit: persiste time_on_page_ms', async () => {
      const dto = buildPageExitEvent(12345)
      await service.collectEvent(dto, SUBDOMAIN)

      const params = (prisma.$queryRawUnsafe as jest.Mock).mock.calls[0].slice(1)
      // time_on_page_ms = $24
      expect(params[23]).toBe(12345)
    })

    it('persiste todos os 5 UTMs', async () => {
      const dto = buildPageviewEvent({
        utm_source: 'google',
        utm_medium: 'cpc',
        utm_campaign: 'promo',
        utm_content: 'ad1',
        utm_term: 'marketing',
      })
      await service.collectEvent(dto, SUBDOMAIN)

      const params = (prisma.$queryRawUnsafe as jest.Mock).mock.calls[0].slice(1)
      // utm_source=$34, utm_medium=$35, utm_campaign=$36, utm_content=$37, utm_term=$38
      expect(params[33]).toBe('google')
      expect(params[34]).toBe('cpc')
      expect(params[35]).toBe('promo')
      expect(params[36]).toBe('ad1')
      expect(params[37]).toBe('marketing')
    })

    it('persiste FBC/FBCLID/FBP (Meta CAPI)', async () => {
      const dto = buildPageviewEvent({
        fbc: 'fb.1.1234.abc',
        fbclid: 'abc123',
        fbp: 'fb.1.5678.xyz',
      })
      await service.collectEvent(dto, SUBDOMAIN)

      const params = (prisma.$queryRawUnsafe as jest.Mock).mock.calls[0].slice(1)
      // fbc=$31, fbclid=$32, fbp=$33
      expect(params[30]).toBe('fb.1.1234.abc')
      expect(params[31]).toBe('abc123')
      expect(params[32]).toBe('fb.1.5678.xyz')
    })

    it('form_data JSON válido é armazenado', async () => {
      const formData = { nome: 'João', email: 'a@b.com' }
      const dto = buildFormSubmitEvent({ form_data: JSON.stringify(formData) })
      await service.collectEvent(dto, SUBDOMAIN)

      const params = (prisma.$queryRawUnsafe as jest.Mock).mock.calls[0].slice(1)
      // form_data = $30
      expect(params[29]).toBe(JSON.stringify(formData))
    })

    it('form_data JSON inválido → null', async () => {
      const dto = buildFormSubmitEvent({ form_data: 'not-valid-json{{{' })
      await service.collectEvent(dto, SUBDOMAIN)

      const params = (prisma.$queryRawUnsafe as jest.Mock).mock.calls[0].slice(1)
      expect(params[29]).toBeNull()
    })

    it('form_data > 10000 chars é truncado', async () => {
      const huge = JSON.stringify({ blob: 'x'.repeat(20000) })
      const dto = buildFormSubmitEvent({ form_data: huge })
      await service.collectEvent(dto, SUBDOMAIN)

      const params = (prisma.$queryRawUnsafe as jest.Mock).mock.calls[0].slice(1)
      expect((params[29] as string).length).toBeLessThanOrEqual(10000)
    })

    it('IP (server_ip) passa para o INSERT como inet', async () => {
      const dto = buildPageviewEvent({ server_ip: '192.168.1.1' })
      await service.collectEvent(dto, SUBDOMAIN)

      const params = (prisma.$queryRawUnsafe as jest.Mock).mock.calls[0].slice(1)
      // ip é o 40º parâmetro (index 39) — ordem: ...ua, ip, client_ts
      expect(params[39]).toBe('192.168.1.1')
    })

    it('ua é persistido', async () => {
      const dto = buildPageviewEvent({ ua: 'Mozilla/5.0 TestAgent' })
      await service.collectEvent(dto, SUBDOMAIN)

      const params = (prisma.$queryRawUnsafe as jest.Mock).mock.calls[0].slice(1)
      // ua é o 39º parâmetro (index 38)
      expect(params[38]).toBe('Mozilla/5.0 TestAgent')
    })

    it('timestamp do cliente é usado quando fornecido', async () => {
      const clientTs = '2026-04-18T10:00:00.000Z'
      const dto = buildPageviewEvent({ timestamp: clientTs })
      await service.collectEvent(dto, SUBDOMAIN)

      const params = (prisma.$queryRawUnsafe as jest.Mock).mock.calls[0].slice(1)
      // client_ts é o 41º parâmetro (index 40)
      expect(params[40]).toBe(clientTs)
    })

    it('timestamp ausente → usa new Date().toISOString()', async () => {
      const dto = buildPageviewEvent({ timestamp: undefined })
      await service.collectEvent(dto, SUBDOMAIN)

      const params = (prisma.$queryRawUnsafe as jest.Mock).mock.calls[0].slice(1)
      expect(params[40]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
    })

    it('button_text muito longo é truncado em 150 chars', async () => {
      const longText = 'x'.repeat(300)
      const dto = buildClickEvent({ button_text: longText })
      await service.collectEvent(dto, SUBDOMAIN)

      const params = (prisma.$queryRawUnsafe as jest.Mock).mock.calls[0].slice(1)
      // button_text = $10
      expect((params[9] as string).length).toBe(150)
    })
  })

  // ============================================================
  // 3) Identity stitching (visitor_identities)
  // ============================================================

  describe('identity stitching', () => {
    it('form_submit com email válido: INSERT em visitor_identities', async () => {
      const dto = buildFormSubmitEvent({
        form_email: 'lead@example.com',
        form_nome: 'Maria',
        form_telefone: '11988887777',
      })
      await service.collectEvent(dto, SUBDOMAIN)

      // Chamadas: [0] tracking_events, [1] visitor_identities
      expect(prisma.$queryRawUnsafe).toHaveBeenCalledTimes(2)
      const [sql] = (prisma.$queryRawUnsafe as jest.Mock).mock.calls[1]
      expect(sql).toContain('INSERT INTO visitor_identities')
      expect(sql).toContain('ON CONFLICT')
    })

    it('form_submit sem email: NÃO faz identity stitching', async () => {
      const dto = buildFormSubmitEvent({ form_email: undefined })
      await service.collectEvent(dto, SUBDOMAIN)

      expect(prisma.$queryRawUnsafe).toHaveBeenCalledTimes(1) // só tracking_events
    })

    it('form_submit com email inválido: NÃO faz identity stitching', async () => {
      const dto = buildFormSubmitEvent({ form_email: 'not-an-email' })
      await service.collectEvent(dto, SUBDOMAIN)

      expect(prisma.$queryRawUnsafe).toHaveBeenCalledTimes(1)
    })

    it('pageview com email: NÃO faz identity stitching (apenas form_submit)', async () => {
      const dto = buildPageviewEvent({ form_email: 'lead@example.com' })
      await service.collectEvent(dto, SUBDOMAIN)

      expect(prisma.$queryRawUnsafe).toHaveBeenCalledTimes(1)
    })
  })

  // ============================================================
  // 4) Backward-compat: Tracking legacy + Lead
  // ============================================================

  describe('backward-compat (Tracking legacy + Lead)', () => {
    const campaign = {
      campaignId: CAMPAIGN_ID,
      companyId: COMPANY_ID,
      columnSetId: 'colset-1',
      name: 'Campanha Teste',
    }

    beforeEach(() => {
      ;(prisma.client.companies.findFirst as any).mockResolvedValue({
        id: COMPANY_ID,
        subdomain: SUBDOMAIN,
      })
      ;(prisma.campaigns.findFirst as any).mockResolvedValue(campaign)
      ;(prisma.leads.findFirst as any).mockResolvedValue(null) // lead não existe
      ;(prisma.tracking.create as any).mockResolvedValue({ id: 1 })
    })

    it('form_submit + campaign existente: cria Tracking + Lead + emite evento', async () => {
      const dto = buildFormSubmitEvent({
        campaign_id: CAMPAIGN_ID,
        form_email: 'lead@example.com',
        form_nome: 'Lead Test',
        form_telefone: '11999998888',
      })

      await service.collectEvent(dto, SUBDOMAIN)

      expect(prisma.tracking.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            email: 'lead@example.com',
            campaignId: CAMPAIGN_ID,
            companyId: COMPANY_ID,
            action: 'OPTIN',
          }),
        }),
      )

      expect(eventService.emitTrackingEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          companyId: COMPANY_ID,
          campaignId: CAMPAIGN_ID,
          email: 'lead@example.com',
          action: 'OPTIN',
        }),
      )

      expect(leadService.findOrCreateLeadFromTracking).toHaveBeenCalledWith(
        'lead@example.com',
        campaign,
        expect.any(String),
        expect.objectContaining({}),
        expect.objectContaining({
          userAgent: 'Mozilla/5.0 (Test)',
          sourceUrl: 'https://test-client.hdmfy.com/',
        }),
        'Lead Test',
      )
    })

    /**
     * O bug real: `form_nome` chegava no payload do optin (linha acima já prova
     * isso — o mesmo dto alimenta o `Tracking.create` com o nome certo), mas
     * `findOrCreateLeadFromTracking` nunca recebia esse valor. O `Leads.create`
     * hardcoded `name: ''`, e como nada mais reconsulta esse campo depois, o
     * evento de trigger/Meta CAPI saía pra sempre só com e-mail — mesmo quando o
     * visitante já tinha digitado o nome nessa mesma submissão.
     */
    it('nome do formulário vai para o Lead (não só para a tabela Tracking legada)', async () => {
      const dto = buildFormSubmitEvent({
        campaign_id: CAMPAIGN_ID,
        form_email: 'lead@example.com',
        form_nome: 'Ana Silva',
        form_telefone: '11999998888',
      })

      await service.collectEvent(dto, SUBDOMAIN)

      const nameArg = leadService.findOrCreateLeadFromTracking.mock.calls[0][5]
      expect(nameArg).toBe('Ana Silva')
    })

    it('o que o navegador mandou vai junto para o lead — e ANTES do emit', async () => {
      // `fbc`/`fbp`/`fbclid` são cookies e query da landing: ninguém consegue
      // obtê-los depois. Morriam aqui, e por isso `fbc` ficou em 0% nos 2.170
      // eventos Meta já enviados, com o `fbclid` presente em 95% dos leads.
      const dto = buildFormSubmitEvent({
        campaign_id: CAMPAIGN_ID,
        form_email: 'lead@example.com',
        fbc: 'fb.1.1700000000.abc123',
        fbp: 'fb.1.1699999999.987654321',
        fbclid: 'abc123',
      })

      await service.collectEvent(dto as any, SUBDOMAIN)

      const [, , , , browser] = leadService.findOrCreateLeadFromTracking.mock.calls[0]
      expect(browser).toEqual({
        fbc: 'fb.1.1700000000.abc123',
        fbp: 'fb.1.1699999999.987654321',
        fbclid: 'abc123',
        userAgent: 'Mozilla/5.0 (Test)',
        sourceUrl: 'https://test-client.hdmfy.com/',
        leadIp: null,
      })

      // A ordem importa: o emit monta o payload LENDO o lead, então enriquecer
      // depois deixaria o OPTIN — o evento mais valioso — sair cego.
      const leadOrder = leadService.findOrCreateLeadFromTracking.mock.invocationCallOrder[0]
      const emitOrder = eventService.emitTrackingEvent.mock.invocationCallOrder[0]
      expect(leadOrder).toBeLessThan(emitOrder)
    })

    it('OPTIN recente: NÃO cria Tracking duplicado, mas delega criação de Lead idempotente', async () => {
      authService.hasRecentOptin.mockResolvedValue(true)

      const dto = buildFormSubmitEvent({
        campaign_id: CAMPAIGN_ID,
        form_email: 'lead@example.com',
      })

      await service.collectEvent(dto, SUBDOMAIN)

      expect(prisma.tracking.create).not.toHaveBeenCalled()
      expect(eventService.emitTrackingEvent).not.toHaveBeenCalled()
      // findOrCreateLeadFromTracking encapsula dedup; é sempre chamado
      expect(leadService.findOrCreateLeadFromTracking).toHaveBeenCalledTimes(1)
    })

    it('delegação a findOrCreateLeadFromTracking acontece mesmo com lead pré-existente', async () => {
      // Dedup de lead duplicado é responsabilidade interna do findOrCreateLeadFromTracking
      // (Redis lock + P2002 catch). O collect apenas delega.
      const dto = buildFormSubmitEvent({
        campaign_id: CAMPAIGN_ID,
        form_email: 'lead@example.com',
      })

      await service.collectEvent(dto, SUBDOMAIN)

      expect(leadService.findOrCreateLeadFromTracking).toHaveBeenCalledTimes(1)
      expect(prisma.tracking.create).toHaveBeenCalled()
    })

    it('company não encontrada pelo subdomain: NÃO cria Tracking nem Lead', async () => {
      ;(prisma.client.companies.findFirst as any).mockResolvedValue(null)

      const dto = buildFormSubmitEvent({
        campaign_id: CAMPAIGN_ID,
        form_email: 'lead@example.com',
      })

      await service.collectEvent(dto, SUBDOMAIN)

      expect(prisma.tracking.create).not.toHaveBeenCalled()
      expect(leadService.findOrCreateLeadFromTracking).not.toHaveBeenCalled()
      // mas visitor_identities ainda é atualizado
      expect(prisma.$queryRawUnsafe).toHaveBeenCalledTimes(2)
    })

    it('campaign não encontrada: NÃO cria Tracking nem Lead', async () => {
      ;(prisma.campaigns.findFirst as any).mockResolvedValue(null)

      const dto = buildFormSubmitEvent({
        campaign_id: CAMPAIGN_ID,
        form_email: 'lead@example.com',
      })

      await service.collectEvent(dto, SUBDOMAIN)

      expect(prisma.tracking.create).not.toHaveBeenCalled()
      expect(leadService.findOrCreateLeadFromTracking).not.toHaveBeenCalled()
    })

    it('form_submit sem campaign_id: NÃO tenta criar Tracking', async () => {
      const dto = buildFormSubmitEvent({
        campaign_id: undefined,
        form_email: 'lead@example.com',
      })

      await service.collectEvent(dto, SUBDOMAIN)

      expect(prisma.campaigns.findFirst).not.toHaveBeenCalled()
      expect(prisma.tracking.create).not.toHaveBeenCalled()
    })

    it('erro no fluxo backward-compat NÃO propaga — é logado', async () => {
      ;(prisma.campaigns.findFirst as any).mockRejectedValue(new Error('DB down'))

      const dto = buildFormSubmitEvent({
        campaign_id: CAMPAIGN_ID,
        form_email: 'lead@example.com',
      })

      // Não deve lançar
      await expect(service.collectEvent(dto, SUBDOMAIN)).resolves.toEqual({ ok: true })
    })
  })

  // ============================================================
  // 5) Retorno
  // ============================================================

  describe('retorno', () => {
    it('retorna { ok: true } em sucesso', async () => {
      const dto = buildPageviewEvent()
      const result = await service.collectEvent(dto, SUBDOMAIN)
      expect(result).toEqual({ ok: true })
    })
  })
})
