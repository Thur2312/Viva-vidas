import { Body, Controller, Delete, Get, Param, Post, Put, Query, Req } from '@nestjs/common'
import { TrackingService } from './tracking.service'
import { TrackingAnalyticsService } from './services/tracking-analytics.service'
import { TrackingActionConfigService } from './services/tracking-action-config.service'
import {
  TrackingActionActor,
  TrackingActionConfigAuditService,
} from './services/tracking-action-config-audit.service'
import {
  RequestProvenance,
  RequestProvenanceData,
} from 'src/modules/admin/decorators/request-provenance.decorator'
import { RequestWithUser } from 'src/shared/util/active-company.utils'
import { CollectEventDto } from './dto/create-tracking.dto'
import { FilterTrackingActionsDto } from './dto/filter-tracking-actions.dto'
import { FilterTrackingEventsDto } from './dto/filter-tracking-events.dto'
import { UpsertTrackingActionConfigDto } from './dto/tracking-action-config.dto'
import { ApiTags } from '@nestjs/swagger'
import { Roles } from 'src/modules/panel-auth/roles.decorator'
import { Public } from 'src/modules/auth/public.decorator'
import { SkipLogging } from 'src/shared/decorators/skip-logging.decorator'

@ApiTags('Tracking')
// Evento de tracking JA e o registro — gravar uma linha em `Logs` a cada POST duplica na
// tabela de auditoria o que a `Tracking` guarda melhor. Sao 202.852 linhas no dump
// (`/tracking/collect/orion` + `/tracking/:id` + `create-tracking-event`), todas de maquina.
// Mesmo criterio (e mesmo decorator) ja aplicado no `track.controller.ts`.
@SkipLogging()
@Roles('owner')
@Controller('tracking')
export class TrackingController {
  constructor(
    private readonly trackingService: TrackingService,
    private readonly trackingAnalyticsService: TrackingAnalyticsService,
    private readonly trackingActionConfigService: TrackingActionConfigService,
    private readonly trackingActionConfigAuditService: TrackingActionConfigAuditService,
  ) {}

  /**
   * Quem esta editando, do JWT e da propria request — NUNCA do corpo.
   *
   * O `POST /triggers/body-change-logs` ainda recebe `userId`/`userName` pelo
   * body, e uma trilha que o proprio cliente assina nao prova nada. O
   * `prov.ip` sai do `resolveClientIp`, que varre o `X-Forwarded-For` da direita
   * para a esquerda pulando proxy nosso; ler a ponta esquerda deixaria qualquer
   * um escolher o IP que aparece no historico.
   *
   * `req.user` e a linha `Users` inteira (menos senha), mas a interface
   * `RequestWithUser` so declara `id`/`email` — dai o alargamento local.
   */
  private resolveActor(
    req: RequestWithUser,
    prov: RequestProvenanceData,
  ): TrackingActionActor {
    const user = req?.user as (RequestWithUser['user'] & { name?: string }) | undefined

    return {
      userId: user?.id ?? null,
      userName: user?.name ?? null,
      userEmail: user?.email ?? null,
      ipAddress: prov?.ip || null,
      userAgent: prov?.userAgent || null,
    }
  }

  @Get('list/:companyId')
  async getLeadTracking(
    @Param('companyId') companyId: string,
    @Query('email') email: string,
    @Query('phone') phone: string,
  ) {
    return this.trackingService.getLeadTracking(email, phone, companyId)
  }

  // Tracker v5 — endpoint /collect recebe eventos do tracker.js (público, sem auth)
  @Public()
  @Post('collect/:subdomain')
  async collectEvent(@Param('subdomain') subdomain: string, @Body() collectDto: CollectEventDto) {
    return this.trackingService.collectEvent(collectDto, subdomain)
  }

  // ==================== ANALYTICS (aba Tracking em /analysis) ====================

  @Get('events/filter/:companyId')
  async filterTrackingEvents(
    @Param('companyId') companyId: string,
    @Query() filters: FilterTrackingEventsDto,
  ) {
    return this.trackingAnalyticsService.filterTrackingEvents(companyId, filters)
  }

