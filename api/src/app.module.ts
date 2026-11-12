import { Module } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'
import { ConfigModule } from '@nestjs/config'
import { ScheduleModule } from '@nestjs/schedule'
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler'
import { JwtAuthGuard } from './modules/auth/jwt-auth.guard'
import { TenantGuard } from './modules/auth/tenant.guard'
import { AuthModule } from './modules/auth/auth.module'
import { DatabaseModule } from './database/database.module'
import { RedisModule } from './shared/redis/redis.module'
import { SharedModule } from './shared/shared.module'
import { SharedRabbitMQModule } from './shared/rabbitmq/shared-rabbitmq.module'
import { FilesModule } from './modules/files/files.module'
import { MetaAdsModule } from './modules/meta-ads/meta-ads.module'
import { AdsPerformanceModule } from './modules/ads-performance/ads-performance.module'
import { MetaWebhookModule } from './modules/meta-webhook/meta-webhook.module'
import { TrackingModule } from './modules/admin/tracking/tracking.module'
import { PilotModule } from './modules/pilot/pilot.module'
import { VoiceModule } from './modules/voice/voice.module'
import { HealthController } from './health.controller'
import { PanelAuthModule } from './modules/panel-auth/panel-auth.module'
import { RolesGuard } from './modules/panel-auth/roles.guard'

// PILOT_ONLY=true: sobe so Config, Throttler, Schedule (retencao e worker de disparos), Auth, PanelAuth, Pilot, Voice (+ Health), sem Redis/RabbitMQ/Prisma.
// Lido na avaliacao do modulo; main.ts carrega o .env antes de importar este arquivo.
const PILOT_ONLY = process.env.PILOT_ONLY === 'true'

const coreImports = [
  ConfigModule.forRoot({ isGlobal: true }),
  ThrottlerModule.forRoot([{ ttl: 900000, limit: 1500 }]),
]
const fullImports = [
  ScheduleModule.forRoot(),
  SharedRabbitMQModule,
  SharedModule,
  RedisModule,
  DatabaseModule,
  AuthModule,
  FilesModule,
  MetaAdsModule,
  AdsPerformanceModule,
  MetaWebhookModule,
  TrackingModule,
]

@Module({
  imports: PILOT_ONLY
    ? [...coreImports, ScheduleModule.forRoot(), AuthModule, PanelAuthModule, PilotModule, VoiceModule]
    : [...coreImports, ...fullImports, PanelAuthModule, PilotModule, VoiceModule],
  controllers: [HealthController],
  providers: [
    // JWT global; use @Public() nas rotas abertas (webhooks, /track, OAuth callback).
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: TenantGuard },
    // RBAC por papel (@Roles) depois da autenticacao e do tenant.
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
