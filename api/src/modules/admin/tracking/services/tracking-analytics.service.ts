import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from 'src/database/prisma.service'
import { FilterTrackingActionsDto } from '../dto/filter-tracking-actions.dto'
import { FilterTrackingEventsDto } from '../dto/filter-tracking-events.dto'

interface TrackingEventRow {
  id: string
  client_hash: string
  campaign_id: string | null
  form_config_id: string | null
  visitor_id: string
  session_id: string
  event: string
  page: string | null
  url: string | null
  referrer: string | null
  button_text: string | null
  button_tag: string | null
  button_href: string | null
  button_id: string | null
  button_classes: string | null
  button_track: string | null
  click_x: number | null
  click_y: number | null
  page_x: number | null
  page_y: number | null
  viewport_w: number | null
  viewport_h: number | null
  scroll_y: number | null
  scroll_pct: number | null
  time_on_page_ms: number | null
  form_nome: string | null
  form_email: string | null
  form_telefone: string | null
  form_id: string | null
  form_action: string | null
  form_data: unknown | null
  fbc: string | null
  fbclid: string | null
  fbp: string | null
  utm_source: string | null
  utm_medium: string | null
  utm_campaign: string | null
  utm_content: string | null
  utm_term: string | null
  ua: string | null
  ip: string | null
  client_ts: Date | null
  created_at: Date
  identified_email: string | null
  identified_name: string | null
}

export interface VisitorIdentityRow {
  visitor_id: string
  email: string
  nome: string | null
  telefone: string | null
  fbc: string | null
  fbp: string | null
  campaign_id: string | null
  form_config_id: string | null
  created_at: Date
  updated_at: Date
}

// Backstop de tempo p/ as queries raw de tracking_events (base grande em contas
// como maclo). Acima disso a consulta e abortada e cai no fallback "degraded".
const TRACKING_QUERY_TIMEOUT_MS = 12000
// Teto do COUNT: paramos de contar apos isso (UI mostra "10.000+"). Evita contar
// milhoes de linhas no COUNT(*) da visao padrao (7 dias) em contas grandes.
const TRACKING_COUNT_CAP = 10000

@Injectable()
export class TrackingAnalyticsService {
  private readonly logger = new Logger(TrackingAnalyticsService.name)
  private readonly clientHashCache = new Map<string, { value: string; expiresAt: number }>()
  private readonly CACHE_TTL_MS = 5 * 60 * 1000

  constructor(private prisma: PrismaService) {}

  private async resolveClientHash(companyId: string): Promise<string> {
    const cached = this.clientHashCache.get(companyId)
    if (cached && cached.expiresAt > Date.now()) return cached.value

    const company = await this.prisma.companies.findUnique({
      where: { id: companyId },
      select: { subdomain: true },
    })

    if (!company?.subdomain) {
      throw new HttpException('Empresa sem subdomain configurado', HttpStatus.BAD_REQUEST)
    }

    const clientHash = company.subdomain.toLowerCase()
    this.clientHashCache.set(companyId, {
      value: clientHash,
      expiresAt: Date.now() + this.CACHE_TTL_MS,
    })
    return clientHash
  }

