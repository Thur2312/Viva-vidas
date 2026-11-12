-- Saúde do número de WhatsApp (qualidade e limite de mensagens da Meta). Aditivo e idempotente,
-- só schema horizon_agent. Reversível: DROP TABLE horizon_agent.number_health_snapshots;
-- `raw` guarda só campos normalizados; NUNCA token, telefone ou nome verificado.

BEGIN;

CREATE TABLE IF NOT EXISTS horizon_agent.number_health_snapshots (
  id                     bigserial PRIMARY KEY,
  tenant                 text NOT NULL DEFAULT 'alberto',
  checked_at             timestamptz NOT NULL DEFAULT now(),
  source                 text NOT NULL DEFAULT 'poll' CHECK (source IN ('poll','webhook')),
  quality_rating         text NOT NULL DEFAULT 'UNKNOWN' CHECK (quality_rating IN ('GREEN','YELLOW','RED','UNKNOWN')),
  limit_tier             text NOT NULL DEFAULT 'UNKNOWN',
  daily_limit            integer,
  status                 text,
  account_review_status  text,
  raw                    jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS number_health_checked_idx ON horizon_agent.number_health_snapshots (tenant, checked_at DESC);

ALTER TABLE horizon_agent.number_health_snapshots ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON horizon_agent.number_health_snapshots FROM anon';
    EXECUTE 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA horizon_agent FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON horizon_agent.number_health_snapshots FROM authenticated';
    EXECUTE 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA horizon_agent FROM authenticated';
  END IF;
END $$;

COMMIT;
