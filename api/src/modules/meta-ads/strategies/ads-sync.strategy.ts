import { Injectable } from '@nestjs/common'
import { PrismaService } from 'src/database/prisma.service'
import { MetaAdsMapper } from '../mappers/meta-ads.mapper'
import { MetaVideoSourceService } from '../services/meta-video-source.service'
import { BaseSyncStrategy } from './base-sync.strategy'
import { SyncResult } from '../interfaces/meta-ads.interfaces'
import { ESSENTIAL_INSIGHT_FIELDS, ADS_EFFECTIVE_STATUSES } from '../constants/meta-ads.constants'

export interface AdsSyncOptions {
  timeIncrement?: string | number
}

/**
 * Estrategia de sincronizacao usando o endpoint /ads com insights aninhados
 * Usado para: level='ad' com granularidade diaria (evita timeout do /insights)
 * Referencia: https://developers.facebook.com/docs/marketing-api/reference/ad-account/ads/
 */
@Injectable()
export class AdsSyncStrategy extends BaseSyncStrategy {
  constructor(
    prisma: PrismaService,
    mapper: MetaAdsMapper,
    videoSource: MetaVideoSourceService
  ) {
    super(prisma, mapper, videoSource, 'AdsSyncStrategy')
  }

  async sync(
    companyId: string,
    adAccountId: string,
    accessToken: string,
    datePreset: string,
    options?: AdsSyncOptions
  ): Promise<SyncResult> {
    this.logger.log(`=== ADS SYNC STRATEGY (endpoint /ads) ===`)
    this.logger.log(`Company ID: ${companyId}`)
    this.logger.log(`Date Preset: ${datePreset}`)
    this.logger.log(`Time Increment: ${options?.timeIncrement || 'all_days'}`)

    // Campos essenciais (~40) sem identificacao (ja vem do ad object)
    const adsExcluded = new Set(['ad_id', 'ad_name', 'adset_id', 'adset_name', 'campaign_id', 'campaign_name'])
    const adsInsightFields = ESSENTIAL_INSIGHT_FIELDS.filter(f => !adsExcluded.has(f))

    // Constroi a edge de insights aninhados
    let insightsEdge = `insights.date_preset(${datePreset})`
    if (options?.timeIncrement) {
      insightsEdge += `.time_increment(${options.timeIncrement})`
    }
    insightsEdge += `{${adsInsightFields.join(',')}}`

    const adFields = [
      'id',
      'name',
      'status',
      'effective_status',
      'adset_id',
      'adset{id,name,campaign_id,campaign{id,name,account_id}}',
      insightsEdge,
    ].join(',')

    // Limit adaptativo: cada ad carrega N insights aninhados (1 por dia)
    // Quanto maior o periodo + time_increment diario, menos ads por pagina
    const adsLimit = this.calculateAdsLimit(datePreset, options?.timeIncrement)

    const params = new URLSearchParams({
      fields: adFields,
      access_token: accessToken,
      limit: String(adsLimit),
      effective_status: JSON.stringify(ADS_EFFECTIVE_STATUSES),
    })

    const url = `${this.META_API_BASE}/${this.META_API_VERSION}/${adAccountId}/ads?${params.toString()}`
    this.logger.log(`Limit adaptativo: ${adsLimit} ads/pagina`)
    this.logger.log(`URL (sem token): ${this.redactToken(url)}`)

    // Busca todos os ads com paginacao (timeout maior)
    const allAds = await this.fetchAllPagesWithLongerTimeout(url)
    this.logger.log(`=== TOTAL: ${allAds.length} ads encontrados ===`)

    if (allAds.length === 0) {
      this.logger.log(`Nenhum ad retornado. Sync finalizado.`)
      return { synced: 0, errors: 0, zeroRecords: 0 }
    }

    // === FASE 1: Batch sync ===
    const { start: periodStart, end: periodEnd } = this.getDateRangeFromPreset(datePreset)

    // 1. Batch fetch existing records (1 query)
    const existingMap = await this.batchFetchExisting(companyId, 'ad', periodStart, periodEnd)

    // 2. Classify into creates vs updates
    const toCreate: any[] = []
    const toUpdate: { idRecord: bigint; data: any }[] = []
    let errors = 0
    const allInsightsForPhase2: any[] = []

    for (const ad of allAds) {
      try {
        const adInsights = ad.insights?.data || []

        if (adInsights.length === 0) continue

        for (const insight of adInsights) {
          const startDate = new Date(insight.date_start)
          const endDate = new Date(insight.date_stop)

          const data = this.mapper.mapAdWithInsightToDatabase(ad, insight, companyId)

          // O objeto ad ja tem effective_status (status real de entrega)
          data.deliveryStatus = ad.effective_status || ad.status || null

          const lookupKey = this.buildLookupKey('ad', companyId, startDate, endDate, {
            adId: ad.id,
          })

          const existingId = existingMap.get(lookupKey)

          if (existingId) {
            // Preserva o campaignId existente — nao sobrescreve vinculos ja feitos
            const { campaignId, ...updateData } = data
            toUpdate.push({ idRecord: existingId, data: updateData })
          } else {
            toCreate.push(data)
          }

          // Guarda para Fase 2
          allInsightsForPhase2.push({
            ad_id: ad.id,
            ad_name: ad.name,
            adset_id: ad.adset?.id || ad.adset_id,
            adset_name: ad.adset?.name,
            campaign_id: ad.adset?.campaign?.id || ad.adset?.campaign_id,
            campaign_name: ad.adset?.campaign?.name,
            account_id: ad.adset?.campaign?.account_id,
            date_start: insight.date_start,
            date_stop: insight.date_stop,
          })
        }
      } catch (adError) {
        this.logger.error(`Erro ao processar ad ${ad.id}: ${adError.message}`)
        errors++
      }
    }

    // 3. Batch save (createMany + chunked updates)
    const { created, updated } = await this.batchSave(toCreate, toUpdate)
    const synced = created + updated

    // === FASE 2: Batch create zero records ===
    let zeroRecords = 0
    if (allInsightsForPhase2.length > 0) {
      zeroRecords = await this.batchCreateZeroRecords(
        allInsightsForPhase2,
        'ad',
        companyId,
        datePreset,
        existingMap,
        options?.timeIncrement
      )
    }

    // === FASE 3: Enriquecer thumbnails dos anuncios ===
    await this.enrichThumbnails(companyId, adAccountId, accessToken, periodStart, periodEnd)
    await this.enrichVideoUrls(companyId, adAccountId, accessToken, periodStart, periodEnd)

    this.logger.log(`Ads sync completed: ${synced} synced (${created} new, ${updated} updated), ${zeroRecords} zero records, ${errors} errors`)
    return { synced, errors, zeroRecords }
  }

