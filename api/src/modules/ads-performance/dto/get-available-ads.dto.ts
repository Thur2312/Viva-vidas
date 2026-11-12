import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsString, IsOptional, IsIn, IsNumberString } from 'class-validator'

export class GetAvailableAdsDto {
  @ApiProperty({ description: 'ID da empresa' })
  @IsString()
  companyId: string

  @ApiPropertyOptional({ description: 'ID da campanha HDM para verificar vínculos' })
  @IsOptional()
  @IsString()
  campaignId?: string

  @ApiPropertyOptional({ description: 'Termo de busca (nome ou ID da campanha)' })
  @IsOptional()
  @IsString()
  search?: string

  @ApiPropertyOptional({ description: 'Campo para ordenação', enum: ['name', 'date', 'spent', 'impressions', 'clicks', 'leads'] })
  @IsOptional()
  @IsIn(['name', 'date', 'spent', 'impressions', 'clicks', 'leads'])
  sortField?: 'name' | 'date' | 'spent' | 'impressions' | 'clicks' | 'leads'

  @ApiPropertyOptional({ description: 'Ordem de ordenação', enum: ['asc', 'desc'] })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc'

  @ApiPropertyOptional({ description: 'Filtro por leads', enum: ['all', 'yes', 'no'] })
  @IsOptional()
  @IsIn(['all', 'yes', 'no'])
  filterHasLeads?: 'all' | 'yes' | 'no'

  @ApiPropertyOptional({ description: 'Filtro por objetivo da campanha Meta (ex: OUTCOME_LEADS, OUTCOME_TRAFFIC)' })
  @IsOptional()
  @IsString()
  filterObjective?: string

  @ApiPropertyOptional({ description: 'Filtro por status de entrega', enum: ['all', 'active', 'inactive', 'not_delivering'] })
  @IsOptional()
  @IsString()
  filterStatus?: string

  @ApiPropertyOptional({ description: 'Página atual (começa em 1)', default: '1' })
  @IsOptional()
  @IsNumberString()
  page?: string

  @ApiPropertyOptional({ description: 'Itens por página', default: '10' })
  @IsOptional()
  @IsNumberString()
  pageSize?: string
}
