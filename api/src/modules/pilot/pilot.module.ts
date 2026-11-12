import { Module } from '@nestjs/common'
import { ChatGatewayModule } from '../chat-gateway/chat-gateway.module'
import { PgService } from './pg.service'
import { PilotService } from './pilot.service'
import { ShadowService } from './shadow.service'
import { PilotController } from './pilot.controller'
import { PilotKeyGuard } from './pilot-key.guard'
import { AuditService } from './compliance/audit.service'
import { ConsentService } from './compliance/consent.service'
import { CryptoService } from './compliance/crypto.service'
import { DataSubjectService } from './compliance/data-subject.service'
import { LearningService } from './compliance/learning.service'
import { RetentionService } from './compliance/retention.service'
import { ConversationsController } from './conversations/conversations.controller'
import { ConversationsService } from './conversations/conversations.service'
import { BROADCASTS_PROVIDERS, BroadcastsController } from './broadcasts/broadcasts.module-parts'

@Module({
  imports: [ChatGatewayModule],
  controllers: [PilotController, BroadcastsController, ConversationsController],
  providers: [
    ...BROADCASTS_PROVIDERS,
    PgService, PilotService, ShadowService, PilotKeyGuard,
    CryptoService, AuditService, ConsentService, DataSubjectService, LearningService, RetentionService, ConversationsService,
  ],
  exports: [PilotService, ConsentService, AuditService],
})
export class PilotModule {}
