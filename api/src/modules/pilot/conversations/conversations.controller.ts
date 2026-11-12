import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { NoTenant } from '../../auth/no-tenant.decorator'
import { Roles } from '../../panel-auth/roles.decorator'
import { requestCtx } from '../compliance/audit.service'
import { ConversationsService } from './conversations.service'
import { ListConversationsQuery, MessagesQuery, SendMessageDto, StatsQuery } from './conversations.dto'

/** Painel de conversas (JWT). Leitura: qualquer papel. Envio: manager ou owner. Tenant resolvido no servidor (PILOT_TENANT). */
@Controller('pilot/conversations')
export class ConversationsController {
  constructor(private readonly svc: ConversationsService) {}

  @NoTenant() @Roles('viewer') @Get()
  list(@Query() q: ListConversationsQuery) {
    return this.svc.list(q)
  }

  @NoTenant() @Roles('viewer') @Get('stats')
  stats(@Query() q: StatsQuery) {
    return this.svc.stats(q.from, q.to)
  }

  // Lê conteúdo de mensagens: auditado (service) e com limite próprio (a tela atualiza a cada 15 s).
  @NoTenant() @Roles('viewer') @Throttle({ default: { limit: 60, ttl: 60_000 } }) @Get(':id/messages')
  messages(@Param('id', ParseUUIDPipe) id: string, @Query() q: MessagesQuery, @Req() req: any) {
    return this.svc.messages(id, { before: q.before, limit: q.limit }, requestCtx(req))
  }

  @NoTenant() @Roles('manager') @Throttle({ default: { limit: 20, ttl: 60_000 } }) @Post(':id/messages')
  send(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SendMessageDto, @Req() req: any) {
    return this.svc.send(id, dto.body, requestCtx(req))
  }
}
