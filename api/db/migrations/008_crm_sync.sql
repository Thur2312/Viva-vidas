-- Fila de sincronizacao com o CRM (Pipedrive): padrao "outbox".
-- Aditivo e idempotente. So o schema horizon_agent. Reversivel:
--   DROP TABLE horizon_agent.crm_outbox;
-- Cada evento do funil vira uma linha aqui, na MESMA transacao do evento; um worker envia ao CRM com nova
-- tentativa. Nada aqui guarda conteudo de mensagem. Os ids do CRM ficam em leads.pipedrive_ids (ja existe).
-- So e preenchida com CRM_PROVIDER=pipedrive (padrao desligado).

BEGIN;

CREATE TABLE IF NOT EXISTS horizon_agent.crm_outbox (
  id               bigserial PRIMARY KEY,
  tenant           text NOT NULL DEFAULT 'alberto',
  lead_id          uuid NOT NULL REFERENCES horizon_agent.leads(id) ON DELETE CASCADE,
  event_type       text NOT NULL,
  event_id         bigint,                                  -- lead_events.id que originou a linha
  value            numeric(12,2),                           -- valor da venda, quando houver
  idempotency_key  text NOT NULL UNIQUE,                    -- 'evt:<lead_events.id>': o mesmo evento nunca entra duas vezes
  status           text NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','processing','sent','skipped','dead')),
  attempts         integer NOT NULL DEFAULT 0,
  next_attempt_at  timestamptz NOT NULL DEFAULT now(),
  claimed_at       timestamptz,
  last_error       text,                                    -- so codigo/status, nunca corpo de resposta (pode ter dado pessoal)
  created_at       timestamptz NOT NULL DEFAULT now(),
  sent_at          timestamptz
);

CREATE INDEX IF NOT EXISTS crm_outbox_due_idx ON horizon_agent.crm_outbox (tenant, next_attempt_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS crm_outbox_lead_idx ON horizon_agent.crm_outbox (lead_id, id);

-- ───────────────────────── Seguranca ─────────────────────────
ALTER TABLE horizon_agent.crm_outbox ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON horizon_agent.crm_outbox FROM anon';
    EXECUTE 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA horizon_agent FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON horizon_agent.crm_outbox FROM authenticated';
    EXECUTE 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA horizon_agent FROM authenticated';
  END IF;
END $$;

COMMIT;
