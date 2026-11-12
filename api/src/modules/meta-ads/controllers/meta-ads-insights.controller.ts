import { Controller, Get, Post, Body, Query } from '@nestjs/common'
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger'
import { MetaAdsService } from '../services/meta-ads.service'
import { MetaInsightData, MetaCampaignInsight, MetaAdSetInsight, SyncResult, BreakdownSyncResult } from '../interfaces/meta-ads.interfaces'
import { DatePreset, SyncMetaInsightsDto, SyncBreakdownsDto } from '../dto/fetch-insights.dto'

@ApiTags('Meta ADS')
@Controller('meta-ads')
export class MetaAdsInsightsController {
  constructor(
    private readonly metaAdsService: MetaAdsService,
  ) {}

  @Get('insights')
  @ApiOperation({ summary: 'Busca insights do Meta em tempo real (nivel anuncio)' })
  @ApiQuery({ name: 'companyId', required: true })
  @ApiQuery({ name: 'datePreset', required: false, enum: DatePreset })
  @ApiQuery({ name: 'startDate', required: false, description: 'YYYY-MM-DD' })
  @ApiQuery({ name: 'endDate', required: false, description: 'YYYY-MM-DD' })
  async getInsights(
    @Query('companyId') companyId: string,
    @Query('datePreset') datePreset?: DatePreset,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ): Promise<MetaInsightData[]> {
    return this.metaAdsService.fetchInsights({
      companyId,
      datePreset,
      startDate,
      endDate,
    })
  }

  @Get('insights/campaigns')
  @ApiOperation({ summary: 'Busca insights agrupados por campanha' })
  @ApiQuery({ name: 'companyId', required: true })
  @ApiQuery({ name: 'datePreset', required: false, enum: DatePreset })
  async getInsightsByCampaign(
    @Query('companyId') companyId: string,
    @Query('datePreset') datePreset?: DatePreset,
  ): Promise<MetaCampaignInsight[]> {
    return this.metaAdsService.fetchInsightsByCampaign({
      companyId,
      datePreset,
    })
  }

  @Get('insights/adsets')
  @ApiOperation({ summary: 'Busca insights agrupados por conjunto de anuncios' })
  @ApiQuery({ name: 'companyId', required: true })
  @ApiQuery({ name: 'datePreset', required: false, enum: DatePreset })
  async getInsightsByAdSet(
    @Query('companyId') companyId: string,
    @Query('datePreset') datePreset?: DatePreset,
  ): Promise<MetaAdSetInsight[]> {
    return this.metaAdsService.fetchInsightsByAdSet({
      companyId,
      datePreset,
    })
  }

  @Post('sync')
  @ApiOperation({ summary: 'Sincroniza dados do Meta com AdsPerformance' })
  async syncInsights(@Body() dto: SyncMetaInsightsDto): Promise<SyncResult> {
    return this.metaAdsService.syncInsightsToDatabase(dto)
  }

  @Post('sync-breakdowns')
  @ApiOperation({ summary: 'Sincroniza breakdowns do Meta com AdsBreakdownPerformance' })
  async syncBreakdowns(@Body() dto: SyncBreakdownsDto): Promise<BreakdownSyncResult> {
    return this.metaAdsService.syncBreakdownsToDatabase(dto)
  }
}
