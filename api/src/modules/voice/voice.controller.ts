import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query, Req } from '@nestjs/common'
import { NoTenant } from '../auth/no-tenant.decorator'
import { Roles } from '../panel-auth/roles.decorator'
import { ROLE_RANK, isPanelRole } from '../panel-auth/panel-roles'
import { requestCtx } from '../pilot/compliance/audit.service'
import { VoiceService } from './voice.service'
import { VoiceSettingsService } from './voice-settings.service'
import { ListCallsQuery, PlaceCallDto, UpdateSettingsDto } from './voice.dto'

/**
 * Painel de voz (JWT + papéis). Servido em `/voice/*` e também em `/pilot/voice/*`, que é o prefixo
 * que o BFF do painel (`/api/pilot/[...path]`) encaminha ao backend.
 */
@Controller(['voice', 'pilot/voice'])
@NoTenant()
export class VoiceController {
  constructor(private readonly voice: VoiceService, private readonly settings: VoiceSettingsService) {}

  @Roles('viewer') @Get('status')
  status() {
    return this.voice.status()
  }

  @Roles('viewer') @Get('calls')
  list(@Query() q: ListCallsQuery) {
    return this.voice.list(q)
  }

  @Roles('viewer') @Get('calls/:id')
  get(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    const role = req?.user?.role
    // Transcrição = dado de saúde potencial (LGPD art. 11): só manager+; a leitura é auditada no serviço.
    const canSee = isPanelRole(role) && ROLE_RANK[role] >= ROLE_RANK.manager
    return this.voice.get(id, requestCtx(req), canSee)
  }

  @Roles('manager') @Post('calls')
  place(@Body() dto: PlaceCallDto, @Req() req: any) {
    return this.voice.placeCall(dto.leadId, requestCtx(req))
  }

  @Roles('viewer') @Get('settings')
  getSettings() {
    return this.settings.get()
  }

  @Roles('owner') @Put('settings')
  putSettings(@Body() dto: UpdateSettingsDto, @Req() req: any) {
    return this.settings.put(dto, requestCtx(req))
  }
}
