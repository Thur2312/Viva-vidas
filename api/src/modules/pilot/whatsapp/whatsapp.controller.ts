import { Controller, Get, Header, HttpCode, Post } from '@nestjs/common'
import { NoTenant } from '../../auth/no-tenant.decorator'
import { Roles } from '../../panel-auth/roles.decorator'
import { ChatGatewayService } from '../../chat-gateway/chat-gateway.service'

/** Conexão do WhatsApp (chat não oficial). O QR é credencial de sessão: só o dono do painel vê, e nunca é cacheado. */
@Controller('pilot/whatsapp')
export class WhatsappController {
  constructor(private readonly chat: ChatGatewayService) {}

  @NoTenant() @Roles('owner') @Get('connection')
  @Header('Cache-Control', 'no-store')
  connection() { return this.chat.connection() }

  /** Inicia a sessão (gera o QR). Só o dono; o chat garante que conectado não é derrubado. */
  @NoTenant() @Roles('owner') @Post('connection/start') @HttpCode(202)
  @Header('Cache-Control', 'no-store')
  start() { return this.chat.startConnection() }
}
