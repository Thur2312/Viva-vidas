import { BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common'
import { Public } from '../../auth/public.decorator'
import { NoTenant } from '../../auth/no-tenant.decorator'
import { Roles } from '../../panel-auth/roles.decorator'
import { PilotKeyGuard } from '../pilot-key.guard'
import { requestCtx } from '../compliance/audit.service'
import { BroadcastsService } from './broadcasts.service'
import { TemplatesService } from './templates.service'
import { HealthService } from './health.service'
import { BroadcastBodyDto, CreateBroadcastDto, CreateTemplateDto, PreviewDto, RecipientsQuery, StartDto, StatusWebhookDto, ResumeDto, QualityWebhookDto } from './broadcasts.dto'

/**
 * Disparos. Painel (JWT): leitura = viewer, operação = manager, criar template = owner.
 * Webhook de entrega (chat → API): @Public + x-pilot-key (mesma chave PILOT_API_KEY da ingestão).
 * Ordem das rotas importa: as estáticas (templates, webhook) vêm antes das ":id".
 */
@Controller('pilot/broadcasts')
export class BroadcastsController {
  constructor(private readonly svc: BroadcastsService, private readonly templates: TemplatesService, private readonly health: HealthService) {}

  @NoTenant() @Roles('viewer') @Get()
  list() { return this.svc.list() }

  @NoTenant() @Roles('viewer') @Get('templates')
  listTemplates(@Query('refresh') refresh?: string) { return this.templates.list(refresh === '1' || refresh === 'true') }

  @NoTenant() @Roles('owner') @Post('templates')
  createTemplate(@Body() dto: CreateTemplateDto, @Req() req: any) { return this.templates.create(dto, requestCtx(req)) }

  @NoTenant() @Roles('viewer') @Get('number-health')
  numberHealth() { return this.health.overview() }

  @Public() @NoTenant() @UseGuards(PilotKeyGuard) @Post('webhook/quality')
  quality(@Body() dto: QualityWebhookDto) { return this.health.onQualityWebhook(dto.event, dto.currentLimit) }

  @Public() @NoTenant() @UseGuards(PilotKeyGuard) @Post('webhook/status')
  status(@Body() dto: StatusWebhookDto) { return this.svc.applyStatus(dto.wid, dto.status, dto.errorCode) }

  @NoTenant() @Roles('manager') @Post()
  create(@Body() dto: CreateBroadcastDto, @Req() req: any) { return this.svc.create(dto, requestCtx(req)) }

  @NoTenant() @Roles('viewer') @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) { return this.svc.get(id) }

  @NoTenant() @Roles('manager') @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: BroadcastBodyDto, @Req() req: any) { return this.svc.update(id, dto, requestCtx(req)) }

  @NoTenant() @Roles('viewer') @Get(':id/recipients')
  recipients(@Param('id', ParseUUIDPipe) id: string, @Query() q: RecipientsQuery) { return this.svc.recipients(id, q) }

  @NoTenant() @Roles('manager') @Post(':id/audience/preview')
  preview(@Param('id', ParseUUIDPipe) id: string, @Body() dto: PreviewDto) { return this.svc.preview(id, dto) }

  @NoTenant() @Roles('manager') @Post(':id/start')
  start(@Param('id', ParseUUIDPipe) id: string, @Body() dto: StartDto, @Req() req: any) { return this.svc.start(id, dto, requestCtx(req)) }

  @NoTenant() @Roles('manager') @Post(':id/pause')
  pause(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) { return this.svc.pause(id, requestCtx(req)) }

  @NoTenant() @Roles('manager') @Post(':id/resume')
  resume(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ResumeDto, @Req() req: any) {
    if (dto.confirm !== true) throw new BadRequestException('Retomar exige confirmação (confirm: true).')
    return this.svc.resume(id, requestCtx(req))
  }

  @NoTenant() @Roles('manager') @Post(':id/cancel')
  cancel(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) { return this.svc.cancel(id, requestCtx(req)) }
}
