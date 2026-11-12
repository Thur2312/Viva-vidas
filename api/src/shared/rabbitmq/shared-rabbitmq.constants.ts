import { ConfigService } from '@nestjs/config'

/**
 * Constroi a URI de conexao com o RabbitMQ a partir das variaveis de ambiente.
 *
 * Prioridade:
 *   1. RABBITMQ_URL (URL completa)
 *   2. RABBITMQ_PRIVATE_URL (URL completa)
 *   3. Componentes individuais: USER, PASS, HOST, PORT, VHOST
 */
export function buildRabbitMQUri(configService: ConfigService): string {
  return (
    configService.get('RABBITMQ_URL') ||
    configService.get('RABBITMQ_PRIVATE_URL') ||
    `amqp://${configService.get('RABBITMQ_DEFAULT_USER') || 'guest'}:${configService.get('RABBITMQ_DEFAULT_PASS') || 'guest'}@${configService.get('RABBITMQ_HOST') || 'localhost'}:${configService.get('RABBITMQ_PORT') || 5672}/${configService.get('RABBITMQ_VHOST') || ''}`
  )
}

// Named channels — cada dominio usa prefetch diferente
export const TRACKING_CHANNEL = 'tracking-channel'
