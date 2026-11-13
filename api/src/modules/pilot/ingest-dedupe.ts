import { createHash } from 'crypto'

/** Janela em que duas mensagens recebidas identicas (sem `wid`) contam como a mesma. Cobre os reenvios por falha de rede. */
export const DEDUPE_BUCKET_SECONDS = 10

/**
 * Chave de deduplicacao para mensagem RECEBIDA sem `wid`.
 *
 * Por que existe: `UNIQUE (conversation_id, wid)` nao protege quando `wid` e NULL (NULL nunca conflita com NULL), entao
 * um reenvio do webhook duplicava a mensagem, o evento "respondeu" e o aprendizado do agente.
 *
 * Limites assumidos (por isso so vale para direction 'in'):
 *  - dois "ok" identicos do lead dentro de 10 s contam como um so;
 *  - um reenvio que cruze a virada da janela escapa. Quem envia deve mandar `wid` (PILOT_REQUIRE_WID=true passa a exigir).
 * Mensagens ENVIADAS (painel, agente) ficam de fora: duas respostas iguais seguidas sao legitimas e ambas precisam existir.
 */
export function fallbackWid(m: { direction: 'in' | 'out'; author: string; body: string }, now = Date.now()): string | null {
  if (m.direction !== 'in') return null
  const bucket = Math.floor(now / (DEDUPE_BUCKET_SECONDS * 1000))
  return 'auto:' + createHash('sha256').update(`${m.author}|${m.body}|${bucket}`).digest('hex').slice(0, 40)
}
