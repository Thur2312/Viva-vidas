-- Cadastro de chaves pelo painel (criptografadas na aplicação, AES-256-GCM via CryptoService).
-- Aditivo e idempotente, só schema horizon_agent. Reversível: DROP TABLE horizon_agent.integration_secrets;
-- NUNCA guarda a chave em claro. `last4` serve só para o painel mostrar "…abcd".

BEGIN;

CREATE TABLE IF NOT EXISTS horizon_agent.integration_secrets (
  tenant      text NOT NULL DEFAULT 'alberto',
  name        text NOT NULL,
  ciphertext  text NOT NULL,
  last4       text NOT NULL DEFAULT '',
  updated_by  text,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant, name)
);

ALTER TABLE horizon_agent.integration_secrets ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON horizon_agent.integration_secrets FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON horizon_agent.integration_secrets FROM authenticated';
  END IF;
END $$;

COMMIT;
