import { Injectable } from '@nestjs/common'
import { PrismaService } from 'src/database/prisma.service'
import { MetaAdsMapper } from '../mappers/meta-ads.mapper'
import { MetaVideoSourceService } from '../services/meta-video-source.service'
import { BaseSyncStrategy } from './base-sync.strategy'
import { BreakdownSyncResult, SyncResult } from '../interfaces/meta-ads.interfaces'
import { BREAKDOWN_INSIGHT_FIELDS, SUPPORTED_BREAKDOWNS } from '../constants/meta-ads.constants'

const UPDATE_CHUNK_SIZE = 50

/**
 * Estrategia de sincronizacao de breakdowns do Meta ADS
 * Itera sobre os 5 breakdown types sequencialmente,
 * buscando dados via /insights e salvando em AdsBreakdownPerformance
 */
@Injectable()
export class BreakdownSyncStrategy extends BaseSyncStrategy {
  constructor(
    prisma: PrismaService,
    mapper: MetaAdsMapper,
    videoSource: MetaVideoSourceService
  ) {
    super(prisma, mapper, videoSource, 'BreakdownSyncStrategy')
  }

  /**
   * Implementacao obrigatoria de BaseSyncStrategy (nao usada diretamente)
   */
  async sync(
    companyId: string,
    adAccountId: string,
    accessToken: string,
    datePreset: string,
  ): Promise<SyncResult> {
    const result = await this.syncBreakdowns(companyId, adAccountId, accessToken, datePreset)
    return { synced: result.synced, errors: result.errors }
  }

  /**
   * Sincroniza todos os breakdowns suportados
   * Itera sequencialmente sobre age, gender, publisher_platform, device_platform, country
   */
  async syncBreakdowns(
    companyId: string,
    adAccountId: string,
    accessToken: string,
    datePreset: string,
  ): Promise<BreakdownSyncResult> {
    this.logger.log(`=== BREAKDOWN SYNC STRATEGY ===`)
    this.logger.log(`Company ID: ${companyId}`)
    this.logger.log(`Date Preset: ${datePreset}`)
    this.logger.log(`Breakdowns: ${SUPPORTED_BREAKDOWNS.join(', ')}`)

    const result: BreakdownSyncResult = {
      synced: 0,
      errors: 0,
      breakdowns: [],
    }

    for (let i = 0; i < SUPPORTED_BREAKDOWNS.length; i++) {
      const breakdownType = SUPPORTED_BREAKDOWNS[i]
      this.logger.log(`\n--- Breakdown ${i + 1}/${SUPPORTED_BREAKDOWNS.length}: ${breakdownType} ---`)

      try {
        const breakdownResult = await this.syncSingleBreakdown(
          companyId,
          adAccountId,
          accessToken,
          datePreset,
          breakdownType,
        )

        result.synced += breakdownResult.synced
        result.errors += breakdownResult.errors
        result.breakdowns.push({
          type: breakdownType,
          synced: breakdownResult.synced,
          errors: breakdownResult.errors,
        })
      } catch (error) {
        // Token morto vale para TODOS os breakdowns — nao adianta tentar o proximo.
        this.rethrowIfMetaAuthError(error)
        this.logger.error(`Erro no breakdown ${breakdownType}: ${error.message}`)
        result.errors++
        result.breakdowns.push({
          type: breakdownType,
          synced: 0,
          errors: 1,
        })
      }

      // Rate limiting: 2s delay entre breakdown types
      if (i < SUPPORTED_BREAKDOWNS.length - 1) {
        this.logger.log(`Aguardando 2s antes do proximo breakdown...`)
        await this.sleep(2000)
      }
    }

    this.logger.log(`\n=== BREAKDOWN SYNC COMPLETO ===`)
    this.logger.log(`Total: ${result.synced} synced, ${result.errors} errors`)
    for (const b of result.breakdowns) {
      this.logger.log(`  ${b.type}: ${b.synced} synced, ${b.errors} errors`)
    }

    return result
  }

