/**
 * RabbitMQ Exchange e Queues para processamento async de tracking.
 *
 * Topologia:
 *
 *   Exchange "tracking.events" (topic)
 *     └── Queue "tracking-process" ← routing key "tracking.process" (TTL 1 dia)
 *
 *   Exchange "tracking.dlx" (direct) — Dead Letter Exchange
 *     └── Queue "tracking-dead-letter" ← msgs expiradas ou que esgotaram retries
 *
 * Fluxo:
 *   POST /track → valida + auth (cache Redis) → publica em "tracking.events"
 *   → responde { ok: true } imediatamente
 *   → consumer processa: INSERT tracking + lead creation + trigger emit
 */

// Exchanges
export const TRACKING_EXCHANGE = 'tracking.events'
export const TRACKING_DLX = 'tracking.dlx'

// Queues
export const TRACKING_QUEUE = 'tracking-process'
export const TRACKING_DLQ = 'tracking-dead-letter'

// Routing keys
export const ROUTING_KEY_TRACKING = 'tracking.process'

/**
 * TTL das mensagens na fila principal.
 * Tracking events que ficam mais de 1 dia são descartados (vão para DLQ).
 */
export const TRACKING_MESSAGE_TTL_MS = 1 * 24 * 60 * 60 * 1000 // 1 dia

/**
 * Retry config
 */
export const TRACKING_MAX_RETRIES = 3
