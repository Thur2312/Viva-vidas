-- Horizon Agent: uma conversa por (lead, canal). Aditivo e idempotente. Somente schema horizon_agent.
-- Reversivel: DROP INDEX horizon_agent.conversations_lead_channel_uidx;
--
-- Por que: ingestMessage fazia SELECT e depois INSERT, sem trava. Duas primeiras mensagens simultaneas do mesmo lead
-- criavam DUAS conversas, e as mensagens da mais nova ficavam invisiveis. Com este indice, a ingestao usa
-- INSERT ... ON CONFLICT (lead_id, channel), que e atomico.
-- (lead_id, channel) e nao so lead_id: a tabela tem `channel`, e um canal novo no futuro nao deve exigir desfazer isto.
--
-- ATENCAO: se ja houver lead com mais de uma conversa no mesmo canal, esta migration ABORTA sem alterar nada.
-- Para listar os casos:
--   SELECT lead_id, channel, count(*) FROM horizon_agent.conversations GROUP BY 1, 2 HAVING count(*) > 1;
-- Mesclar conversas (mover mensagens e rascunhos) e uma decisao de dados, por isso nao e feita automaticamente.
--
-- Nota: o CREATE UNIQUE INDEX bloqueia escritas em `conversations` enquanto roda. Com a tabela pequena do piloto
-- e instantaneo; numa tabela grande, usar CREATE UNIQUE INDEX CONCURRENTLY (fora de transacao).

BEGIN;

DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM (
    SELECT 1 FROM horizon_agent.conversations GROUP BY lead_id, channel HAVING count(*) > 1
  ) d;
  IF n > 0 THEN
    RAISE EXCEPTION 'Ha % lead(s) com mais de uma conversa no mesmo canal. Resolva antes (consulta no cabecalho desta migration).', n;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS conversations_lead_channel_uidx ON horizon_agent.conversations (lead_id, channel);

COMMIT;