  /**
   * Sincroniza um unico breakdown type
   */
  private async syncSingleBreakdown(
    companyId: string,
    adAccountId: string,
    accessToken: string,
    datePreset: string,
    breakdownType: string,
  ): Promise<{ synced: number; errors: number }> {
    // Monta params da requisicao
    const params = new URLSearchParams({
      level: 'ad',
      fields: BREAKDOWN_INSIGHT_FIELDS.join(','),
      access_token: accessToken,
      limit: '200',
      date_preset: datePreset,
      breakdowns: breakdownType,
    })

    const url = `${this.META_API_BASE}/${this.META_API_VERSION}/${adAccountId}/insights?${params.toString()}`
    this.logger.log(`URL (sem token): ${this.redactToken(url)}`)

    // Fetch all pages with async fallback
    const allInsights = await this.fetchAllPagesWithAsyncFallback(
      url,
      adAccountId,
      accessToken,
      params,
    )

    this.logger.log(`${breakdownType}: ${allInsights.length} registros da API Meta`)

    if (allInsights.length === 0) {
      return { synced: 0, errors: 0 }
    }

    // Get date range for batch fetch
    const { start: periodStart, end: periodEnd } = this.getDateRangeFromPreset(datePreset)

    // Batch fetch existing records from AdsBreakdownPerformance
    const existingMap = await this.batchFetchExistingBreakdowns(
      companyId,
      breakdownType,
      periodStart,
      periodEnd,
    )

    // Classify into creates vs updates
    const toCreate: any[] = []
    const toUpdate: { id: bigint; data: any }[] = []
    let errors = 0

    for (const insight of allInsights) {
      try {
        const data = this.mapper.mapBreakdownToDatabase(insight, companyId, breakdownType)
        const lookupKey = this.buildBreakdownLookupKey(
          companyId,
          insight.ad_id,
          new Date(insight.date_start),
          new Date(insight.date_stop),
          breakdownType,
          data.breakdownValue,
        )

        const existingId = existingMap.get(lookupKey)

        if (existingId) {
          toUpdate.push({ id: existingId, data })
        } else {
          toCreate.push(data)
        }
      } catch (error) {
        this.logger.error(`Erro ao processar insight de breakdown: ${error.message}`)
        errors++
      }
    }

    // Batch save
    const { created, updated } = await this.batchSaveBreakdowns(toCreate, toUpdate)
    const synced = created + updated

    this.logger.log(`${breakdownType}: ${synced} synced (${created} new, ${updated} updated), ${errors} errors`)
    return { synced, errors }
  }

  /**
   * Gera lookup key para breakdown: companyId|adId|startDate|endDate|type|value
   */
  private buildBreakdownLookupKey(
    companyId: string,
    adId: string | null,
    startDate: Date,
    endDate: Date,
    breakdownType: string,
    breakdownValue: string,
  ): string {
    const startStr = startDate.toISOString().split('T')[0]
    const endStr = endDate.toISOString().split('T')[0]
    return `${companyId}|${adId || ''}|${startStr}|${endStr}|${breakdownType}|${breakdownValue}`
  }

  /**
   * Batch fetch existing breakdown records
   */
  private async batchFetchExistingBreakdowns(
    companyId: string,
    breakdownType: string,
    dateStart: Date,
    dateEnd: Date,
  ): Promise<Map<string, bigint>> {
    const existing = await this.prisma.adsBreakdownPerformance.findMany({
      where: {
        companyId,
        breakdownType,
        reportStartDate: { gte: dateStart },
        reportEndDate: { lte: dateEnd },
      },
      select: {
        id: true,
        adId: true,
        reportStartDate: true,
        reportEndDate: true,
        breakdownType: true,
        breakdownValue: true,
      },
    })

    const map = new Map<string, bigint>()
    for (const record of existing) {
      const key = this.buildBreakdownLookupKey(
        companyId,
        record.adId,
        record.reportStartDate,
        record.reportEndDate,
        record.breakdownType,
        record.breakdownValue,
      )
      map.set(key, record.id)
    }

    this.logger.log(`Breakdown lookup: ${existing.length} registros existentes (${map.size} chaves unicas)`)
    return map
  }

  /**
   * Batch save breakdown records: createMany + chunked updates
   */
  private async batchSaveBreakdowns(
    toCreate: any[],
    toUpdate: { id: bigint; data: any }[],
  ): Promise<{ created: number; updated: number }> {
    let created = 0
    let updated = 0

    if (toCreate.length > 0) {
      await this.prisma.adsBreakdownPerformance.createMany({
        data: toCreate,
        skipDuplicates: true,
      })
      created = toCreate.length
      this.logger.log(`Breakdown batch create: ${created} novos registros`)
    }

    if (toUpdate.length > 0) {
      for (let i = 0; i < toUpdate.length; i += UPDATE_CHUNK_SIZE) {
        const chunk = toUpdate.slice(i, i + UPDATE_CHUNK_SIZE)
        await this.prisma.$transaction(
          chunk.map(item =>
            this.prisma.adsBreakdownPerformance.update({
              where: { id: item.id },
              data: item.data,
            })
          )
        )
        updated += chunk.length
      }
      this.logger.log(`Breakdown batch update: ${updated} registros atualizados`)
    }

    return { created, updated }
  }
}
