import { Logger } from '@nestjs/common'
import { PrismaService } from 'src/database/prisma.service'
import { getMetaAuthError } from 'src/shared/util/meta-auth-error.utils'
import { MetaAdsMapper } from '../mappers/meta-ads.mapper'
import { MetaVideoSourceService } from '../services/meta-video-source.service'
import { SyncResult, TimeInterval, UniqueItem, Level } from '../interfaces/meta-ads.interfaces'
import {
  META_API_BASE,
  META_API_VERSION,
  THUMBNAIL_KEY_SUFFIX,
  THUMBNAIL_STORAGE_PREFIX,
  THUMBNAIL_TARGET_PX,
  THUMBNAIL_ACCEPTABLE_PX,
  ENRICHMENT_SELF_HEAL_LIMIT,
} from '../constants/meta-ads.constants'

/**
 * Erro da Graph API com o objeto de erro CRU preservado em `.error`.
 *
 * Antes o sync fazia `throw new Error(result.error.message)` e jogava fora `code` e
 * `error_subcode` — sem eles nao ha como distinguir token morto (190/460) de rate limit,
 * e o `getMetaAuthError` rio abaixo nao tinha o que reconhecer.
 *
 * A forma `{ error: {...} }` e uma das que o `getMetaAuthError` ja aceita
 * (`err?.response?.data?.error ?? err?.data?.error ?? err?.error`), entao o util
 * funciona sobre esta classe sem nenhuma mudanca.
 */
export class MetaGraphError extends Error {
  constructor(public readonly error: any) {
    super(error?.message || JSON.stringify(error))
    this.name = 'MetaGraphError'
  }
}

/** Um frame do no Video da Graph API (`thumbnails{uri,width,height,is_preferred}`). */
interface MetaVideoThumbnail {
  uri: string
  width: number
  height: number
  is_preferred?: boolean
}

/**
 * Maior frame disponivel de um no Video, ou null.
 *
 * Ordena por AREA, nao por largura: um frame 9:16 de 720x1280 tem mais pixel que um
 * 1280x720, e o criativo vertical e a norma no Meta hoje. `is_preferred` marca a capa
 * escolhida pelo anunciante, que costuma ser pequena — por isso e ignorado aqui.
 */
function pickLargestThumbnail(videoData: any): MetaVideoThumbnail | null {
  const list: MetaVideoThumbnail[] = videoData?.thumbnails?.data ?? []
  let best: MetaVideoThumbnail | null = null
  for (const t of list) {
    if (!t?.uri || !t.width || !t.height) continue
    if (!best || t.width * t.height > best.width * best.height) best = t
  }
  return best
}

// Chunk size for batch update transactions
const UPDATE_CHUNK_SIZE = 50

/**
 * Estrategia base para sincronizacao de dados do Meta ADS
 * Contem metodos comuns usados por todas as estrategias
 */
export abstract class BaseSyncStrategy {
  protected readonly logger: Logger
  protected readonly META_API_BASE = META_API_BASE
  protected readonly META_API_VERSION = META_API_VERSION

  constructor(
    protected readonly prisma: PrismaService,
    protected readonly mapper: MetaAdsMapper,
    protected readonly videoSource: MetaVideoSourceService,
    loggerContext: string
  ) {
    this.logger = new Logger(loggerContext)
  }

  /**
   * Metodo abstrato que deve ser implementado por cada estrategia
   */
  abstract sync(
    companyId: string,
    adAccountId: string,
    accessToken: string,
    datePreset: string,
    options?: any
  ): Promise<SyncResult>


  /**
   * URL sem o access_token, para log.
   *
   * Remove por NOME do parametro, nunca por valor. O `url.replace(accessToken, '***')` que
   * existia aqui falhava em silencio: `URLSearchParams.toString()` percent-encoda o valor,
   * entao um token com `:` (o formato do ciphertext, quando a ENCRYPTION_KEY nao abre o
   * dado) vira `a%3Ab%3Ac` na URL e o replace nao acha nada — a linha se anunciava como
   * "sem token" e imprimia o token inteiro. Token normal da Meta (`EAA…`) nao tem caractere
   * encodavel e era redigido, que e por que ninguem percebeu: o vazamento so disparava no
   * caso de falha.
   */
  protected redactToken(url: string): string {
    return url.replace(/([?&]access_token=)[^&]*/gi, '$1***TOKEN***')
  }

  /**
   * SQL de "esta thumbnail ainda pode melhorar" — FONTE UNICA para as tres escritas.
   *
   * O comentario que existia aqui avisava que a selecao e o UPDATE tinham que espelhar os
   * mesmos ramos, sob pena de o anuncio ser escolhido e o UPDATE nao achar o que escrever.
   * Manter isso a mao em tres lugares (selecao, gravacao do criativo, gravacao do frame de
   * video) e o que fez o terceiro divergir: faltavam nele os ramos de CDN da Meta, e como
   * `enrichThumbnails` roda antes e acabava de gravar uma URL fbcdn, o frame grande do no
   * Video — o melhor thumbnail que existe para criativo de video — era descartado sempre.
   *
   * O quarto ramo compara a largura MEDIDA que a chave do espelho carrega
   * (`{sha1}-1080.jpg`). Chave legada, sem carimbo, cai em 0 e volta para a fila.
   */
  protected thumbnailPodeMelhorarSql(coluna = 'thumbnail_url'): string {
    return `(
      ${coluna} IS NULL
      OR ${coluna} LIKE '%fbcdn.net%'
      OR ${coluna} LIKE '%cdninstagram.com%'
      OR (
        ${coluna} LIKE '%/${THUMBNAIL_STORAGE_PREFIX}/%'
        AND COALESCE(NULLIF(substring(${coluna} from '-([0-9]+)\.[a-z0-9]+$'), '')::int, 0) < ${THUMBNAIL_ACCEPTABLE_PX}
      )
    )`
  }

  /**
   * Relanca na hora se o erro for de AUTENTICACAO da Graph API (OAuthException 190/102 —
   * token revogado por troca de senha, app desautorizado, expirado).
   *
   * Chamar na PRIMEIRA linha de todo catch que engole erro. Token morto nao e falha
   * daquele chunk/pagina/anuncio: e condicao global que so se resolve com reconexao, e
   * insistir so queima chamada. Com o token da digienge revogado (31/08), o loop de
   * chunks fazia 105 x (GET + POST async) + 104s de sleep e devolvia `errors: 0`.
   *
   * Qualquer outro erro (rate limit, 5xx, payload invalido, timeout) passa reto e mantem
   * o comportamento tolerante de antes.
   */
  protected rethrowIfMetaAuthError(err: any): void {
    const authError = getMetaAuthError(err)
    if (!authError) return

    this.logger.error(
      `Token Meta invalido (code ${authError.code}` +
        `${authError.subcode != null ? `/${authError.subcode}` : ''}) — ` +
        `abortando o sync: ${authError.message}`
    )
    throw err
  }