  @Get('events/visitor/:companyId/:visitorId')
  async getVisitorTimeline(
    @Param('companyId') companyId: string,
    @Param('visitorId') visitorId: string,
  ) {
    return this.trackingAnalyticsService.getVisitorTimeline(companyId, visitorId)
  }

  @Get('events/filter-options/:companyId')
  async getTrackingFilterOptions(@Param('companyId') companyId: string) {
    return this.trackingAnalyticsService.getTrackingFilterOptions(companyId)
  }

  // Sub-aba "Acoes" — le da tabela Tracking (OPTINs e acoes de alunos).
  @Get('actions/filter/:companyId')
  async filterTrackingActions(
    @Param('companyId') companyId: string,
    @Query() filters: FilterTrackingActionsDto,
  ) {
    return this.trackingAnalyticsService.filterTrackingActions(companyId, filters)
  }

  @Get('actions/filter-options/:companyId')
  async getTrackingActionsFilterOptions(@Param('companyId') companyId: string) {
    return this.trackingAnalyticsService.getTrackingActionsFilterOptions(companyId)
  }

  // Catalogo: o que cada acao vira quando chega na Meta, e quanto vale.
  // Le e escreve o mesmo conjunto de acoes que a sub-aba "Acoes" de /analysis lista.
  // `campaignId` ausente = padrao da empresa. Chamador antigo continua valendo.
  @Get('action-config/:companyId')
  async listTrackingActionConfig(
    @Param('companyId') companyId: string,
    @Query('campaignId') campaignId?: string,
  ) {
    return this.trackingActionConfigService.list(companyId, campaignId)
  }

  // Quais campanhas sobrescrevem o padrao, e em quais acoes. Nao colide com o
  // GET de um escopo so: aquele e `action-config/:companyId`, este tem um
  // segmento a mais.
  @Get('action-config/:companyId/scopes')
  async listTrackingActionScopes(@Param('companyId') companyId: string) {
    return this.trackingActionConfigService.listScopes(companyId)
  }

  // Historico de quem editou o catalogo, e o que mudou campo a campo.
  //
  // O parametro e `scope` e NAO `campaignId` de proposito: nas rotas acima
  // `campaignId` ausente significa "padrao da empresa", e aqui ausente significa
  // "todos os escopos", que e o que a abertura do painel pede. Reusar o nome
  // plantaria uma armadilha silenciosa. `scope=company` pede o padrao da empresa.
  @Get('action-config/:companyId/changes')
  async listTrackingActionConfigChanges(
    @Param('companyId') companyId: string,
    @Query('scope') scope?: string,
    @Query('action') action?: string,
    @Query('skip') skip?: string,
    @Query('take') take?: string,
  ) {
    return this.trackingActionConfigAuditService.list(companyId, {
      scope,
      action,
      skip: skip ? parseInt(skip, 10) : 0,
      take: take ? parseInt(take, 10) : undefined,
    })
  }

  @Put('action-config/:companyId')
  async upsertTrackingActionConfig(
    @Param('companyId') companyId: string,
    @Body() dto: UpsertTrackingActionConfigDto,
    @Req() req: RequestWithUser,
    @RequestProvenance() prov: RequestProvenanceData,
    @Query('campaignId') campaignId?: string,
  ) {
    return this.trackingActionConfigService.upsertMany(
      companyId,
      dto.items,
      campaignId,
      this.resolveActor(req, prov),
    )
  }

  @Delete('action-config/:companyId/:action')
  async removeTrackingActionConfig(
    @Param('companyId') companyId: string,
    @Param('action') action: string,
    @Req() req: RequestWithUser,
    @RequestProvenance() prov: RequestProvenanceData,
    @Query('campaignId') campaignId?: string,
  ) {
    return this.trackingActionConfigService.remove(
      companyId,
      action,
      campaignId,
      this.resolveActor(req, prov),
    )
  }
}