  /**
   * Calcula o limit ideal para o endpoint /ads baseado no periodo e granularidade.
   * Cada ad traz N insights aninhados (1 por dia se time_increment=1).
   * Meta aceita max ~3000 "insight-records" por pagina no /ads.
   * Formula: limit = floor(3000 / dias_estimados), clamped entre 25-200
   */
  private calculateAdsLimit(datePreset: string, timeIncrement?: string | number): number {
    // Se nao tem time_increment ou e all_days, cada ad = 1 insight
    if (!timeIncrement || timeIncrement === 'all_days' || timeIncrement === 'monthly') {
      return 200
    }

    // Estima quantos dias o periodo tem
    const estimatedDays: Record<string, number> = {
      today: 1,
      yesterday: 1,
      last_3d: 3,
      last_7d: 7,
      this_week_mon_today: 4,
      this_week_sun_today: 4,
      last_14d: 14,
      last_week_mon_sun: 7,
      last_week_sun_sat: 7,
      last_28d: 28,
      last_30d: 30,
      this_month: new Date().getDate(), // dia atual do mes
      last_month: new Date(new Date().getFullYear(), new Date().getMonth(), 0).getDate(), // dias do mes anterior
      this_quarter: 90,
      last_quarter: 90,
      last_90d: 90,
      this_year: Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 1).getTime()) / 86400000),
      last_year: 365,
      maximum: 365,
      data_maximum: 365,
    }

    const days = estimatedDays[datePreset] || 30
    // Incremento pode ser numero de dias (1, 7, etc)
    const increment = typeof timeIncrement === 'number' ? timeIncrement : parseInt(String(timeIncrement), 10) || 1
    const intervalsPerAd = Math.ceil(days / increment)

    // ~1000 insight-records seguros por pagina (conservador com 100+ campos por record)
    const calculated = Math.floor(1000 / intervalsPerAd)

    // Clamp entre 25 (minimo util) e 200 (maximo seguro para /ads)
    return Math.max(25, Math.min(200, calculated))
  }

  /**
   * Busca com timeout maior para o endpoint /ads
   */
  private async fetchAllPagesWithLongerTimeout(baseUrl: string): Promise<any[]> {
    const allData: any[] = []
    let nextUrl: string | null = baseUrl
    let pageCount = 0

    while (nextUrl) {
      pageCount++
      this.logger.log(`  Buscando pagina ${pageCount} de ads...`)

      // Timeout maior para /ads (90s)
      const result = await this.fetchWithRetry(nextUrl, 3, 90000)
      const pageAds = result.data || []
      allData.push(...pageAds)

      this.logger.log(`  Pagina ${pageCount}: ${pageAds.length} ads (total: ${allData.length})`)

      nextUrl = result.paging?.next || null

      if (nextUrl) {
        await this.sleep(500) // Delay maior entre paginas
      }
    }

    return allData
  }
}
