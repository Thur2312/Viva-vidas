import { SetMetadata } from '@nestjs/common'

export const SKIP_LOGGING_KEY = 'skipLogging'

/**
 * Pula o LoggingInterceptor — nao gera INSERT na tabela Logs por request.
 * Uso: aplicar em rotas hot/alta-frequencia (ex: /track, health, metrics).
 */
export const SkipLogging = () => SetMetadata(SKIP_LOGGING_KEY, true)
