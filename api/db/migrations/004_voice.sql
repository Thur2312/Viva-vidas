-- Horizon Agent: modulo de voz / telefonia. Aditivo e idempotente. Somente schema horizon_agent.
-- Reversao: DROP TABLE horizon_agent.voice_transcripts, horizon_agent.voice_call_events,
--           horizon_agent.voice_calls, horizon_agent.voice_settings;
-- RLS ligado e SEM policies: so a role dona (conexao direta do backend) acessa; anon/authenticated nao.

BEGIN;

CREATE SCHEMA IF NOT EXISTS horizon_agent;

-- Ligacoes. lead_id com ON DELETE CASCADE: eliminar o lead elimina chamadas, eventos e transcricoes.
-- recording_url_ref guarda a REFERENCIA da gravacao no provedor, criptografada na aplicacao (enc:v<N>:...),
-- nunca uma URL publica. O audio em si fica no provedor e e apagado la na retencao / eliminacao.
CREATE TABLE IF NOT EXISTS horizon_agent.voice_calls (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant                text NOT NULL DEFAULT 'alberto',
  lead_id               uuid NOT NULL REFERENCES horizon_agent.leads(id) ON DELETE CASCADE,
  direction             text NOT NULL DEFAULT 'outbound' CHECK (direction IN ('outbound','inbound')),
  operator_user_id      text,                      -- id do usuario do painel (sem FK: o registro sobrevive ao usuario)
  provider              text NOT NULL,
  provider_call_sid     text,
  status                text NOT NULL DEFAULT 'queued'
                        CHECK (status IN ('queued','ringing','in_progress','completed','busy','no_answer','failed','canceled')),
  failure_reason        text,
  requested_at          timestamptz NOT NULL DEFAULT now(),
  started_at            timestamptz,               -- operador atendeu (inicio da chamada no provedor)
  answered_at           timestamptz,               -- lead atendeu (aviso de gravacao entregue)
  ended_at              timestamptz,
  duration_sec          integer CHECK (duration_sec IS NULL OR duration_sec >= 0),
  recording_url_ref     text,
  recording_consent     boolean NOT NULL DEFAULT false,
  consent_basis         text,                      -- ex.: aviso_previo_v1 (a confirmar com o juridico)
  announcement_version  text,
  recording_announced_at timestamptz,
  recording_deleted_at  timestamptz,
  transcript_status     text NOT NULL DEFAULT 'none' CHECK (transcript_status IN ('none','pending','done','failed','disabled')),
  retention_until       timestamptz,
  cost_cents            integer CHECK (cost_cents IS NULL OR cost_cents >= 0),
  created_at            timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS voice_calls_sid_uidx ON horizon_agent.voice_calls (provider, provider_call_sid) WHERE provider_call_sid IS NOT NULL;
CREATE INDEX IF NOT EXISTS voice_calls_lead_idx ON horizon_agent.voice_calls (lead_id, requested_at DESC);
CREATE INDEX IF NOT EXISTS voice_calls_tenant_idx ON horizon_agent.voice_calls (tenant, requested_at DESC);
CREATE INDEX IF NOT EXISTS voice_calls_retention_idx ON horizon_agent.voice_calls (retention_until) WHERE retention_until IS NOT NULL;

-- Linha do tempo de status. event_key torna o webhook idempotente (o provedor reenvia).
CREATE TABLE IF NOT EXISTS horizon_agent.voice_call_events (
  id         bigserial PRIMARY KEY,
  call_id    uuid NOT NULL REFERENCES horizon_agent.voice_calls(id) ON DELETE CASCADE,
  kind       text NOT NULL,                        -- status | recording | transcript | announcement
  status     text,
  event_key  text NOT NULL,
  at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (call_id, event_key)
);
CREATE INDEX IF NOT EXISTS voice_call_events_call_idx ON horizon_agent.voice_call_events (call_id, at);

-- Transcricao: segmentos (JSON) criptografados em repouso com o mesmo CryptoService das mensagens.
-- Mantida aqui, e NAO em messages: messages.author so aceita lead/humano/agente e o pipeline de
-- aprendizado le messages sem distinguir canal. Ver docs/voice.md.
CREATE TABLE IF NOT EXISTS horizon_agent.voice_transcripts (
  id                 bigserial PRIMARY KEY,
  call_id            uuid NOT NULL UNIQUE REFERENCES horizon_agent.voice_calls(id) ON DELETE CASCADE,
  segments_enc       text NOT NULL,
  language           text,
  provider           text,
  contains_sensitive boolean NOT NULL DEFAULT false,
  created_at         timestamptz NOT NULL DEFAULT now()
);

-- Configuracao por tenant (singleton). NULL = usar o padrao do ambiente.
CREATE TABLE IF NOT EXISTS horizon_agent.voice_settings (
  tenant                text PRIMARY KEY,
  call_window           jsonb,                     -- {"days":[1,2,3,4,5],"start":"09:00","end":"18:00","tz":"America/Sao_Paulo"}
  dnc_enabled           boolean NOT NULL DEFAULT false,
  announcement_text     text,
  announcement_version  text,
  updated_by            text,
  updated_at            timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE horizon_agent.voice_calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE horizon_agent.voice_call_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE horizon_agent.voice_transcripts ENABLE ROW LEVEL SECURITY;
ALTER TABLE horizon_agent.voice_settings ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON horizon_agent.voice_calls, horizon_agent.voice_call_events, horizon_agent.voice_transcripts, horizon_agent.voice_settings FROM anon';
    EXECUTE 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA horizon_agent FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON horizon_agent.voice_calls, horizon_agent.voice_call_events, horizon_agent.voice_transcripts, horizon_agent.voice_settings FROM authenticated';
    EXECUTE 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA horizon_agent FROM authenticated';
  END IF;
END $$;

COMMIT;
