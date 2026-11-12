import { Global, Module, Logger } from '@nestjs/common'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { RabbitMQModule } from '@golevelup/nestjs-rabbitmq'
import { buildRabbitMQUri, TRACKING_CHANNEL } from './shared-rabbitmq.constants'
import {
  TRACKING_EXCHANGE,
  TRACKING_DLX,
  TRACKING_QUEUE,
  TRACKING_DLQ,
  ROUTING_KEY_TRACKING,
  TRACKING_MESSAGE_TTL_MS,
} from 'src/modules/admin/tracking/queue/tracking-queue.constants'

const logger = new Logger('SharedRabbitMQModule')

/**
 * TRIMMED do original do HDM: so a topologia de TRACKING (webhook e trigger removidas).
 * Conexao unica e AmqpConnection global.
 */
@Global()
@Module({
  imports: [
    ConfigModule,
    RabbitMQModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => {
        const uri = buildRabbitMQUri(configService)
        logger.log(`[RabbitMQ] Conectando: ${uri.replace(/:([^@]+)@/, ':***@')}`)

        return {
          name: 'default',
          uri,
          connectionInitOptions: { wait: true, timeout: 10000 },
          prefetchCount: 10,
          channels: {
            [TRACKING_CHANNEL]: { prefetchCount: 10 },
          },
          exchanges: [
            { name: TRACKING_EXCHANGE, type: 'topic', options: { durable: true } },
            { name: TRACKING_DLX, type: 'direct', options: { durable: true } },
          ],
          queues: [
            {
              name: TRACKING_QUEUE,
              options: {
                durable: true,
                arguments: {
                  'x-message-ttl': TRACKING_MESSAGE_TTL_MS,
                  'x-dead-letter-exchange': TRACKING_DLX,
                  'x-dead-letter-routing-key': TRACKING_QUEUE,
                },
              },
              exchange: TRACKING_EXCHANGE,
              routingKey: ROUTING_KEY_TRACKING,
            },
            {
              name: TRACKING_DLQ,
              options: { durable: true },
              exchange: TRACKING_DLX,
              routingKey: TRACKING_QUEUE,
            },
          ],
          enableControllerDiscovery: true,
        }
      },
      inject: [ConfigService],
    }),
  ],
  exports: [RabbitMQModule],
})
export class SharedRabbitMQModule {}