  /**
   * Corre a query contra um timeout (Promise.race). Backstop em nivel de app:
   * garante que o request responde rapido (cai no catch do chamador) em vez de
   * ficar pendurado ate o edge resetar a conexao (sintoma "Network Error").
   * Obs.: nao cancela a query no Postgres — por isso o ganho real vem dos
   * indices + COUNT capado; este e apenas a rede de seguranca.
   */
  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`tracking query timeout (${label}, ${timeoutMs}ms)`)),
        timeoutMs,
      )
    })
    try {
      return await Promise.race([promise, timeout])
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  private buildWhereClause(
    clientHash: string,
    filters: FilterTrackingEventsDto,
  ): { where: string; params: unknown[] } {
    const params: unknown[] = [clientHash]
    const conditions: string[] = ['te.client_hash = $1']

    const push = (clause: (idx: number) => string, value: unknown) => {
      params.push(value)
      conditions.push(clause(params.length))
    }

    if (filters.startDate) {
      push((i) => `te.created_at >= $${i}::timestamptz`, filters.startDate)
    }
    if (filters.endDate) {
      push((i) => `te.created_at <= $${i}::timestamptz`, filters.endDate)
    }
    if (filters.events && filters.events.length > 0) {
      push((i) => `te.event = ANY($${i}::text[])`, filters.events)
    }
    if (filters.campaignIds && filters.campaignIds.length > 0) {
      push((i) => `te.campaign_id = ANY($${i}::text[])`, filters.campaignIds)
    }
    if (filters.urlSearch) {
      const pattern = `%${filters.urlSearch}%`
      push((i) => `(te.page ILIKE $${i} OR te.url ILIKE $${i})`, pattern)
    }
    if (filters.utmSource) {
      push((i) => `te.utm_source = $${i}`, filters.utmSource)
    }
    if (filters.utmMedium) {
      push((i) => `te.utm_medium = $${i}`, filters.utmMedium)
    }
    if (filters.utmCampaign) {
      push((i) => `te.utm_campaign = $${i}`, filters.utmCampaign)
    }
    if (filters.visitorId) {
      push((i) => `te.visitor_id = $${i}::uuid`, filters.visitorId)
    }
    if (filters.sessionId) {
      push((i) => `te.session_id = $${i}::uuid`, filters.sessionId)
    }
    if (filters.formEmail) {
      push((i) => `te.form_email ILIKE $${i}`, `%${filters.formEmail}%`)
    }
    if (filters.identifiedOnly) {
      conditions.push(
        `EXISTS (SELECT 1 FROM visitor_identities vi2
          WHERE vi2.client_hash = te.client_hash AND vi2.visitor_id = te.visitor_id)`,
      )
    }

    return { where: conditions.join(' AND '), params }
  }

  async filterTrackingEvents(companyId: string, filters: FilterTrackingEventsDto) {
    const clientHash = await this.resolveClientHash(companyId)
    const page = filters.page ?? 1
    const limit = filters.limit ?? 25
    const offset = (page - 1) * limit

    const { where, params } = this.buildWhereClause(clientHash, filters)

    try {
      const dataParams = [...params, limit, offset]
      const limitIdx = dataParams.length - 1
      const offsetIdx = dataParams.length

      // Pagina (servida por idx_te_client_created) + COUNT *capado* (LIMIT no
      // subselect, evita contar milhoes de linhas) rodam em paralelo com backstop
      // de tempo. Se travar (ex.: ILIKE %x% sem indice em base grande), aborta e
      // cai no catch -> resposta vazia "degraded" (200 com CORS), nunca "Network Error".
      const [rows, totalRows] = await this.withTimeout(
        Promise.all([
          this.prisma.$queryRawUnsafe<TrackingEventRow[]>(
            `SELECT te.*, vi.email AS identified_email, vi.nome AS identified_name
       FROM tracking_events te
       LEFT JOIN visitor_identities vi
         ON vi.client_hash = te.client_hash AND vi.visitor_id = te.visitor_id
       WHERE ${where}
       ORDER BY te.created_at DESC
       LIMIT $${limitIdx}::int OFFSET $${offsetIdx}::int`,
            ...dataParams,
          ),
          this.prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
            `SELECT COUNT(*)::bigint AS count
       FROM (SELECT 1 FROM tracking_events te WHERE ${where} LIMIT ${TRACKING_COUNT_CAP + 1}) s`,
            ...params,
          ),
        ]),
        TRACKING_QUERY_TIMEOUT_MS,
        'filterTrackingEvents',
      )

      const rawCount = Number(totalRows[0]?.count ?? 0)
      const capped = rawCount > TRACKING_COUNT_CAP
      const total = capped ? TRACKING_COUNT_CAP : rawCount

      const campaignIdsInPage = Array.from(
        new Set(rows.map((r) => r.campaign_id).filter((id): id is string => Boolean(id))),
      )

      const campaignNameMap = new Map<string, string>()
      if (campaignIdsInPage.length > 0) {
        const campaigns = await this.prisma.campaigns.findMany({
          where: { campaignId: { in: campaignIdsInPage }, companyId },
          select: { campaignId: true, name: true },
        })
        for (const c of campaigns) {
          campaignNameMap.set(c.campaignId, c.name ?? '')
        }
      }

      const data = rows.map((row) => ({
        id: String(row.id),
        createdAt: row.created_at,
        clientTs: row.client_ts,
        event: row.event,
        page: row.page,
        url: row.url,
        referrer: row.referrer,
        visitorId: row.visitor_id,
        sessionId: row.session_id,
        campaignId: row.campaign_id,
        campaignName: row.campaign_id ? (campaignNameMap.get(row.campaign_id) ?? null) : null,
        formConfigId: row.form_config_id,
        identifiedEmail: row.identified_email,
        identifiedName: row.identified_name,
        formNome: row.form_nome,
        formEmail: row.form_email,
        formTelefone: row.form_telefone,
        formId: row.form_id,
        formAction: row.form_action,
        formData: row.form_data,
        buttonText: row.button_text,
        buttonTag: row.button_tag,
        buttonHref: row.button_href,
        buttonId: row.button_id,
        buttonClasses: row.button_classes,
        buttonTrack: row.button_track,
        clickX: row.click_x,
        clickY: row.click_y,
        pageX: row.page_x,
        pageY: row.page_y,
        viewportW: row.viewport_w,
        viewportH: row.viewport_h,
        scrollY: row.scroll_y,
        scrollPct: row.scroll_pct,
        timeOnPageMs: row.time_on_page_ms,
        utmSource: row.utm_source,
        utmMedium: row.utm_medium,
        utmCampaign: row.utm_campaign,
        utmContent: row.utm_content,
        utmTerm: row.utm_term,
        fbc: row.fbc,
        fbclid: row.fbclid,
        fbp: row.fbp,
        ua: row.ua,
        ip: row.ip,
      }))

      return {
        data,
        total,
        page,
        limit,
        totalPages: Math.max(1, Math.ceil(total / limit)),
        capped,
      }
    } catch (err) {
      // Qualquer falha (timeout, abort do PG, etc.) vira resposta vazia degradada
      // — 200 com headers CORS. Impede o "Network Error" no front independente da causa.
      this.logger.error(
        `filterTrackingEvents degraded (company=${companyId}): ${(err as Error)?.message}`,
      )
      return { data: [], total: 0, page, limit, totalPages: 1, degraded: true }
    }
  }

  async getVisitorTimeline(companyId: string, visitorId: string) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(visitorId)) {
      throw new HttpException('visitorId invalido', HttpStatus.BAD_REQUEST)
    }

    const clientHash = await this.resolveClientHash(companyId)

    const identities = await this.prisma.$queryRawUnsafe<VisitorIdentityRow[]>(
      `SELECT visitor_id, email, nome, telefone, fbc, fbp, campaign_id, form_config_id, created_at, updated_at
       FROM visitor_identities
       WHERE client_hash = $1 AND visitor_id = $2::uuid
       ORDER BY updated_at DESC
       LIMIT 5`,
      clientHash,
      visitorId,
    )

    const events = await this.prisma.$queryRawUnsafe<TrackingEventRow[]>(
      `SELECT te.*, NULL::text AS identified_email, NULL::text AS identified_name
       FROM tracking_events te
       WHERE te.client_hash = $1 AND te.visitor_id = $2::uuid
       ORDER BY te.created_at ASC
       LIMIT 2000`,
      clientHash,
      visitorId,
    )

    return {
      visitorId,
      identity: identities[0] ?? null,
      identities,
      events: events.map((row) => ({
        id: String(row.id),
        createdAt: row.created_at,
        clientTs: row.client_ts,
        event: row.event,
        page: row.page,
        url: row.url,
        referrer: row.referrer,
        sessionId: row.session_id,
        campaignId: row.campaign_id,
        formConfigId: row.form_config_id,
        formNome: row.form_nome,
        formEmail: row.form_email,
        formTelefone: row.form_telefone,
        buttonText: row.button_text,
        buttonHref: row.button_href,
        buttonTrack: row.button_track,
        scrollPct: row.scroll_pct,
        timeOnPageMs: row.time_on_page_ms,
        utmSource: row.utm_source,
        utmMedium: row.utm_medium,
        utmCampaign: row.utm_campaign,
        utmContent: row.utm_content,
        utmTerm: row.utm_term,
        fbc: row.fbc,
        fbp: row.fbp,
        ua: row.ua,
        ip: row.ip,
      })),
    }
  }

  async getTrackingFilterOptions(companyId: string) {
    // Valida empresa (resolveClientHash lanca se subdomain ausente). Cache amortiza custo.
    await this.resolveClientHash(companyId)

    // Eventos vem de Tracking.action distinct da empresa (legacy table).
    // Filtro real continua em tracking_events.event — mismatch e esperado e visivel ao usuario.
    const actionRows = await this.prisma.tracking.findMany({
      where: { companyId },
      distinct: ['action'],
      select: { action: true },
      orderBy: { action: 'asc' },
    })

    const events = actionRows
      .map((r) => r.action)
      .filter((a): a is string => typeof a === 'string' && a.trim().length > 0)

    // Todas as campanhas da empresa (nao apenas as que tem eventos).
    const campaignsRaw = await this.prisma.campaigns.findMany({
      where: { companyId },
      select: { campaignId: true, name: true },
      orderBy: { name: 'asc' },
    })

    const campaigns = campaignsRaw.map((c) => ({
      id: c.campaignId,
      name: c.name ?? c.campaignId,
    }))

    return { events, campaigns }
  }

  async filterTrackingActions(companyId: string, filters: FilterTrackingActionsDto) {
    const page = filters.page ?? 1
    const limit = filters.limit ?? 25
    const skip = (page - 1) * limit

    const where: Prisma.TrackingWhereInput = { companyId }

    let dateRange: { gte?: Date; lte?: Date } | undefined
    if (filters.startDate || filters.endDate) {
      dateRange = {}
      if (filters.startDate) dateRange.gte = new Date(filters.startDate)
      if (filters.endDate) dateRange.lte = new Date(filters.endDate)
      where.timestamp = dateRange
    }

    if (filters.actions && filters.actions.length > 0) {
      // Lead-centric: identificar leads (email/phone) que fizeram alguma das acoes
      // no escopo (companyId + dateRange), depois retornar TODOS os eventos desses
      // leads no mesmo escopo. Outros filtros continuam event-centric.
      const identityScope: Prisma.TrackingWhereInput = {
        companyId,
        OR: filters.actions.map((action) => ({
          action: { equals: action, mode: 'insensitive' as const },
        })),
      }
      if (dateRange) identityScope.timestamp = dateRange

      const identities = await this.prisma.tracking.findMany({
        where: identityScope,
        select: { email: true, phone: true },
        distinct: ['email', 'phone'],
      })

      const emails = Array.from(
        new Set(
          identities
            .map((i) => i.email)
            .filter((e): e is string => typeof e === 'string' && e.trim() !== ''),
        ),
      )
      const phones = Array.from(
        new Set(
          identities
            .map((i) => i.phone)
            .filter((p): p is string => typeof p === 'string' && p.trim() !== ''),
        ),
      )

      if (emails.length === 0 && phones.length === 0) {
        return { data: [], total: 0, page, limit, totalPages: 0 }
      }

      const identityOr: Prisma.TrackingWhereInput[] = []
      if (emails.length > 0) identityOr.push({ email: { in: emails } })
      if (phones.length > 0) identityOr.push({ phone: { in: phones } })

      const existingAnd = where.AND
        ? Array.isArray(where.AND)
          ? where.AND
          : [where.AND]
        : []
      where.AND = [...existingAnd, { OR: identityOr }]
    }

    if (filters.campaignIds && filters.campaignIds.length > 0) {
      where.campaignId = { in: filters.campaignIds }
    }

    if (filters.email) {
      where.email = { contains: filters.email, mode: 'insensitive' }
    }

    if (filters.name) {
      where.name = { contains: filters.name, mode: 'insensitive' }
    }

    if (filters.phone) {
      where.phone = { contains: filters.phone, mode: 'insensitive' }
    }

    if (filters.urlSearch) {
      where.url = { contains: filters.urlSearch, mode: 'insensitive' }
    }

    if (filters.tag) {
      where.tag = { contains: filters.tag, mode: 'insensitive' }
    }

    if (filters.utmSource) where.utm_source = filters.utmSource
    if (filters.utmMedium) where.utm_medium = filters.utmMedium
    if (filters.utmCampaign) where.utm_campaign = filters.utmCampaign
    if (filters.utmTerm) where.utm_term = filters.utmTerm
    if (filters.utmContent) where.utm_content = filters.utmContent
    if (filters.adId) where.ad_id = filters.adId
    if (filters.adsetId) where.adset_id = filters.adsetId
    if (filters.formId) where.form_id = filters.formId

    if (filters.hasEmail === true) {
      const existing = where.AND ? (Array.isArray(where.AND) ? where.AND : [where.AND]) : []
      where.AND = [
        ...existing,
        { email: { not: null } },
        { email: { not: '' } },
      ]
    }

    const [rows, total] = await Promise.all([
      this.prisma.tracking.findMany({
        where,
        include: { campaign: { select: { name: true } } },
        orderBy: { timestamp: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.tracking.count({ where }),
    ])

    const data = rows.map((row) => ({
      id: row.id,
      timestamp: row.timestamp,
      action: row.action,
      email: row.email,
      name: row.name,
      phone: row.phone,
      url: row.url,
      referral: row.referral,
      ip: row.ip,
      device: row.device,
      sessionId: row.sessionId,
      campaignId: row.campaignId,
      campaignName: row.campaign?.name ?? null,
      tag: row.tag,
      trackingTitle: row.trackingTitle,
      trackingIconUrl: row.trackingIconUrl,
      trackingObs: row.trackingObs,
      utms: row.utms,
      utm_source: row.utm_source,
      utm_medium: row.utm_medium,
      utm_campaign: row.utm_campaign,
      utm_content: row.utm_content,
      utm_term: row.utm_term,
      utm_var1: row.utm_var1,
      fbc: row.fbc,
      gclid: row.gclid,
      adId: row.ad_id,
      adName: row.ad_name,
      adsetId: row.adset_id,
      adsetName: row.adset_name,
      pageId: row.page_id,
      pageName: row.page_name,
      formId: row.form_id,
      formName: row.form_name,
    }))

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    }
  }

  async getTrackingActionsFilterOptions(companyId: string) {
    const [actionRows, campaignsRaw] = await Promise.all([
      this.prisma.tracking.findMany({
        where: { companyId },
        distinct: ['action'],
        select: { action: true },
        orderBy: { action: 'asc' },
      }),
      this.prisma.campaigns.findMany({
        where: { companyId },
        select: { campaignId: true, name: true },
        orderBy: { name: 'asc' },
      }),
    ])

    // Normalizar para lowercase e deduplicar (OPTIN/optin viram 'optin').
    const actionSet = new Set<string>()
    for (const r of actionRows) {
      const a = r.action
      if (typeof a !== 'string') continue
      const trimmed = a.trim()
      if (!trimmed) continue
      actionSet.add(trimmed.toLowerCase())
    }
    const actions = Array.from(actionSet).sort()

    const campaigns = campaignsRaw.map((c) => ({
      id: c.campaignId,
      name: c.name ?? c.campaignId,
    }))

    return { actions, campaigns }
  }

  /**
   * Acoes distintas da empresa COM volume e data do ultimo evento.
   *
   * Existe porque a lista distinta sozinha nao diz o que importa. Na digienge,
   * 8 acoes concentram 98% dos eventos (`optin` tem 3.059) e o resto e residuo
   * de teste de 2025 (`acceced`, 1 evento, typo de "accessed"). Em ordem
   * alfabetica o residuo aparece primeiro e `optin` cai na 28a linha.
   *
   * Custo medido: 53ms nessa empresa, 85ms na maior do banco (158k linhas) —
   * o GROUP BY e coberto pelo @@index([companyId, action]).
   *
   * Cliente BASE (`this.prisma.tracking`), nunca `this.prisma.client.tracking`:
   * `Tracking` nao tem `deleted_at` e a extension de soft delete geraria
   * `WHERE deleted_at IS NULL` contra uma coluna que nao existe.
   */
  async getTrackingActionUsage(
    companyId: string,
  ): Promise<{ action: string; eventCount: number; lastSeenAt: Date | null }[]> {
    const rows = await this.prisma.tracking.groupBy({
      by: ['action'],
      where: { companyId },
      _count: { _all: true },
      _max: { timestamp: true },
    })

    // O groupBy nao aceita `lower(action)`, entao `OPTIN` e `optin` voltam como
    // linhas separadas. SOMAR as contagens: ficar com uma e descartar a outra
    // reportaria metade dos eventos da acao mais usada da empresa.
    const merged = new Map<string, { eventCount: number; lastSeenAt: Date | null }>()

    for (const row of rows) {
      if (typeof row.action !== 'string') continue
      const key = row.action.trim().toLowerCase()
      if (!key) continue

      const current = merged.get(key)
      const lastSeenAt = row._max.timestamp ?? null
      if (!current) {
        merged.set(key, { eventCount: row._count._all, lastSeenAt })
        continue
      }

      current.eventCount += row._count._all
      if (lastSeenAt && (!current.lastSeenAt || lastSeenAt > current.lastSeenAt)) {
        current.lastSeenAt = lastSeenAt
      }
    }

    return Array.from(merged, ([action, usage]) => ({ action, ...usage })).sort(
      (a, b) => b.eventCount - a.eventCount || a.action.localeCompare(b.action),
    )
  }
}
