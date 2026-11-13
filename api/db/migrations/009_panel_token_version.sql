-- Horizon Agent: versao do token de acesso do painel. Aditivo e idempotente. Somente schema horizon_agent.
-- Reversivel: ALTER TABLE horizon_agent.panel_users DROP COLUMN token_version;
--
-- Por que: o access token (JWT, 15 min) nao era conferido no banco, entao redefinir a senha ou desativar um usuario
-- so valia apos ele expirar. Agora o JWT leva `tv` e a API compara com esta coluna a cada requisicao (com cache de poucos segundos).
-- Quem aumenta o valor: `npm run panel:reset-password` (derruba todos os access tokens daquele usuario).
--
-- ORDEM DE DEPLOY: rode esta migration ANTES de subir a API nova (ela le a coluna). Tokens emitidos antes (sem `tv`)
-- contam como versao 0, o mesmo DEFAULT daqui: ninguem e deslogado pela migration.

BEGIN;

ALTER TABLE horizon_agent.panel_users
  ADD COLUMN IF NOT EXISTS token_version integer NOT NULL DEFAULT 0;

COMMIT;
