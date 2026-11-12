-- Disparos (broadcasts): campanhas de mensagem ativa por WhatsApp com portas de conformidade.
-- Aditivo e idempotente. Só o schema horizon_agent. Reversível:
--   DROP TABLE horizon_agent.broadcast_recipients, horizon_agent.broadcasts, horizon_agent.message_templates_cache;
-- Regra de ouro: nada aqui envia mensagem. O envio passa pelo ChatGatewayService e só roda
-- com BROADCASTS_ENABLED=true (padrão desligado) ou em modo de simulação (dry_run).

BEGIN;

CREATE TABLE IF NOT EXISTS horizon_agent.broadcasts (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant               text NOT NULL DEFAULT 'alberto',
  name                 text NOT NULL,
  objective            text,
  status               text NOT NULL DEFAULT 'draft'
                       CHECK (status IN ('draft','scheduled','running','paused','completed','cancelled','failed')),
  kind                 text NOT NULL DEFAULT 'template' CHECK (kind IN ('template','text_in_window')),
  template_name        text,
  template_language    text NOT NULL DEFAULT 'pt_BR',
  template_category    text CHECK (template_category IN ('MARKETING','UTILITY')),  -- foto da categoria na criação/início
  text_body            text,                                                        -- só kind = text_in_window
  variables_map        jsonb NOT NULL DEFAULT '{}'::jsonb,
  audience_filter      jsonb NOT NULL DEFAULT '{}'::jsonb,
  scheduled_at         timestamptz,
  window_start         text NOT NULL DEFAULT '09:00' CHECK (window_start ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  window_end           text NOT NULL DEFAULT '18:00' CHECK (window_end ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  window_days          integer[] NOT NULL DEFAULT '{1,2,3,4,5}',                    -- 0 = domingo ... 6 = sábado
  timezone             text NOT NULL DEFAULT 'America/Sao_Paulo',
  rate_per_minute      integer NOT NULL DEFAULT 20 CHECK (rate_per_minute BETWEEN 1 AND 60),
  daily_cap            integer NOT NULL DEFAULT 200 CHECK (daily_cap BETWEEN 1 AND 1000),
  dry_run              boolean NOT NULL DEFAULT true,
  expected_recipients  integer,                                                     -- confirmado no início
  paused_reason        text,
  backoff_until        timestamptz,
  counts               jsonb NOT NULL DEFAULT '{}'::jsonb,                          -- foto ao concluir
  created_by           text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  started_at           timestamptz,
  finished_at          timestamptz
);
ALTER TABLE horizon_agent.broadcasts ADD COLUMN IF NOT EXISTS resumed_at timestamptz;  -- a auto-pausa só olha envios depois da retomada
CREATE INDEX IF NOT EXISTS broadcasts_status_idx ON horizon_agent.broadcasts (tenant, status);

CREATE TABLE IF NOT EXISTS horizon_agent.broadcast_recipients (
  id               bigserial PRIMARY KEY,
  broadcast_id     uuid NOT NULL REFERENCES horizon_agent.broadcasts(id) ON DELETE CASCADE,
  lead_id          uuid NOT NULL REFERENCES horizon_agent.leads(id) ON DELETE CASCADE,
  status           text NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','queued','sent','delivered','read','replied','failed','skipped')),
  skip_reason      text,
  wid              text,
  error_code       text,
  attempts         integer NOT NULL DEFAULT 0,
  next_attempt_at  timestamptz,
  claimed_at       timestamptz,
  processed_at     timestamptz,                                                     -- desfecho terminal do envio (enviado/falhou)
  sent_at          timestamptz,
  delivered_at     timestamptz,
  read_at          timestamptz,
  replied_at       timestamptz,
  converted_at     timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (broadcast_id, lead_id)
);
CREATE INDEX IF NOT EXISTS broadcast_recipients_status_idx ON horizon_agent.broadcast_recipients (broadcast_id, status);
CREATE INDEX IF NOT EXISTS broadcast_recipients_wid_idx ON horizon_agent.broadcast_recipients (wid) WHERE wid IS NOT NULL;
CREATE INDEX IF NOT EXISTS broadcast_recipients_lead_idx ON horizon_agent.broadcast_recipients (lead_id, sent_at);

CREATE TABLE IF NOT EXISTS horizon_agent.message_templates_cache (
  name              text NOT NULL,
  language          text NOT NULL DEFAULT 'pt_BR',
  category          text,
  status            text NOT NULL DEFAULT 'PENDING',
  rejected_reason   text,
  body_text         text,        -- necessário para validar o aviso de saída e montar a prévia
  footer_text       text,
  buttons           jsonb NOT NULL DEFAULT '[]'::jsonb,
  synced_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (name, language)
);

-- ───────────────────────── Segurança ─────────────────────────
ALTER TABLE horizon_agent.broadcasts ENABLE ROW LEVEL SECURITY;
ALTER TABLE horizon_agent.broadcast_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE horizon_agent.message_templates_cache ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON horizon_agent.broadcasts, horizon_agent.broadcast_recipients, horizon_agent.message_templates_cache FROM anon';
    EXECUTE 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA horizon_agent FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON horizon_agent.broadcasts, horizon_agent.broadcast_recipients, horizon_agent.message_templates_cache FROM authenticated';
    EXECUTE 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA horizon_agent FROM authenticated';
  END IF;
END $$;

COMMIT;
