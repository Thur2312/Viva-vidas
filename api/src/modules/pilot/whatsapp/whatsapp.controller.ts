import { Body, Controller, Get, Header, HttpCode, Post } from '@nestjs/common'
import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator'
import { NoTenant } from '../../auth/no-tenant.decorator'
import { Roles } from '../../panel-auth/roles.decorator'
import { ChatGatewayService } from '../../chat-gateway/chat-gateway.service'

export class ConnectOfficialDto {
  @IsString() @Matches(/^\d{5,30}$/, { message: 'Phone Number ID inválido (só números).' }) phoneNumberId!: string
  @IsString() @Matches(/^\d{5,30}$/, { message: 'WABA ID inválido (só números).' }) wabaId!: string
  @IsString() @MinLength(20) @MaxLength(1000) @Matches(/^\S+$/, { message: 'Token inválido.' }) accessToken!: string
  @IsOptional() @IsString() @MaxLength(80) name?: string
}

/** Conexão do WhatsApp: QR (Baileys, não oficial) e API oficial (Cloud API da Meta). O QR é credencial de sessão: só o dono do painel vê, e nunca é cacheado. */
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

  /** Cadastra a API oficial. Só o dono; o token segue direto ao chat e nunca é gravado nem devolvido aqui. */
  @NoTenant() @Roles('owner') @Post('connection/official') @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  official(@Body() dto: ConnectOfficialDto) { return this.chat.connectOfficial(dto) }
}
