import { Module, Global, Logger } from '@nestjs/common'
import { ConfigModule, ConfigService } from '@nestjs/config'
import Redis from 'ioredis'
import { RedisService } from './redis.service'

const logger = new Logger('Redis')

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: 'REDIS_CLIENT',
      useFactory: (configService: ConfigService) => {
        const host = configService.get('REDIS_HOST') || 'localhost'
        const port = Number(configService.get('REDIS_PORT')) || 6379
        const passwordSet = !!configService.get('REDIS_PASSWORD')
        const instance = process.env.NODE_APP_INSTANCE ?? `pid-${process.pid}`
        logger.log(`connecting to ${host}:${port} (i=${instance}, password_set=${passwordSet})`)

        const client = new Redis({
          host,
          port,
          password: configService.get('REDIS_PASSWORD') || '',
          // family default (0) — OS escolhe IPv4 ou IPv6 conforme DNS retornar.
          // Necessário porque Railway private networking em envs legacy resolve
          // SOMENTE IPv6 (AAAA records). family:4 força IPv4 e dá ENOTFOUND.
          keepAlive: 10000, // Ping TCP a cada 10s
          connectTimeout: 10000,
          maxRetriesPerRequest: null,

          retryStrategy: (times) => {
            const delay = Math.min(times * 100, 3000)
            if (times === 1 || times % 10 === 0) {
              logger.warn(`retry attempt #${times} to ${host}:${port} (next in ${delay}ms)`)
            }
            return delay
          },
          reconnectOnError: (err) => {
            const targetError = 'READONLY'
            if (err.message.includes(targetError)) return true
            return false
          },
        })

        client.on('ready', () => logger.log(`ready (connected to ${host}:${port})`))
        client.on('error', (err) => logger.warn(`error: ${err?.message ?? err}`))
        client.on('end', () => logger.warn('connection ended'))

        return client
      },
      inject: [ConfigService],
    },
    RedisService,
  ],
  exports: [RedisService, 'REDIS_CLIENT'],
})
export class RedisModule {}