import type { Db } from '../pilot/pg.service'
import { crmEnabled } from './crm.rules'

/**
 * Entra na fila do CRM na MESMA transacao do evento (padrao outbox): ou o evento e a linha existem juntos, ou nenhum.
 * Sem CRM_PROVIDER=pipedrive nao faz nada. O envio e feito depois, pelo worker, com nova tentativa.
 * Aplique a migration 008 antes de ligar CRM_PROVIDER: sem a tabela, registrar evento falharia.
 */
export async function enqueueCrmEvent(
  db: Db,
  i: { tenant: string; leadId: string; type: string; eventId?: number | string | null; value?: number | null },
): Promise<void> {
  if (!crmEnabled() || i.eventId == null) return
  await db.query(
    `INSERT INTO horizon_agent.crm_outbox (tenant, lead_id, event_type, event_id, value, idempotency_key)
     VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (idempotency_key) DO NOTHING`,
    [i.tenant, i.leadId, i.type, i.eventId, i.value ?? null, `evt:${i.eventId}`],
  )
}
