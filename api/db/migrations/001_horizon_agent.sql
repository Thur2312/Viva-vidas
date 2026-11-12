-- Horizon Agent: schema isolado. Aditivo e reversível:  DROP SCHEMA horizon_agent CASCADE;
-- Não toca em nenhuma tabela existente do banco compartilhado (core, public, workspace_*).
-- Desenho: o agente roda em MODO SOMBRA. Ele lê as conversas do colaborador com o lead,
-- escreve um rascunho para cada mensagem recebida sem enviar nada, e compara com o que o
-- humano realmente respondeu. A taxa de concordância libera o modo automático por etapa.

BEGIN;

CREATE SCHEMA IF NOT EXISTS horizon_agent;

-- ───────────────────────── Leads e origem ─────────────────────────
CREATE TABLE IF NOT EXISTS horizon_agent.leads (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant          text NOT NULL DEFAULT 'alberto',
  name            text,
  phone           text NOT NULL,
  stage           text NOT NULL DEFAULT 'contatado'
                  CHECK (stage IN ('contatado','respondeu','qualificado','reuniao','compareceu','venda','perdido')),
  score           integer CHECK (score BETWEEN 0 AND 100),
  qualification   jsonb NOT NULL DEFAULT '{}'::jsonb,   -- campos coletados (plano atual, vidas, valor...)
  source          jsonb NOT NULL DEFAULT '{}'::jsonb,   -- ctwa_clid, ad_id, adset_id, campaign_id, utm_*, fbc, fbp
  opt_out         boolean NOT NULL DEFAULT false,
  opt_in_origin   text,                                 -- de onde veio o consentimento
  pipedrive_ids   jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant, phone)
);
CREATE INDEX IF NOT EXISTS leads_stage_idx ON horizon_agent.leads (tenant, stage);
CREATE INDEX IF NOT EXISTS leads_source_campaign_idx ON horizon_agent.leads ((source->>'campaign_id'));

