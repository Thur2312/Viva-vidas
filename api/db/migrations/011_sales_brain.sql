-- Cérebro de vendas: playbook estruturado (data jsonb + status), telemetria do rascunho
-- (ação, objeção, campo perguntado, motivo de repasse, violações das travas, hash do prompt, tokens),
-- UNIQUE por mensagem gatilho e view de prontidão por ação.
-- Aditivo e idempotente, só schema horizon_agent. Reversível: DROP VIEW horizon_agent.agent_readiness_by_action;
-- DROP INDEX horizon_agent.agent_drafts_trigger_uidx; e remover as colunas novas (nada é apagado aqui,
-- exceto rascunhos duplicados por trigger_message_id, mantendo o de menor id).

BEGIN;

-- ───────────────────────── playbook_versions ─────────────────────────
ALTER TABLE horizon_agent.playbook_versions ADD COLUMN IF NOT EXISTS data jsonb;

-- Backfill de status só na primeira execução (quando a coluna ainda não existe), para a
-- reexecução da migration não sobrescrever o ciclo de vida já gerido pelo painel.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'horizon_agent' AND table_name = 'playbook_versions' AND column_name = 'status'
  ) THEN
    ALTER TABLE horizon_agent.playbook_versions
      ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'rascunho'
      CHECK (status IN ('rascunho','ativo','arquivado'));
    UPDATE horizon_agent.playbook_versions
       SET status = CASE WHEN active THEN 'ativo' ELSE 'arquivado' END;
  END IF;
END $$;

-- ───────────────────────── agent_drafts ─────────────────────────
ALTER TABLE horizon_agent.agent_drafts ADD COLUMN IF NOT EXISTS action text;
ALTER TABLE horizon_agent.agent_drafts ADD COLUMN IF NOT EXISTS objection_id text;
ALTER TABLE horizon_agent.agent_drafts ADD COLUMN IF NOT EXISTS asked_field text;
ALTER TABLE horizon_agent.agent_drafts ADD COLUMN IF NOT EXISTS handoff_reason text;
ALTER TABLE horizon_agent.agent_drafts ADD COLUMN IF NOT EXISTS guard_violations jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE horizon_agent.agent_drafts ADD COLUMN IF NOT EXISTS prompt_hash text;
ALTER TABLE horizon_agent.agent_drafts ADD COLUMN IF NOT EXISTS input_tokens integer;
ALTER TABLE horizon_agent.agent_drafts ADD COLUMN IF NOT EXISTS output_tokens integer;
ALTER TABLE horizon_agent.agent_drafts ADD COLUMN IF NOT EXISTS calls integer;
-- Sinal nao_entendeu do turno; a sequência das linhas mais recentes alimenta failedUnderstandingStreak.
ALTER TABLE horizon_agent.agent_drafts ADD COLUMN IF NOT EXISTS not_understood boolean NOT NULL DEFAULT false;

-- Um rascunho por mensagem gatilho: remove os duplicados mais novos (mantém o menor id)
-- antes de criar o índice único.
DELETE FROM horizon_agent.agent_drafts d
USING horizon_agent.agent_drafts k
WHERE d.trigger_message_id = k.trigger_message_id
  AND d.id > k.id;

CREATE UNIQUE INDEX IF NOT EXISTS agent_drafts_trigger_uidx
  ON horizon_agent.agent_drafts (trigger_message_id);

-- ───────────────────────── prontidão por ação ─────────────────────────
CREATE OR REPLACE VIEW horizon_agent.agent_readiness_by_action AS
SELECT
  coalesce(d.action, 'sem_acao')                                              AS action,
  count(*)                                                                    AS drafts,
  count(*) FILTER (WHERE d.human_action IS NOT NULL)                          AS compared,
  round((count(*) FILTER (WHERE d.human_action IN ('igual','editou'))::numeric
        / nullif(count(*) FILTER (WHERE d.human_action IS NOT NULL), 0)), 3)  AS usable_rate,
  count(*) FILTER (WHERE jsonb_array_length(d.guard_violations) > 0)          AS guard_failures
FROM horizon_agent.agent_drafts d
GROUP BY 1;

-- RLS segue ligado nas tabelas (001); a view não é exposta a anon/authenticated.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON horizon_agent.agent_readiness_by_action FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON horizon_agent.agent_readiness_by_action FROM authenticated';
  END IF;
END $$;

COMMIT;
