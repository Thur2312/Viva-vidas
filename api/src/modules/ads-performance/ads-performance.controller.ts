import { Controller, Get, Post, Body, Query } from '@nestjs/common'
import { Roles } from 'src/modules/panel-auth/roles.decorator'
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger'
import {
  AdsPerformanceService,
  AvailableAdsResponse,
  PaginatedAvailableAdsResponse,
  SortField,
  SortOrder,
  FilterHasLeads,
} from './ads-performance.service'
import { LinkAdsDto, UnlinkAdsDto } from './dto/link-ads.dto'
import { GetAvailableAdsDto } from './dto/get-available-ads.dto'

@ApiTags('ADS Performance')
@Roles('owner')
@Controller('ads-performance')
export class AdsPerformanceController {
  constructor(private readonly adsPerformanceService: AdsPerformanceService) {}

  @Get('available')
  @ApiOperation({ summary: 'Lista campanhas Meta agrupadas por disponibilidade (paginado)' })
  @ApiQuery({ name: 'companyId', required: true })
  @ApiQuery({ name: 'campaignId', required: false, description: 'ID da campanha HDM para verificar vinculos' })
  @ApiQuery({ name: 'search', required: false, description: 'Termo de busca' })
  @ApiQuery({ name: 'sortField', required: false, enum: ['name', 'date', 'spent', 'impressions', 'clicks', 'leads'] })
  @ApiQuery({ name: 'sortOrder', required: false, enum: ['asc', 'desc'] })
  @ApiQuery({ name: 'filterHasLeads', required: false, enum: ['all', 'yes', 'no'] })
  @ApiQuery({ name: 'filterObjective', required: false, description: 'Filtro por objetivo Meta' })
  @ApiQuery({ name: 'filterStatus', required: false, description: 'Filtro por status de entrega' })
  @ApiQuery({ name: 'page', required: false, description: 'Página atual (começa em 1)' })
  @ApiQuery({ name: 'pageSize', required: false, description: 'Itens por página' })
  async getAvailableCampaigns(
    @Query() query: GetAvailableAdsDto,
  ): Promise<PaginatedAvailableAdsResponse> {
    return this.adsPerformanceService.getAvailableCampaignsPaginated({
      companyId: query.companyId,
      hdmCampaignId: query.campaignId,
      search: query.search,
      sortField: query.sortField as SortField,
      sortOrder: query.sortOrder as SortOrder,
      filterHasLeads: query.filterHasLeads as FilterHasLeads,
      filterObjective: query.filterObjective,
      filterStatus: query.filterStatus,
      page: query.page ? parseInt(query.page, 10) : 1,
      pageSize: query.pageSize ? parseInt(query.pageSize, 10) : 10,
    })
  }

  @Post('link')
  @ApiOperation({ summary: 'Vincula campanhas Meta a uma campanha HDM' })
  async linkAds(@Body() dto: LinkAdsDto): Promise<{ linked: number }> {
    return this.adsPerformanceService.linkAdsToCampaign(dto.campaignId, dto.externalCampaignIds)
  }

  @Post('unlink')
  @ApiOperation({ summary: 'Desvincula campanhas Meta de uma campanha HDM' })
  async unlinkAds(@Body() dto: UnlinkAdsDto): Promise<{ unlinked: number }> {
    return this.adsPerformanceService.unlinkAdsFromCampaign(dto.campaignId, dto.externalCampaignIds)
  }
}
