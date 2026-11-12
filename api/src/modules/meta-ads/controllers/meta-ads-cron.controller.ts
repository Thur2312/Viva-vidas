import { Controller, Get, Post, Put, Body, Param, ParseIntPipe } from '@nestjs/common'
import { ApiTags, ApiOperation, ApiBody } from '@nestjs/swagger'
import { MetaAdsCronService } from '../services/meta-ads-cron.service'
import { UpdateCronSettingsDto } from '../dto/fetch-insights.dto'

@ApiTags('Meta ADS')
@Controller('meta-ads')
export class MetaAdsCronController {
  constructor(
    private readonly metaAdsCronService: MetaAdsCronService,
  ) {}

  @Put('cron/:integrationId')
  @ApiOperation({ summary: 'Atualiza configuracoes do cron job' })
  @ApiBody({ type: UpdateCronSettingsDto })
  async updateCronSettings(
    @Param('integrationId', ParseIntPipe) integrationId: number,
    @Body() dto: UpdateCronSettingsDto,
  ) {
    return this.metaAdsCronService.updateCronSettings(
      integrationId,
      dto.enabled,
      dto.interval,
    )
  }

  @Get('cron/:integrationId/status')
  @ApiOperation({ summary: 'Retorna status do cron job' })
  async getCronStatus(@Param('integrationId', ParseIntPipe) integrationId: number) {
    return this.metaAdsCronService.getCronStatus(integrationId)
  }

  @Post('cron/:integrationId/sync-now')
  @ApiOperation({ summary: 'Executa sincronizacao manual imediata' })
  async syncNow(@Param('integrationId', ParseIntPipe) integrationId: number) {
    return this.metaAdsCronService.executeManualSync(integrationId)
  }
}
