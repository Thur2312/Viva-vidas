-- Horizon Agent: controles técnicos LGPD (Lei 13.709/2018). Aditivo e idempotente.
-- Só toca no schema horizon_agent. Reversão: DROP das tabelas novas e das colunas adicionadas.
--   consents, data_subject_requests, audit_log
--   leads.anonymized_at / phone_hash, messages.contains_sensitive,
--   learned_examples.source_lead_id / contains_sensitive

BEGIN;

-- ───────────────────────── Colunas novas em tabelas existentes ─────────────────────────
-- anonymized_at: lead anonimizado (irreversível). phone_hash: HMAC-SHA256 salgado do telefone,
-- mantido SOMENTE em lead anonimizado que tinha opt-out, para continuar bloqueando o contato.
ALTER TABLE horizon_agent.leads ADD COLUMN IF NOT EXISTS anonymized_at timestamptz;
ALTER TABLE horizon_agent.leads ADD COLUMN IF NOT EXISTS phone_hash text;
CREATE INDEX IF NOT EXISTS leads_phone_hash_idx ON horizon_agent.leads (tenant, phone_hash) WHERE phone_hash IS NOT NULL;

-- Sinaliza (no momento da ingestão, sobre o texto em claro) conteúdo possivelmente sensível (art. 11).
ALTER TABLE horizon_agent.messages ADD COLUMN IF NOT EXISTS contains_sensitive boolean NOT NULL DEFAULT false;

-- Vínculo do exemplo aprendido com o lead de origem, para eliminar/anonimizar o que foi derivado dele.
ALTER TABLE horizon_agent.learned_examples
  ADD COLUMN IF NOT EXISTS source_lead_id uuid REFERENCES horizon_agent.leads(id) ON DELETE CASCADE;
ALTER TABLE horizon_agent.learned_examples ADD COLUMN IF NOT EXISTS contains_sensitive boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS learned_examples_lead_idx ON horizon_agent.learned_examples (source_lead_id);

-- ───────────────────────── Registro de consentimentos ─────────────────────────
CREATE TABLE IF NOT EXISTS horizon_agent.consents (
  id           bigserial PRIMARY KEY,
  lead_id      uuid NOT NULL REFERENCES horizon_agent.leads(id) ON DELETE CASCADE,
  purpose      text NOT NULL CHECK (purpose IN ('atendimento','qualificacao','aprendizado_agente','marketing')),
  legal_basis  text NOT NULL CHECK (legal_basis IN ('consentimento','procedimentos_preliminares','execucao_contrato','legitimo_interesse','obrigacao_legal')),
  text_version text,                                    -- versão do texto/aviso apresentado ao titular
  source       text,                                    -- origem: ctwa, formulario, whatsapp_inbound, painel...
  granted_at   timestamptz NOT NULL DEFAULT now(),
  revoked_at   timestamptz,
  revoke_reason text,
  CHECK (revoked_at IS NULL OR revoked_at >= granted_at)
);
-- No máximo um consentimento ATIVO por lead e finalidade; o histórico (revogados) é preservado.
CREATE UNIQUE INDEX IF NOT EXISTS consents_one_active ON horizon_agent.consents (lead_id, purpose) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS consents_lead_idx ON horizon_agent.consents (lead_id, purpose);

-- ───────────────────────── Direitos do titular (art. 18) ─────────────────────────
-- lead_id sem FK de propósito: o pedido de eliminação precisa sobreviver à eliminação do lead.
CREATE TABLE IF NOT EXISTS horizon_agent.data_subject_requests (
  id            bigserial PRIMARY KEY,
  lead_id       uuid,
  type          text NOT NULL CHECK (type IN ('acesso','correcao','anonimizacao','eliminacao','revogacao_consentimento')),
  status        text NOT NULL DEFAULT 'aberto' CHECK (status IN ('aberto','em_andamento','concluido','negado')),
  requested_by  text,                                   -- operador do painel (id), nunca dado do titular
  requested_at  timestamptz NOT NULL DEFAULT now(),
  due_at        timestamptz NOT NULL DEFAULT (now() + interval '15 days'),  -- SLA de 15 dias
  completed_at  timestamptz,
  notes         text                                    -- sem dados pessoais
);
CREATE INDEX IF NOT EXISTS dsr_status_idx ON horizon_agent.data_subject_requests (status, due_at);
CREATE INDEX IF NOT EXISTS dsr_lead_idx ON horizon_agent.data_subject_requests (lead_id);

-- ───────────────────────── Trilha de auditoria ─────────────────────────
-- details NÃO pode conter dado pessoal (nome, telefone, conteúdo de mensagem).
CREATE TABLE IF NOT EXISTS horizon_agent.audit_log (
  id         bigserial PRIMARY KEY,
  actor      text NOT NULL,
  action     text NOT NULL,
  entity     text NOT NULL,
  entity_id  text,
  ip         text,
  at         timestamptz NOT NULL DEFAULT now(),
  details    jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS audit_log_at_idx ON horizon_agent.audit_log (at DESC);
CREATE INDEX IF NOT EXISTS audit_log_entity_idx ON horizon_agent.audit_log (entity, entity_id);
CREATE INDEX IF NOT EXISTS audit_log_action_idx ON horizon_agent.audit_log (action, at DESC);

-- ───────────────────────── Segurança ─────────────────────────
ALTER TABLE horizon_agent.consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE horizon_agent.data_subject_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE horizon_agent.audit_log ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON horizon_agent.consents, horizon_agent.data_subject_requests, horizon_agent.audit_log FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA horizon_agent FROM anon, authenticated;

COMMIT;
