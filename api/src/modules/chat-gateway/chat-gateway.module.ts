import { Module } from '@nestjs/common'
import { ChatGatewayService } from './chat-gateway.service'

@Module({ providers: [ChatGatewayService], exports: [ChatGatewayService] })
export class ChatGatewayModule {}
