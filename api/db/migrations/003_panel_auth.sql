-- Horizon Agent: autenticacao do painel. Aditivo e idempotente. Somente schema horizon_agent.
-- Reversivel: DROP TABLE horizon_agent.panel_refresh_tokens, horizon_agent.panel_users;
-- RLS ligado e SEM policies: so a role dona (conexao direta do backend) acessa; anon/authenticated nao.

BEGIN;

CREATE SCHEMA IF NOT EXISTS horizon_agent;

CREATE TABLE IF NOT EXISTS horizon_agent.panel_users (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant          text NOT NULL,
  email           text NOT NULL,
  name            text NOT NULL,
  role            text NOT NULL CHECK (role IN ('owner','manager','viewer')),
  password_hash   text NOT NULL,                 -- scrypt$N$r$p$salt$hash (sal por usuario)
  active          boolean NOT NULL DEFAULT true,
  failed_attempts integer NOT NULL DEFAULT 0,
  locked_until    timestamptz,
  last_login_at   timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT panel_users_email_lower CHECK (email = lower(email))
);
CREATE UNIQUE INDEX IF NOT EXISTS panel_users_email_uidx ON horizon_agent.panel_users (lower(email));

CREATE TABLE IF NOT EXISTS horizon_agent.panel_refresh_tokens (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES horizon_agent.panel_users(id) ON DELETE CASCADE,
  family_id       uuid NOT NULL,
  token_hash      text NOT NULL,                 -- sha256 hex; o token em claro nunca e gravado
  expires_at      timestamptz NOT NULL,
  revoked_at      timestamptz,
  replaced_by     uuid,
  user_agent_hash text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS panel_refresh_tokens_hash_uidx ON horizon_agent.panel_refresh_tokens (token_hash);
CREATE INDEX IF NOT EXISTS panel_refresh_tokens_family_idx ON horizon_agent.panel_refresh_tokens (family_id);
CREATE INDEX IF NOT EXISTS panel_refresh_tokens_user_idx ON horizon_agent.panel_refresh_tokens (user_id);

ALTER TABLE horizon_agent.panel_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE horizon_agent.panel_refresh_tokens ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON horizon_agent.panel_users, horizon_agent.panel_refresh_tokens FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON horizon_agent.panel_users, horizon_agent.panel_refresh_tokens FROM authenticated';
  END IF;
END $$;

COMMIT;