  /**
   * Funcao auxiliar para fazer requisicao com retry
   */
  protected async fetchWithRetry(url: string, retries = 3, timeoutMs = 60000): Promise<any> {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

        const response = await fetch(url, { signal: controller.signal })
        clearTimeout(timeoutId)
        const result = await response.json()

        if (result.error) {
          this.logger.error(`Meta API Error: ${JSON.stringify(result.error)}`)

          // Erro 99 = timeout/muitos dados - tentar novamente com delay
          if ((result.error.error_subcode === 99 || result.error.code === 1) && attempt < retries) {
            this.logger.warn(`Erro 99 na tentativa ${attempt}, aguardando 5s antes de retry...`)
            await this.sleep(5000)
            continue
          }
          // MetaGraphError (nao Error) para preservar code/error_subcode ate o topo:
          // e o que permite reconhecer 190/460 e abortar em vez de varrer 105 chunks.
          throw new MetaGraphError(result.error)
        }

        return result
      } catch (error) {
        if (error.name === 'AbortError' && attempt < retries) {
          this.logger.warn(`Timeout na tentativa ${attempt}, aguardando 3s antes de retry...`)
          await this.sleep(3000)
          continue
        }
        throw error
      }
    }
  }

  /**
   * Busca todas as paginas de uma URL com paginacao
   */
  protected async fetchAllPages(baseUrl: string, delayBetweenPages = 300): Promise<any[]> {
    const allData: any[] = []
    let nextUrl: string | null = baseUrl
    let pageCount = 0

    while (nextUrl) {
      pageCount++
      this.logger.log(`  Buscando pagina ${pageCount}...`)

      const result = await this.fetchWithRetry(nextUrl)
      const pageData = result.data || []
      allData.push(...pageData)

      this.logger.log(`  Pagina ${pageCount}: ${pageData.length} registros (total: ${allData.length})`)

      nextUrl = result.paging?.next || null

      if (nextUrl) {
        await this.sleep(delayBetweenPages)
      }
    }

    return allData
  }

  /**
   * Converte date_preset para datas de inicio e fim
   */
  protected getDateRangeFromPreset(preset: string): { start: Date; end: Date } {
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const yesterday = new Date(today)
    yesterday.setDate(yesterday.getDate() - 1)

    switch (preset) {
      case 'today':
        return { start: today, end: today }
      case 'yesterday':
        return { start: yesterday, end: yesterday }
      case 'last_3d':
        const last3d = new Date(today)
        last3d.setDate(last3d.getDate() - 3)
        return { start: last3d, end: yesterday }
      case 'last_7d':
        const last7d = new Date(today)
        last7d.setDate(last7d.getDate() - 7)
        return { start: last7d, end: yesterday }
      case 'last_14d':
        const last14d = new Date(today)
        last14d.setDate(last14d.getDate() - 14)
        return { start: last14d, end: yesterday }
      case 'last_28d':
        const last28d = new Date(today)
        last28d.setDate(last28d.getDate() - 28)
        return { start: last28d, end: yesterday }
      case 'last_30d':
        const last30d = new Date(today)
        last30d.setDate(last30d.getDate() - 30)
        return { start: last30d, end: yesterday }
      case 'last_90d':
        const last90d = new Date(today)
        last90d.setDate(last90d.getDate() - 90)
        return { start: last90d, end: yesterday }
      case 'this_month':
        const thisMonthStart = new Date(today.getFullYear(), today.getMonth(), 1)
        return { start: thisMonthStart, end: today }
      case 'last_month':
        const lastMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1)
        const lastMonthEnd = new Date(today.getFullYear(), today.getMonth(), 0)
        return { start: lastMonthStart, end: lastMonthEnd }
      case 'last_week_mon_sun':
        const dayOfWeek = today.getDay()
        const daysToLastMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1
        const lastSunday = new Date(today)
        lastSunday.setDate(today.getDate() - daysToLastMonday - 1)
        const lastMonday = new Date(lastSunday)
        lastMonday.setDate(lastSunday.getDate() - 6)
        return { start: lastMonday, end: lastSunday }
      case 'this_week_mon_today':
        const thisDayOfWeek = today.getDay()
        const daysToMonday = thisDayOfWeek === 0 ? 6 : thisDayOfWeek - 1
        const thisMonday = new Date(today)
        thisMonday.setDate(today.getDate() - daysToMonday)
        return { start: thisMonday, end: today }
      case 'this_quarter':
        const quarter = Math.floor(today.getMonth() / 3)
        const quarterStart = new Date(today.getFullYear(), quarter * 3, 1)
        return { start: quarterStart, end: today }
      case 'this_year':
        const yearStart = new Date(today.getFullYear(), 0, 1)
        return { start: yearStart, end: today }
      case 'last_year':
        const lastYearStart = new Date(today.getFullYear() - 1, 0, 1)
        const lastYearEnd = new Date(today.getFullYear() - 1, 11, 31)
        return { start: lastYearStart, end: lastYearEnd }
      case 'maximum':
        const maxStart = new Date(today)
        maxStart.setFullYear(maxStart.getFullYear() - 2)
        return { start: maxStart, end: today }
      default:
        const defaultStart = new Date(today)
        defaultStart.setDate(defaultStart.getDate() - 7)
        return { start: defaultStart, end: yesterday }
    }
  }

  /**
   * Gera intervalos de tempo baseado na granularidade temporal
   */
  protected getTimeIntervalsForGranularity(
    start: Date,
    end: Date,
    timeIncrement?: string | number
  ): TimeInterval[] {
    const intervals: TimeInterval[] = []

    // Periodo completo (all_days ou nao especificado)
    if (!timeIncrement || timeIncrement === 'all_days') {
      return [{ start, end }]
    }

    // Mensal
    if (timeIncrement === 'monthly') {
      const current = new Date(start)
      while (current <= end) {
        const monthStart = new Date(current.getFullYear(), current.getMonth(), 1)
        const monthEnd = new Date(current.getFullYear(), current.getMonth() + 1, 0)

        const intervalStart = monthStart < start ? new Date(start) : monthStart
        const intervalEnd = monthEnd > end ? new Date(end) : monthEnd

        intervals.push({ start: intervalStart, end: intervalEnd })

        current.setMonth(current.getMonth() + 1)
        current.setDate(1)
      }
      return intervals
    }

    // Diario ou N dias
    const increment = Number(timeIncrement)
    if (isNaN(increment) || increment < 1) {
      return [{ start, end }]
    }

    const current = new Date(start)
    while (current <= end) {
      const intervalStart = new Date(current)
      const intervalEnd = new Date(current)
      intervalEnd.setDate(intervalEnd.getDate() + increment - 1)

      if (intervalEnd > end) {
        intervalEnd.setTime(end.getTime())
      }

      intervals.push({ start: intervalStart, end: intervalEnd })
      current.setDate(current.getDate() + increment)
    }

    return intervals
  }

  // ============================================================================
  // BATCH OPERATIONS
  // ============================================================================

  /**
   * Gera lookup key para um registro baseado no level
   */
  protected buildLookupKey(
    level: Level,
    companyId: string,
    startDate: Date,
    endDate: Date,
    ids: { adId?: string | null; adSetId?: string | null; externalCampaignId?: string | null; accountId?: string | null }
  ): string {
    const startStr = startDate.toISOString().split('T')[0]
    const endStr = endDate.toISOString().split('T')[0]

    switch (level) {
      case 'campaign':
        return `${companyId}|${startStr}|${endStr}|campaign|${ids.externalCampaignId || ''}`
      case 'adset':
        return `${companyId}|${startStr}|${endStr}|adset|${ids.adSetId || ''}`
      case 'account':
        return `${companyId}|${startStr}|${endStr}|account|${ids.accountId || ''}`
      case 'ad':
      default:
        return `${companyId}|${startStr}|${endStr}|ad|${ids.adId || ''}`
    }
  }

  /**
   * Batch fetch: busca todos os registros existentes no range de datas em 1 query
   * Retorna um Map de lookup_key -> idRecord para consulta O(1)
   */
  protected async batchFetchExisting(
    companyId: string,
    level: Level,
    dateStart: Date,
    dateEnd: Date
  ): Promise<Map<string, bigint>> {
    const existing = await this.prisma.adsPerformance.findMany({
      where: {
        companyId,
        reportStartDate: { gte: dateStart },
        reportEndDate: { lte: dateEnd },
      },
      select: {
        idRecord: true,
        reportStartDate: true,
        reportEndDate: true,
        adId: true,
        adSetId: true,
        externalCampaignId: true,
        accountId: true,
      },
    })

    const map = new Map<string, bigint>()
    for (const record of existing) {
      const key = this.buildLookupKey(level, companyId, record.reportStartDate, record.reportEndDate, {
        adId: record.adId,
        adSetId: record.adSetId,
        externalCampaignId: record.externalCampaignId,
        accountId: record.accountId,
      })
      map.set(key, record.idRecord)
    }

    this.logger.log(`Batch lookup: ${existing.length} registros existentes no banco (${map.size} chaves unicas)`)
    return map
  }

  /**
   * Batch save: cria novos registros com createMany, atualiza existentes em chunks de transacao
   * Retorna { created, updated }
   */
  protected async batchSave(
    toCreate: any[],
    toUpdate: { idRecord: bigint; data: any }[]
  ): Promise<{ created: number; updated: number }> {
    let created = 0
    let updated = 0

    // Batch create
    if (toCreate.length > 0) {
      await this.prisma.adsPerformance.createMany({
        data: toCreate,
        skipDuplicates: true,
      })
      created = toCreate.length
      this.logger.log(`Batch create: ${created} novos registros`)
    }

    // Batch update in chunks
    if (toUpdate.length > 0) {
      for (let i = 0; i < toUpdate.length; i += UPDATE_CHUNK_SIZE) {
        const chunk = toUpdate.slice(i, i + UPDATE_CHUNK_SIZE)
        await this.prisma.$transaction(
          chunk.map(item =>
            this.prisma.adsPerformance.update({
              where: { idRecord: item.idRecord },
              data: item.data,
            })
          )
        )
        updated += chunk.length
      }
      this.logger.log(`Batch update: ${updated} registros atualizados (${Math.ceil(toUpdate.length / UPDATE_CHUNK_SIZE)} chunks)`)
    }

    return { created, updated }
  }

  /**
   * Batch create zero records: coleta todos os registros zerados necessarios e cria com createMany
   */
  protected async batchCreateZeroRecords(
    allInsights: any[],
    level: Level,
    companyId: string,
    datePreset: string,
    existingMap: Map<string, bigint>,
    timeIncrement?: string | number,
    getItemId?: (insight: any) => string
  ): Promise<number> {
    if (allInsights.length === 0) return 0

    this.logger.log(`=== FASE 2: Criando registros zerados (batch) ===`)

    try {
      const { start: periodStart, end: periodEnd } = this.getDateRangeFromPreset(datePreset)

      // Funcao para extrair ID baseado no level
      const defaultGetItemId = (insight: any) => {
        switch (level) {
          case 'campaign': return insight.campaign_id
          case 'adset': return insight.adset_id
          case 'ad': return insight.ad_id
          default: return insight.ad_id
        }
      }

      const extractItemId = getItemId || defaultGetItemId

      // Extrai itens unicos que apareceram nos insights
      const uniqueItemsMap = new Map<string, UniqueItem>()
      for (const insight of allInsights) {
        const itemId = extractItemId(insight)
        if (itemId && !uniqueItemsMap.has(itemId)) {
          uniqueItemsMap.set(itemId, {
            id: itemId,
            account_id: insight.account_id,
            account_name: insight.account_name,
            campaign_id: insight.campaign_id,
            campaign_name: insight.campaign_name,
            adset_id: insight.adset_id,
            adset_name: insight.adset_name,
            ad_id: insight.ad_id,
            ad_name: insight.ad_name,
          })
        }
      }

      const uniqueItems = Array.from(uniqueItemsMap.values())
      this.logger.log(`Total de ${level}s unicos: ${uniqueItems.length}`)

      // Gera intervalos baseado na granularidade
      const timeIntervals = this.getTimeIntervalsForGranularity(periodStart, periodEnd, timeIncrement)
      this.logger.log(`Total de intervalos: ${timeIntervals.length}`)

      // Collect all zero records to create
      const zeroRecordsToCreate: any[] = []

      for (const interval of timeIntervals) {
        const intervalStartStr = interval.start.toISOString().split('T')[0]
        const intervalEndStr = interval.end.toISOString().split('T')[0]

        // Itens que TEM dados neste intervalo
        const itemsWithDataInInterval = new Set(
          allInsights
            .filter(i => {
              const itemId = extractItemId(i)
              return itemId && i.date_start === intervalStartStr && i.date_stop === intervalEndStr
            })
            .map(i => extractItemId(i))
        )

        // Itens que apareceram mas NAO tem dados neste intervalo
        const itemsWithoutData = uniqueItems.filter(item => !itemsWithDataInInterval.has(item.id))

        for (const item of itemsWithoutData) {
          // Check if already exists using the existing map (reuse from Fase 1)
          const lookupKey = this.buildLookupKey(level, companyId, interval.start, interval.end, {
            adId: item.ad_id,
            adSetId: item.adset_id,
            externalCampaignId: item.campaign_id,
            accountId: item.account_id,
          })

          if (!existingMap.has(lookupKey)) {
            const zeroData = this.mapper.buildZeroRecordData(item, level, interval.start, interval.end, companyId)
            zeroRecordsToCreate.push(zeroData)
          }
        }
      }

      // Batch create all zero records
      if (zeroRecordsToCreate.length > 0) {
        await this.prisma.adsPerformance.createMany({
          data: zeroRecordsToCreate,
          skipDuplicates: true,
        })
        this.logger.log(`Batch create zero records: ${zeroRecordsToCreate.length}`)
      } else {
        this.logger.log(`Nenhum registro zerado necessario`)
      }

      return zeroRecordsToCreate.length
    } catch (phase2Error) {
      this.rethrowIfMetaAuthError(phase2Error)
      this.logger.warn(`Erro na Fase 2: ${phase2Error.message}. Continuando sem registros zerados.`)
      return 0
    }
  }

  // ============================================================================
  // ASYNC REPORTING (AdReportRun) - Fallback para queries pesadas
  // ============================================================================

  /**
   * Busca todas as paginas com fallback para async report (POST) em caso de erro 99.
   * 1. Tenta GET normal com paginacao
   * 2. Se falhar com erro 99/timeout, cria um AdReportRun via POST
   * 3. Aguarda processamento (poll) e busca resultados paginados
   */
  protected async fetchAllPagesWithAsyncFallback(
    baseUrl: string,
    adAccountId: string,
    accessToken: string,
    params: URLSearchParams,
    delayBetweenPages = 300
  ): Promise<any[]> {
    try {
      return await this.fetchAllPages(baseUrl, delayBetweenPages)
    } catch (error) {
      this.rethrowIfMetaAuthError(error)
      const isError99 = error.message?.includes('Unknown error') ||
        error.message?.includes('reduce the amount of data') ||
        error.message?.includes('Please reduce') ||
        error.message?.includes('An unknown error') ||
        error.name === 'AbortError'

      if (!isError99) {
        throw error
      }

      this.logger.warn(`GET /insights falhou com erro 99/timeout. Usando async report (POST)...`)
      return await this.executeAsyncReport(adAccountId, accessToken, params)
    }
  }

  /**
   * Executa o fluxo completo de async report:
   * POST /insights → poll status → GET /insights (resultados)
   */
  protected async executeAsyncReport(
    adAccountId: string,
    accessToken: string,
    params: URLSearchParams
  ): Promise<any[]> {
    // 1. Cria o report assincrono via POST
    const reportRunId = await this.createAsyncReport(adAccountId, accessToken, params)
    this.logger.log(`AdReportRun criado: ${reportRunId}`)

    // 2. Aguarda processamento (poll)
    await this.pollAsyncReport(reportRunId, accessToken)
    this.logger.log(`AdReportRun ${reportRunId} concluido!`)

    // 3. Busca resultados paginados
    const results = await this.fetchAsyncReportResults(reportRunId, accessToken)
    this.logger.log(`AdReportRun ${reportRunId}: ${results.length} registros obtidos`)

    return results
  }

  /**
   * Cria um AdReportRun via POST /insights
   * Retorna o report_run_id para polling
   */
  private async createAsyncReport(
    adAccountId: string,
    accessToken: string,
    params: URLSearchParams
  ): Promise<string> {
    const url = `${this.META_API_BASE}/${this.META_API_VERSION}/${adAccountId}/insights`

    // Copia os params para o body do POST (exceto access_token na URL)
    const bodyParams = new URLSearchParams(params)
    bodyParams.set('access_token', accessToken)

    this.logger.log(`POST ${url} (criando async report...)`)

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 120000) // 2min para criar

    try {
      const response = await fetch(url, {
        method: 'POST',
        body: bodyParams.toString(),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        signal: controller.signal,
      })
      clearTimeout(timeoutId)

      const result = await response.json()

      if (result.error) {
        throw new Error(`Erro ao criar async report: ${result.error.message}`)
      }

      const reportRunId = result.report_run_id || result.id
      if (!reportRunId) {
        throw new Error(`Resposta inesperada do POST /insights: ${JSON.stringify(result)}`)
      }

      return reportRunId
    } catch (error) {
      clearTimeout(timeoutId)
      throw error
    }
  }

  /**
   * Faz polling do status do AdReportRun ate completar ou falhar.
   * Statuses: Job Not Started → Job Started → Job Running → Job Completed
   * Pode falhar com: Job Failed, Job Skipped
   */
  private async pollAsyncReport(
    reportRunId: string,
    accessToken: string,
    maxWaitMs = 600000, // 10 minutos maximo
    pollIntervalMs = 5000 // 5 segundos entre polls
  ): Promise<void> {
    const startTime = Date.now()
    let lastStatus = ''
    let lastPercent = 0

    while (Date.now() - startTime < maxWaitMs) {
      const url = `${this.META_API_BASE}/${this.META_API_VERSION}/${reportRunId}?access_token=${accessToken}`

      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 30000)

      try {
        const response = await fetch(url, { signal: controller.signal })
        clearTimeout(timeoutId)
        const result = await response.json()

        if (result.error) {
          throw new Error(`Erro ao consultar status do report: ${result.error.message}`)
        }

        const status = result.async_status
        const percent = result.async_percent_completion || 0

        // Log apenas quando muda
        if (status !== lastStatus || percent !== lastPercent) {
          this.logger.log(`  AdReportRun ${reportRunId}: ${status} (${percent}%)`)
          lastStatus = status
          lastPercent = percent
        }

        if (status === 'Job Completed') {
          return
        }

        if (status === 'Job Failed' || status === 'Job Skipped') {
          throw new Error(`AdReportRun falhou com status: ${status}`)
        }

        // Delay progressivo: começa com pollIntervalMs, aumenta conforme demora
        const elapsed = Date.now() - startTime
        const delay = elapsed > 60000 ? pollIntervalMs * 2 : pollIntervalMs
        await this.sleep(delay)
      } catch (error) {
        clearTimeout(timeoutId)
        if (error.name === 'AbortError') {
          this.logger.warn(`Timeout no polling, tentando novamente...`)
          await this.sleep(pollIntervalMs)
          continue
        }
        throw error
      }
    }

    throw new Error(`AdReportRun ${reportRunId} nao completou em ${maxWaitMs / 1000}s`)
  }

  /**
   * Busca os resultados paginados de um AdReportRun completado.
   * Usa limit=500 pois o report ja foi processado (sem risco de timeout)
   */
  private async fetchAsyncReportResults(
    reportRunId: string,
    accessToken: string
  ): Promise<any[]> {
    const baseUrl = `${this.META_API_BASE}/${this.META_API_VERSION}/${reportRunId}/insights?access_token=${accessToken}&limit=500`
    return await this.fetchAllPages(baseUrl, 200) // delay menor pois dados ja estao prontos
  }

  // ============================================================================
  // DELIVERY STATUS - Busca status de entrega das entidades do Meta
  // ============================================================================

  /**
   * Busca effective_status das entidades (campaigns, adsets, ads) via Meta API
   * e atualiza o campo delivery_status nos registros de AdsPerformance.
   *
   * O endpoint /insights NAO retorna status - ele e uma propriedade dos objetos
   * (campaign, adset, ad). Por isso precisamos de uma chamada separada.
   *
   * effective_status reflete o status real de entrega, incluindo heranca:
   * - Ad ACTIVE mas campanha PAUSED -> effective_status = "CAMPAIGN_PAUSED"
   * - Ad ACTIVE mas adset PAUSED -> effective_status = "ADSET_PAUSED"
   */
  protected async fetchAndUpdateDeliveryStatuses(
    companyId: string,
    adAccountId: string,
    accessToken: string,
    level: Level,
    dateStart: Date,
    dateEnd: Date
  ): Promise<number> {
    if (level === 'account') {
      return 0
    }

    this.logger.log(`=== FASE 3: Atualizando delivery_status (${level}) ===`)

    try {
      // Mapa de level -> endpoint e campo no banco
      const levelConfig: Record<string, { endpoint: string; dbField: string }> = {
        ad: { endpoint: 'ads', dbField: 'adId' },
        adset: { endpoint: 'adsets', dbField: 'adSetId' },
        campaign: { endpoint: 'campaigns', dbField: 'externalCampaignId' },
      }

      const config = levelConfig[level]
      if (!config) return 0

      // Busca entidades com effective_status (lightweight: apenas 2 campos)
      const url = `${this.META_API_BASE}/${this.META_API_VERSION}/${adAccountId}/${config.endpoint}?fields=id,effective_status&limit=500&access_token=${accessToken}`
      const allEntities = await this.fetchAllPages(url, 200)
      this.logger.log(`Fetched ${allEntities.length} ${config.endpoint} com effective_status`)

      if (allEntities.length === 0) return 0

      // Agrupa IDs por status para batch updates eficientes
      const statusGroups = new Map<string, string[]>()
      for (const entity of allEntities) {
        if (!entity.id || !entity.effective_status) continue
        const status = entity.effective_status
        if (!statusGroups.has(status)) {
          statusGroups.set(status, [])
        }
        statusGroups.get(status)!.push(entity.id)
      }

      // Um updateMany por status unico (tipicamente 3-5 queries no total)
      let totalUpdated = 0
      for (const [status, entityIds] of statusGroups) {
        const where: any = {
          companyId,
          reportStartDate: { gte: dateStart },
          reportEndDate: { lte: dateEnd },
        }

        // Aplica filtro por ID do nivel correto
        if (level === 'ad') {
          where.adId = { in: entityIds }
        } else if (level === 'adset') {
          where.adSetId = { in: entityIds }
        } else if (level === 'campaign') {
          where.externalCampaignId = { in: entityIds }
        }

        const result = await this.prisma.adsPerformance.updateMany({
          where,
          data: { deliveryStatus: status },
        })
        totalUpdated += result.count
        if (result.count > 0) {
          this.logger.log(`  Status "${status}": ${result.count} registros atualizados`)
        }
      }

      this.logger.log(`Delivery status atualizado: ${totalUpdated} registros total`)
      return totalUpdated
    } catch (error) {
      this.rethrowIfMetaAuthError(error)
      this.logger.warn(`Erro ao atualizar delivery_status: ${error.message}. Continuando sem status.`)
      return 0
    }
  }

  /**
   * Fase de enriquecimento de thumbnails:
   * Busca adIds SEM thumbnail_url OU com thumbnail_url de CDN da Meta (fbcdn/cdninstagram,
   * URL assinada que expira), chama a Meta API e grava a URL fresca. persistThumbnailsToStorage()
   * depois baixa essa URL e a re-hospeda numa URL permanente (files.hdmfy.com).
   *
   * Resolve a imagem tambem no CORPO do criativo (object_story_spec / asset_feed_spec) e,
   * quando so ha image_hash, via /act_{id}/adimages — garantindo thumbnail para mais tipos
   * de criativo (link/photo ads, Advantage+/dynamic).
   */
  protected async enrichThumbnails(
    companyId: string,
    adAccountId: string,
    accessToken: string,
    periodStart: Date,
    periodEnd: Date,
  ): Promise<number> {
    try {
      this.logger.log(`=== FASE THUMBNAILS: Buscando thumbnails dos anuncios ===`)

      // adIds sem thumbnail OU com thumbnail de CDN Meta (fbcdn/cdninstagram = URL assinada que
      // expira -> 403 no browser). Re-buscamos uma URL fresca; persistThumbnailsToStorage a
      // converte em URL permanente (files.hdmfy.com). Nunca sobrescrevemos URLs ja permanentes.
      //
      // O quarto ramo e o que faz a correcao de resolucao se auto-curar: objeto ja espelhado
      // cuja chave NAO carrega o sufixo de tamanho foi gravado antes de pedirmos 1080px, entao
      // volta para a fila sozinho. Sem isso as linhas antigas ficariam pequenas para sempre, e
      // a alternativa (UPDATE em massa zerando thumbnail_url) dispararia pg_notify por linha.
      // Duas metades unidas: o que caiu na janela sincronizada (comportamento de sempre)
      // MAIS um lote de auto-cura de fora dela, do mais antigo para o mais novo.
      //
      // O filtro de periodo existe para limitar custo — sao chamadas a Graph API em lotes
      // de 50 mais o download de cada imagem — mas ele tambem impedia que anuncio sem
      // entrega no periodo fosse reprocessado ALGUM DIA. Na TFA isso deixou 4 de 6
      // criativos congelados: pararam de veicular em 16/07 e o preset da tela e "Este mes".
      // O teto preserva a razao do filtro sem a consequencia.
      const adsWithoutThumbnail = await this.prisma.$queryRawUnsafe<{ adId: string }[]>(`
        (
          SELECT DISTINCT ad_id AS "adId"
          FROM ads_performance
          WHERE company_id = $1
            AND ad_id IS NOT NULL AND ad_id != ''
            AND ${this.thumbnailPodeMelhorarSql()}
            AND report_start_date >= $2
            AND report_end_date <= $3
        )
        UNION
        (
          SELECT ad_id AS "adId"
          FROM ads_performance
          WHERE company_id = $1
            AND ad_id IS NOT NULL AND ad_id != ''
            AND ${this.thumbnailPodeMelhorarSql()}
          GROUP BY ad_id
          ORDER BY max(report_end_date) ASC
          LIMIT ${ENRICHMENT_SELF_HEAL_LIMIT}
        )
      `, companyId, periodStart, periodEnd)

      if (adsWithoutThumbnail.length === 0) {
        this.logger.log(`Todos os anuncios ja tem thumbnail permanente`)
        return 0
      }

      const adIds = adsWithoutThumbnail.map(a => a.adId)
      this.logger.log(`${adIds.length} anuncios sem thumbnail (ou com URL de CDN a renovar), buscando na Meta API...`)

      // Busca thumbnails em lotes de 50
      const CHUNK_SIZE = 50
      let totalUpdated = 0

      // Gravacao usando o MESMO predicado da selecao — em SQL cru justamente para poder
      // reusa-lo. Em Prisma nao da para expressar a comparacao numerica do carimbo de
      // largura, e uma segunda formulacao a mao e o que ja tinha feito o guard do frame de
      // video divergir dos outros dois.
      const gravarThumbnail = (adId: string, url: string) =>
        this.prisma.$executeRawUnsafe(`
          UPDATE ads_performance
          SET thumbnail_url = $1
          WHERE company_id = $2
            AND ad_id = $3
            AND ${this.thumbnailPodeMelhorarSql()}
        `, url, companyId, adId)

      // Criativos montados via object_story_spec/asset_feed_spec podem expor apenas o
      // image_hash (sem URL direta). Coletamos hash -> adIds para resolver via /adimages na fase 2.
      const hashToAdIds = new Map<string, string[]>()

      for (let i = 0; i < adIds.length; i += CHUNK_SIZE) {
        const chunk = adIds.slice(i, i + CHUNK_SIZE)
        const ids = chunk.join(',')

        // image_url/thumbnail_url de topo cobrem videos e imagens simples.
        // object_story_spec (link/photo) e asset_feed_spec (Advantage+/dynamic) so expoem a
        // imagem no corpo do criativo (URL direta OU image_hash).
        // thumbnail_width/height NAO sao decorativos: sem eles o Meta devolve o
        // thumbnail no default de 64x64, que esticado num card de ~300x375 e
        // exatamente o "borrado ate passar o mouse". Medido em 30/08/2026: 32 de 40
        // thumbnails espelhados tinham menos de 20 KB. image_url ja vem grande, por
        // isso continua na frente da cadeia de resolucao.
        const params = new URLSearchParams({
          ids,
          fields: 'creative{image_url,thumbnail_url,object_story_spec{link_data{picture,image_hash},photo_data{url,image_hash},video_data{image_url,image_hash}},asset_feed_spec{images{url,hash}},image_hash}',
          thumbnail_width: String(THUMBNAIL_TARGET_PX),
          thumbnail_height: String(THUMBNAIL_TARGET_PX),
          access_token: accessToken,
        })

        const url = `${this.META_API_BASE}/${this.META_API_VERSION}/?${params.toString()}`
        const response = await fetch(url)
        const data = await response.json()

        if (data.error) {
          this.logger.warn(`Erro ao buscar thumbnails: ${data.error.message}`)
          continue
        }

        // Atualiza cada ad no banco (grava a URL fresca sobre NULL ou sobre a URL de CDN antiga)
        for (const adId of chunk) {
          const adData = data[adId]
          if (adData?.error) continue

          const creative = adData?.creative
          const oss = creative?.object_story_spec

          // Log de diagnostico para o primeiro ad do primeiro chunk (revela a forma do criativo)
          if (i === 0 && adId === chunk[0] && creative) {
            this.logger.log(`[DIAG] Sample ad ${adId} creative keys: ${Object.keys(creative).join(', ')}`)
            if (oss) {
              this.logger.log(`[DIAG] object_story_spec keys: ${Object.keys(oss).join(', ')}`)
            }
          }

          // 1) URL direta de imagem (imagem simples, link ad, photo, video poster, asset_feed)
          const thumbnailUrl = creative?.image_url
            ?? creative?.thumbnail_url
            ?? oss?.link_data?.picture
            ?? oss?.photo_data?.url
            ?? oss?.video_data?.image_url
            ?? creative?.asset_feed_spec?.images?.[0]?.url
            ?? null

          if (thumbnailUrl) {
            await gravarThumbnail(adId, thumbnailUrl)
            totalUpdated++
            continue
          }

          // 2) Sem URL direta: guarda o image_hash para resolver via /adimages na fase 2
          const imageHash = oss?.link_data?.image_hash
            ?? oss?.photo_data?.image_hash
            ?? oss?.video_data?.image_hash
            ?? creative?.asset_feed_spec?.images?.[0]?.hash
            ?? creative?.image_hash
            ?? null

          if (imageHash) {
            const existing = hashToAdIds.get(imageHash) ?? []
            existing.push(adId)
            hashToAdIds.set(imageHash, existing)
          }
        }
      }

      // === Fase 2: resolver image_hash -> URL via /act_{id}/adimages ===
      // Necessario para criativos Advantage+/dynamic e alguns object_story_spec que so expoem o hash.
      if (hashToAdIds.size > 0) {
        const hashes = Array.from(hashToAdIds.keys())
        this.logger.log(`${hashes.length} imagens sem URL direta, resolvendo via /adimages...`)

        for (let i = 0; i < hashes.length; i += CHUNK_SIZE) {
          const chunk = hashes.slice(i, i + CHUNK_SIZE)

          const params = new URLSearchParams({
            hashes: JSON.stringify(chunk),
            fields: 'hash,permalink_url,url',
            access_token: accessToken,
          })

          const url = `${this.META_API_BASE}/${this.META_API_VERSION}/${adAccountId}/adimages?${params.toString()}`
          const response = await fetch(url)
          const data = await response.json()

          if (data.error) {
            this.logger.warn(`Erro ao resolver hashes de imagem: ${data.error.message}`)
            continue
          }

          // /adimages pode retornar um array em data.data OU um objeto keyed por hash.
          const images: any[] = Array.isArray(data.data)
            ? data.data
            : Object.values(data.data ?? {})

          for (const img of images) {
            // Preferimos `url` (imagem direta fbcdn): renderiza em <img> E e re-hospedada
            // permanentemente por persistThumbnailsToStorage. `permalink_url` e um wrapper
            // facebook.com que nao esta na CSP img-src e nao seria re-hospedado.
            const resolvedUrl = img?.url ?? img?.permalink_url ?? null
            if (!resolvedUrl || !img?.hash) continue

            for (const adId of hashToAdIds.get(img.hash) ?? []) {
              await gravarThumbnail(adId, resolvedUrl)
              totalUpdated++
            }
          }
        }
      }

      this.logger.log(`Thumbnails atualizados: ${totalUpdated}/${adIds.length} anuncios`)
      return totalUpdated
    } catch (error) {
      this.rethrowIfMetaAuthError(error)
      this.logger.warn(`Erro na fase de thumbnails: ${error.message}. Continuando sem thumbnails.`)
      return 0
    }
  }

  /**
   * Fase de enriquecimento de video URLs:
   * Busca adIds que ja tem thumbnail mas nao tem video_url,
   * consulta creative{video_id,object_story_spec} via Meta API,
   * depois busca source dos videos.
   */
  protected async enrichVideoUrls(
    companyId: string,
    adAccountId: string,
    accessToken: string,
    periodStart: Date,
    periodEnd: Date,
  ): Promise<number> {
    try {
      this.logger.log(`=== FASE VIDEO URLS: Buscando URLs de video dos anuncios ===`)

      // Busca adIds unicos que tem thumbnail mas nao tem video_url valido
      // Re-processa: NULL, paths relativos (/reel/...), e URLs do Facebook (para tentar source MP4)
      //
      // O ramo `video_id IS NULL` cobre a linha que JA tem um mp4 bom mas e anterior a
      // coluna de identidade: sem ele essa linha nunca mais seria visitada e ficaria
      // para sempre sem video_id, invisivel para a analise de criativo. Nao amplia o
      // custo para anuncio de imagem — esse ja entra pelo ramo `video_url IS NULL`.
      // O portao `thumbnail_url IS NOT NULL` que existia aqui foi removido: ele fazia
      // anuncio sem thumbnail NUNCA receber video_id, e video_id e o que a tela de
      // criativos exige para sequer oferecer a analise. Sao duas midias independentes —
      // nao ter capa nao diz nada sobre ter video.
      //
      // Mesma estrutura da fase de thumbnail: a janela sincronizada MAIS um lote de
      // auto-cura de fora dela, do mais antigo para o mais novo, com teto.
      const adsWithoutVideo = await this.prisma.$queryRawUnsafe<{ adId: string }[]>(`
        (
          SELECT DISTINCT ad_id AS "adId"
          FROM ads_performance
          WHERE company_id = $1
            AND ad_id IS NOT NULL AND ad_id != ''
            AND (
              video_url IS NULL
              OR video_url LIKE '/%'
              OR video_url LIKE '%facebook.com/facebook/videos%'
              OR video_id IS NULL
            )
            AND report_start_date >= $2
            AND report_end_date <= $3
        )
        UNION
        (
          SELECT ad_id AS "adId"
          FROM ads_performance
          WHERE company_id = $1
            AND ad_id IS NOT NULL AND ad_id != ''
            AND video_id IS NULL
          GROUP BY ad_id
          ORDER BY max(report_end_date) ASC
          LIMIT ${ENRICHMENT_SELF_HEAL_LIMIT}
        )
      `, companyId, periodStart, periodEnd)

      if (adsWithoutVideo.length === 0) {
        this.logger.log(`Todos os anuncios ja tem video_url ou nao possuem thumbnail`)
        return 0
      }

      const adIds = adsWithoutVideo.map(a => a.adId)
      this.logger.log(`${adIds.length} anuncios sem video_url, buscando video_id na Meta API...`)

      const CHUNK_SIZE = 50
      let totalUpdated = 0

      // Passo 1: Buscar creative{video_id,object_story_spec} para cada ad em chunks
      // video_id pode estar direto no creative ou dentro de object_story_spec.video_data
      const videoIdToAdIds = new Map<string, string[]>()
      let adsWithCreativeData = 0
      let adsWithVideoId = 0
      let imageOnlyAds = 0

      for (let i = 0; i < adIds.length; i += CHUNK_SIZE) {
        const chunk = adIds.slice(i, i + CHUNK_SIZE)
        const ids = chunk.join(',')

        const params = new URLSearchParams({
          ids,
          // `asset_feed_spec{videos{video_id}}` estava FALTANDO, e essa e a lacuna que deixa
          // criativo Advantage+/dinamico sem video. O enrichThumbnails ja pedia
          // `asset_feed_spec{images{...}}` — entao a IMAGEM desses criativos era achada e o
          // VIDEO nao, o que produz exatamente o sintoma "o anuncio tem 127 mil reproducoes
          // mas a coluna video_id esta vazia" (caso `video_1` da TFA, 31/08/2026).
          // `object_story_spec` continua aqui pelo `video_data.video_id`, nao mais pelo
          // `page_id`: quem decide o token de Pagina agora e o `from.id` do no Video,
          // pedido pelo MetaVideoSourceService (o `page_id` vinha ausente na medicao, e
          // quando vem e a Pagina do anuncio, nao a dona do video).
          fields: 'creative{video_id,object_story_spec,asset_feed_spec{videos{video_id}}}',
          access_token: accessToken,
        })

        const url = `${this.META_API_BASE}/${this.META_API_VERSION}/?${params.toString()}`
        const response = await fetch(url)
        const data = await response.json()

        if (data.error) {
          this.logger.warn(`Erro ao buscar creative data: ${JSON.stringify(data.error)}`)
          continue
        }

        for (const adId of chunk) {
          const adData = data[adId]
          if (adData?.error) {
            this.logger.warn(`Erro para ad ${adId}: ${JSON.stringify(adData.error)}`)
            continue
          }

          const creative = adData?.creative
          if (!creative) continue
          adsWithCreativeData++

          // Tenta extrair video_id de multiplas fontes, na ordem em que a Meta as expoe:
          // 1. Direto no creative.video_id            — criativo simples
          // 2. object_story_spec.video_data.video_id  — post promovido
          // 3. asset_feed_spec.videos[].video_id      — Advantage+ / dynamic creative
          //
          // A terceira e a que faltava. Espelha a cadeia que o enrichThumbnails ja usa para
          // imagem; sem ela, criativo dinamico fica com capa e sem video.
          const videoId = creative.video_id
            ?? creative.object_story_spec?.video_data?.video_id
            ?? creative.asset_feed_spec?.videos?.find((v: any) => v?.video_id)?.video_id
            ?? null

          // Log de diagnostico para o primeiro ad do primeiro chunk
          if (i === 0 && adId === chunk[0]) {
            this.logger.log(`[DIAG] Sample ad ${adId} creative keys: ${Object.keys(creative).join(', ')}`)
            if (creative.object_story_spec) {
              this.logger.log(`[DIAG] object_story_spec keys: ${Object.keys(creative.object_story_spec).join(', ')}`)
            }
            if (creative.asset_feed_spec) {
              const qtd = creative.asset_feed_spec.videos?.length ?? 0
              this.logger.log(`[DIAG] asset_feed_spec: ${qtd} video(s) — criativo dinamico`)
            }
            this.logger.log(`[DIAG] video_id extraido: ${videoId ?? 'null'}`)
          }

          if (videoId) {
            adsWithVideoId++
            const existing = videoIdToAdIds.get(String(videoId)) ?? []
            existing.push(adId)
            videoIdToAdIds.set(String(videoId), existing)
          } else {
            imageOnlyAds++
          }
        }
      }

      this.logger.log(`Resultado fase 1: ${adsWithCreativeData} ads com creative, ${adsWithVideoId} com video_id, ${imageOnlyAds} sem video (imagem)`)

      // IDENTIDADE PRIMEIRO, MIDIA DEPOIS.
      //
      // Antes o `video_id` so era gravado la na fase 2, junto com o `video_url` — e a fase
      // 2 e exatamente a que costuma falhar: ela pede `source` do no Video, que exige
      // permissao de Pagina e volta erro em 99,7% dos casos medidos. Os dois `continue` de
      // erro (chunk inteiro e video individual) descartavam o video_id JA DESCOBERTO aqui,
      // e a coluna ficava NULL para sempre. Como `ad_creative_analysis` e chaveada por
      // (company_id, video_id) NOT NULL, isso bloqueava a analise de criativo inteira e a
      // tela dizia "Este criativo ainda nao tem identificacao de video".
      //
      // A identidade nao depende da midia: ja esta em maos, e a mesma para o criativo
      // inteiro. Gravar aqui torna a fase 2 opcional para o que a tela precisa.
      let identidadesGravadas = 0
      for (const [videoId, adsDoVideo] of videoIdToAdIds) {
        for (const adId of adsDoVideo) {
          identidadesGravadas += await this.prisma.$executeRawUnsafe(`
            UPDATE ads_performance
            SET video_id = $1
            WHERE company_id = $2
              AND ad_id = $3
              AND video_id IS DISTINCT FROM $1
          `, videoId, companyId, adId)
        }
      }
      if (identidadesGravadas > 0) {
        this.logger.log(`video_id gravado em ${identidadesGravadas} linhas (identidade, independente do mp4)`)
      }

      if (videoIdToAdIds.size === 0) {
        this.logger.log(`Nenhum anuncio de video encontrado entre os ${adIds.length} anuncios verificados`)
        return 0
      }

      this.logger.log(`${videoIdToAdIds.size} videos unicos encontrados, buscando o mp4...`)

      // Passo 2: o mp4, pelo MetaVideoSourceService.
      //
      // A busca saiu daqui de proposito. Ela tem TRES trilhas (token de usuario, token
      // da Pagina DONA do video, biblioteca da conta de anuncios), cada uma escolhida
      // por medicao e nao por leitura de doc, e a analise de criativo precisa da MESMA
      // cascata quando o usuario clica "Transcrever" — mante-la inline aqui obrigaria a
      // duplicar tres caminhos em dois lugares que teriam de concordar para sempre.
      //
      // O QUE MUDOU: o token de Pagina agora e escolhido pelo `from.id` do proprio no
      // Video, e nao por `object_story_spec.page_id`. Nos criativos medidos (TFA,
      // 01/09/2026) o `page_id` veio AUSENTE nos tres — criativo Advantage+/dinamico
      // costuma nao ter `object_story_spec` —, e mesmo quando vem ele e a Pagina do
      // ANUNCIO, que pode nao ser a dona do VIDEO: o video 1371073824012492 pertence a
      // "TFA Argentina" enquanto a conta tem outras duas Paginas, e so o token DAQUELA
      // devolveu o arquivo. Era por isso que o agrupamento por Pagina ja existia aqui e
      // mesmo assim nenhum mp4 chegava.
      const resolucao = await this.videoSource.resolveMany({
        accessToken,
        adAccountId,
        videoIds: [...videoIdToAdIds.keys()],
      })

      let videosWithSource = 0
      let videosWithFallback = 0
      let videosWithBetterThumb = 0
      /** Quantos vieram por cada trilha e, quando nao veio, por qual motivo. */
      const porTrilha = new Map<string, number>()
      const porMotivo = new Map<string, number>()

      for (const [videoId, adIdsForVideo] of videoIdToAdIds) {
        const achado = resolucao.get(videoId)

        let videoUrl: string
        let noVideo: any = null

        if (achado?.reason === 'ok') {
          videoUrl = achado.url
          noVideo = { thumbnails: { data: achado.thumbnails ?? [] } }
          videosWithSource++
          porTrilha.set(achado.via, (porTrilha.get(achado.via) ?? 0) + 1)
        } else {
          // Fallback: URL de embed montada a partir do video_id. NAO e um mp4 — e uma
          // pagina, sem audio —, mas continua sendo o unico preview desses cards, e o
          // CreativeMediaPreview ja sabe checar se ela incorpora antes de montar o
          // iframe. Quem recusa a embed e a analise de criativo, que precisa de bytes.
          videoUrl = `https://www.facebook.com/facebook/videos/${videoId}/`
          videosWithFallback++
          const motivo = achado?.reason ?? 'sem_resposta'
          porMotivo.set(motivo, (porMotivo.get(motivo) ?? 0) + 1)
          if (achado?.reason === 'no_page_token') {
            this.logger.warn(`video ${videoId}: ${achado.message}`)
          }
        }

        // Frame grande do no Video, quando a Meta oferecer um melhor que o atual.
        const largest = pickLargestThumbnail(noVideo)
        const betterThumb =
          largest && largest.width >= THUMBNAIL_TARGET_PX / 2 ? largest.uri : null
        if (betterThumb) videosWithBetterThumb++

        for (const adId of adIdsForVideo) {
          await this.prisma.$executeRawUnsafe(`
            UPDATE ads_performance
            SET video_url = $1
            WHERE company_id = $2
              AND ad_id = $3
              AND (video_url IS NULL OR video_url LIKE '/%' OR video_url LIKE '%facebook.com/facebook/videos%')
          `, videoUrl, companyId, adId)

          // A identidade NAO e regravada aqui: o bloco "identidade primeiro" da fase 1
          // ja percorre este mesmo `videoIdToAdIds` e grava o video_id de todos. Repetir
          // era so heranca de quando a fase 2 era a unica que enxergava o par
          // (video, ad) — e passou a doer quando ela deixou de abortar em erro: com a
          // cascata devolvendo motivo por video em vez de `continue`, o UPDATE
          // redundante virava 2 escritas por ad, inclusive nos que nao tem mp4.

          // Escrita separada e condicional: o frame do video so entra por cima de um
          // thumbnail ausente ou de um espelho pequeno. Um espelho ja em 1080px nunca
          // e sobrescrito — mesmo guard das outras fases.
          if (betterThumb) {
            // Mesmo predicado das outras escritas. Antes faltavam aqui os ramos de CDN
            // da Meta — e como enrichThumbnails roda ANTES e acabava de gravar uma URL
            // fbcdn, a linha nunca estava NULL e o frame grande do no Video (o melhor
            // thumbnail que existe para criativo de video, gerado pela propria Meta em
            // tamanho cheio) era jogado fora em todo sync. O log dizia "N com frame
            // grande" e zero linhas eram escritas.
            await this.prisma.$executeRawUnsafe(`
              UPDATE ads_performance
              SET thumbnail_url = $1
              WHERE company_id = $2
                AND ad_id = $3
                AND ${this.thumbnailPodeMelhorarSql()}
            `, betterThumb, companyId, adId)
          }

          totalUpdated++
        }
      }

      const trilhas = [...porTrilha].map(([k, n]) => `${n} via ${k}`).join(', ') || 'nenhum'
      const motivos = [...porMotivo].map(([k, n]) => `${n} ${k}`).join(', ') || 'nenhum'
      this.logger.log(`Resultado fase 2: ${videosWithSource} com mp4 (${trilhas}); ${videosWithFallback} sem mp4 (${motivos}); ${videosWithBetterThumb} com frame grande do no Video`)
      this.logger.log(`Video URLs atualizados: ${totalUpdated} anuncios`)
      return totalUpdated
    } catch (error) {
      this.rethrowIfMetaAuthError(error)
      this.logger.warn(`Erro na fase de video URLs: ${error.message}. Continuando sem video URLs.`)
      return 0
    }
  }

  /**
   * Helper para sleep
   */
  protected sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}
