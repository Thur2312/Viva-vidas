import { Db } from '../pg.service'

export const REPLY_WINDOW_HOURS = 72

/**
 * Chamado pela ingestão quando chega mensagem de um lead: marca como `replied` o envio REAL
 * (não simulado) mais recente dentro de 72h. Nunca lança (a ingestão não pode falhar por causa disso).
 * Atenção: dentro de transação do Postgres um erro aborta a transação; por isso o SQL é simples e o try/catch só cobre
 * falha de conexão. A tabela existe a partir da migração 006.
 */
export async function markBroadcastReply(db: Db, leadId: string): Promise<number> {
  try {
    const r = await db.query(
      `UPDATE horizon_agent.broadcast_recipients r SET status = 'replied', replied_at = now(),
              delivered_at = coalesce(r.delivered_at, r.sent_at), read_at = coalesce(r.read_at, r.sent_at)
       FROM horizon_agent.broadcasts b
       WHERE b.id = r.broadcast_id AND b.dry_run = false AND r.lead_id = $1
         AND r.status IN ('sent','delivered','read') AND r.sent_at > now() - ($2 || ' hours')::interval`,
      [leadId, String(REPLY_WINDOW_HOURS)],
    )
    return r.rowCount ?? 0
  } catch {
    return 0
  }
}
