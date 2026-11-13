import { Throttle } from '@nestjs/throttler'

/**
 * Limite das rotas que o CHAT chama (ingestao, eventos e webhooks de entrega), todas protegidas por PilotKeyGuard.
 *
 * Por que nao o limite global (1500 por 15 min por IP): o chat e um servidor so, entao e UM IP. Um disparo grande gera
 * 3 avisos de status por destinatario (enviado, entregue, lido) e estourava o limite global: a API respondia 429 e o
 * status se perdia sem ninguem ver. Aqui o teto e alto o bastante para o trafego legitimo e ainda limita tentativas
 * de adivinhar a chave (50 por segundo contra uma chave de 32+ caracteres e inviavel).
 */
export const INGEST_LIMIT_PER_MINUTE = 3000

export const IngestThrottle = () => Throttle({ default: { limit: INGEST_LIMIT_PER_MINUTE, ttl: 60_000 } })
