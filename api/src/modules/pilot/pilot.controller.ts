import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common'
import { Public } from '../auth/public.decorator'
import { NoTenant } from '../auth/no-tenant.decorator'
import { Roles } from '../panel-auth/roles.decorator'
import { PilotKeyGuard } from './pilot-key.guard'
import { PilotService } from './pilot.service'
import { ShadowService } from './shadow.service'
import { AuditService, requestCtx } from './compliance/audit.service'
import { ConsentService } from './compliance/consent.service'
import { ConsentDto, CorrectLeadDto, RevokeConsentDto } from './compliance/compliance.dto'
import { DataSubjectService } from './compliance/data-subject.service'
import { RetentionService } from './compliance/retention.service'
import { CreateLeadDto, EventDto, IngestMessageDto, ListLeadsQuery, PeriodQuery, QualificationDto, ShadowRunDto } from './pilot.dto'

/**
 * Ingestão (chat e agente → API): @Public + x-pilot-key. Sem PILOT_API_KEY a rota fica fechada.
 * Leitura (painel → API): JWT obrigatório. @NoTenant porque o piloto é de um único cliente,
 * resolvido por PILOT_TENANT no servidor, nunca por parâmetro do request.
 */
@Controller('pilot')
export class PilotController {
  constructor(
    private readonly pilot: PilotService,
    private readonly shadow: ShadowService,
    private readonly subjects: DataSubjectService,
    private readonly consents: ConsentService,
    private readonly retention: RetentionService,
    private readonly audit: AuditService,
  ) {}

  // ───── Ingestão ─────
  @Public() @NoTenant() @UseGuards(PilotKeyGuard) @Post('leads')
  createLead(@Body() dto: CreateLeadDto) {
    return this.pilot.upsertLead(dto)
  }

  @Public() @NoTenant() @UseGuards(PilotKeyGuard) @Post('ingest/message')
  ingest(@Body() dto: IngestMessageDto) {
    return this.pilot.ingestMessage(dto)
  }

  @Public() @NoTenant() @UseGuards(PilotKeyGuard) @Post('events')
  event(@Body() dto: EventDto) {
    return this.pilot.registerEventByPhone(dto.phone, dto.type, { value: dto.value, actor: dto.actor, payload: dto.payload })
  }

  @Public() @NoTenant() @UseGuards(PilotKeyGuard) @Patch('leads/:id/qualification')
  qualification(@Param('id', ParseUUIDPipe) id: string, @Body() dto: QualificationDto) {
    return this.pilot.updateQualification(id, dto)
  }

  @Public() @NoTenant() @UseGuards(PilotKeyGuard) @Post('shadow/run')
  shadowRun(@Body() dto: ShadowRunDto) {
    return this.shadow.run(dto.conversationId)
  }

  // ───── Painel ─────
  @NoTenant() @Roles('viewer') @Get('overview')
  overview(@Query() q: PeriodQuery) {
    return this.pilot.overview(q.from, q.to)
  }

  @NoTenant() @Roles('viewer') @Get('leads')
  leads(@Query() q: ListLeadsQuery) {
    return this.pilot.listLeads(q)
  }

  @NoTenant() @Roles('viewer') @Get('leads/:id')
  lead(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    // Detalhe do lead: telefone completo e conteúdo das mensagens. A leitura fica na trilha de auditoria.
    return this.pilot.getLead(id, requestCtx(req))
  }

  // ───── LGPD: direitos do titular, consentimento, retenção e auditoria (JWT) ─────
  @NoTenant() @Roles('manager') @Get('leads/:id/export')
  exportLead(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    return this.subjects.exportLead(id, requestCtx(req))
  }

  @NoTenant() @Roles('manager') @Patch('leads/:id/data')
  correct(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CorrectLeadDto, @Req() req: any) {
    return this.subjects.correct(id, dto, requestCtx(req))
  }

  @NoTenant() @Roles('manager') @Post('leads/:id/anonymize')
  anonymize(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    return this.subjects.anonymizeLead(id, requestCtx(req))
  }

  @NoTenant() @Roles('manager') @Delete('leads/:id')
  erase(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    return this.subjects.eraseLead(id, requestCtx(req))
  }

  @NoTenant() @Roles('viewer') @Get('leads/:id/consents')
  async listConsents(@Param('id', ParseUUIDPipe) id: string) {
    return this.consents.list(id)
  }

  @NoTenant() @Roles('manager') @Post('leads/:id/consents')
  grantConsent(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ConsentDto, @Req() req: any) {
    return this.consents.grant(id, dto, requestCtx(req))
  }

  @NoTenant() @Roles('manager') @Post('leads/:id/consents/revoke')
  revokeConsent(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RevokeConsentDto, @Req() req: any) {
    return this.subjects.revokeConsent(id, dto.purpose, requestCtx(req))
  }

  @NoTenant() @Roles('manager') @Get('data-subject-requests')
  dsr(@Query('status') status?: string) {
    return this.subjects.listRequests({ status })
  }

  @NoTenant() @Roles('owner') @Post('retention/run')
  async runRetention(@Req() req: any) {
    return this.retention.run({ ctx: requestCtx(req) })
  }

  @NoTenant() @Roles('owner') @Get('audit-log')
  auditLog(@Query('limit') limit?: string, @Query('offset') offset?: string, @Query('action') action?: string) {
    return this.audit.list({ limit: Number(limit) || 50, offset: Number(offset) || 0, action })
  }

  @NoTenant() @Roles('viewer') @Get('campaigns')
  campaigns(@Query() q: PeriodQuery) {
    return this.pilot.campaigns(q.from, q.to)
  }

  @NoTenant() @Roles('viewer') @Get('readiness')
  async readiness() {
    return { shadow: this.shadow.status(), stages: await this.pilot.readiness() }
  }
}