-- Linha do tempo do funil. Alimenta o dashboard e a Conversions API.
CREATE TABLE IF NOT EXISTS horizon_agent.lead_events (
  id          bigserial PRIMARY KEY,
  lead_id     uuid NOT NULL REFERENCES horizon_agent.leads(id) ON DELETE CASCADE,
  type        text NOT NULL CHECK (type IN ('contatado','respondeu','qualificado','reuniao_marcada','compareceu','venda','perdido','opt_out')),
  value       numeric(12,2),
  actor       text NOT NULL DEFAULT 'humano' CHECK (actor IN ('humano','agente','sistema')),
  payload     jsonb NOT NULL DEFAULT '{}'::jsonb,
  sent_to_meta_at timestamptz,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lead_events_lead_idx ON horizon_agent.lead_events (lead_id, occurred_at);
CREATE INDEX IF NOT EXISTS lead_events_type_idx ON horizon_agent.lead_events (type, occurred_at);

-- ───────────────────────── Conversas ─────────────────────────
-- mode: shadow = só observa e rascunha | assisted = sugere, humano aprova | auto = responde
CREATE TABLE IF NOT EXISTS horizon_agent.conversations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id     uuid NOT NULL REFERENCES horizon_agent.leads(id) ON DELETE CASCADE,
  channel     text NOT NULL DEFAULT 'whatsapp',
  mode        text NOT NULL DEFAULT 'shadow' CHECK (mode IN ('shadow','assisted','auto')),
  external_ref text,                                    -- ticket/conversa no chat
  summary     text,                                     -- resumo rolante
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS conversations_lead_idx ON horizon_agent.conversations (lead_id);

CREATE TABLE IF NOT EXISTS horizon_agent.messages (
  id              bigserial PRIMARY KEY,
  conversation_id uuid NOT NULL REFERENCES horizon_agent.conversations(id) ON DELETE CASCADE,
  direction       text NOT NULL CHECK (direction IN ('in','out')),
  author          text NOT NULL CHECK (author IN ('lead','humano','agente')),
  body            text NOT NULL,
  wid             text,                                 -- id da mensagem no WhatsApp
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (conversation_id, wid)
);
CREATE INDEX IF NOT EXISTS messages_conv_idx ON horizon_agent.messages (conversation_id, created_at);

-- ───────────────────────── Aprendizado em modo sombra ─────────────────────────
-- Um rascunho para cada mensagem do lead, nunca enviado em modo sombra.
CREATE TABLE IF NOT EXISTS horizon_agent.agent_drafts (
  id                bigserial PRIMARY KEY,
  conversation_id   uuid NOT NULL REFERENCES horizon_agent.conversations(id) ON DELETE CASCADE,
  trigger_message_id bigint NOT NULL REFERENCES horizon_agent.messages(id) ON DELETE CASCADE,
  draft_body        text NOT NULL,
  model             text NOT NULL,
  playbook_version  integer,
  stage_guess       text,                               -- etapa que o agente acha que o lead está
  qualified_guess   boolean,                            -- o agente qualificaria este lead?
  next_action_guess text,                               -- ex.: perguntar_plano_atual, propor_horario, repassar
  reasoning         text,
  human_message_id  bigint REFERENCES horizon_agent.messages(id) ON DELETE SET NULL,
  similarity        numeric(4,3) CHECK (similarity BETWEEN 0 AND 1),
  human_action      text CHECK (human_action IN ('igual','editou','ignorou','diferente')),
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agent_drafts_conv_idx ON horizon_agent.agent_drafts (conversation_id, created_at);

-- Comparação por lead: o que o agente diria vs. o que o colaborador decidiu.
CREATE TABLE IF NOT EXISTS horizon_agent.qualification_reviews (
  id            bigserial PRIMARY KEY,
  lead_id       uuid NOT NULL REFERENCES horizon_agent.leads(id) ON DELETE CASCADE,
  agent_stage   text,
  human_stage   text,
  agent_qualified boolean,
  human_qualified boolean,
  agreed        boolean GENERATED ALWAYS AS (agent_qualified IS NOT DISTINCT FROM human_qualified) STORED,
  reviewed_at   timestamptz NOT NULL DEFAULT now()
);

-- Biblioteca de exemplos reais (resposta do colaborador a uma situação). Base do few-shot.
CREATE TABLE IF NOT EXISTS horizon_agent.learned_examples (
  id            bigserial PRIMARY KEY,
  situation     text NOT NULL,                          -- contexto resumido e SEM dados pessoais
  lead_message  text NOT NULL,
  human_reply   text NOT NULL,
  tags          text[] NOT NULL DEFAULT '{}',           -- objecao_preco, carencia, qualificacao, agendamento...
  outcome       text CHECK (outcome IN ('avancou','estagnou','perdeu','venda')),
  approved      boolean NOT NULL DEFAULT false,         -- só exemplos aprovados entram no prompt
  pii_redacted  boolean NOT NULL DEFAULT false,
  source_message_id bigint REFERENCES horizon_agent.messages(id) ON DELETE SET NULL,
  fts           tsvector GENERATED ALWAYS AS (to_tsvector('portuguese', coalesce(situation,'') || ' ' || coalesce(lead_message,''))) STORED,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS learned_examples_fts_idx ON horizon_agent.learned_examples USING gin (fts);
CREATE INDEX IF NOT EXISTS learned_examples_tags_idx ON horizon_agent.learned_examples USING gin (tags);

-- Playbook versionado: destilado das conversas e aprovado pelo Alberto.
CREATE TABLE IF NOT EXISTS horizon_agent.playbook_versions (
  id          serial PRIMARY KEY,
  version     integer NOT NULL UNIQUE,
  body        text NOT NULL,
  notes       text,
  source      text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','destilado')),
  active      boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS playbook_one_active ON horizon_agent.playbook_versions (active) WHERE active;

-- Prontidão: concordância agente x humano por etapa. Libera shadow → assisted → auto.
CREATE OR REPLACE VIEW horizon_agent.agent_readiness AS
SELECT
  coalesce(d.stage_guess, 'sem_etapa')                                        AS stage,
  count(*)                                                                    AS drafts,
  count(*) FILTER (WHERE d.human_action IS NOT NULL)                          AS compared,
  round(avg(d.similarity)::numeric, 3)                                        AS avg_similarity,
  round((count(*) FILTER (WHERE d.human_action IN ('igual','editou'))::numeric
        / nullif(count(*) FILTER (WHERE d.human_action IS NOT NULL), 0)), 3)  AS usable_rate
FROM horizon_agent.agent_drafts d
GROUP BY 1;

-- ───────────────────────── Anúncios ─────────────────────────
CREATE TABLE IF NOT EXISTS horizon_agent.ad_spend_daily (
  day          date NOT NULL,
  campaign_id  text NOT NULL,
  campaign_name text,
  adset_id     text NOT NULL DEFAULT '',
  ad_id        text NOT NULL DEFAULT '',
  spend        numeric(12,2) NOT NULL DEFAULT 0,
  impressions  integer NOT NULL DEFAULT 0,
  clicks       integer NOT NULL DEFAULT 0,
  PRIMARY KEY (day, campaign_id, adset_id, ad_id)
);

-- ───────────────────────── Segurança ─────────────────────────
-- RLS ligado e sem políticas: anon e authenticated não leem nada. Só o backend (service role / dono).
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'horizon_agent' LOOP
    EXECUTE format('ALTER TABLE horizon_agent.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

REVOKE ALL ON SCHEMA horizon_agent FROM anon, authenticated;
REVOKE ALL ON ALL TABLES IN SCHEMA horizon_agent FROM anon, authenticated;

COMMIT;
