#!/usr/bin/env bash
# Aplica as migrations pendentes de api/db/migrations, em ordem, e registra cada uma em
# horizon_agent.schema_migrations (nome + checksum). Assim ninguem precisa lembrar o que ja rodou.
#
#   bash scripts/migrate.sh                  aplica as pendentes
#   bash scripts/migrate.sh --status         mostra aplicada / pendente / ALTERADA, sem aplicar nenhuma migration
#                                            (so cria a tabela de controle schema_migrations, se ainda nao existir)
#   bash scripts/migrate.sh --baseline ARQ   registra como aplicadas (SEM executar) todas as migrations ate ARQ.
#                                            Uso unico, em banco que ja tinha as migrations aplicadas a mao.
#
# Seguranca:
#  - Recusa aplicar se uma migration JA aplicada foi alterada (checksum diferente): migration aplicada e historia.
#  - Recusa aplicar num banco que ja tem tabelas mas nenhum registro (use --baseline antes), para nao reexecutar tudo.
#  - Cada migration tem o proprio BEGIN/COMMIT: se uma falhar, ela e desfeita inteira; as anteriores ficam.
#    Se o processo morrer ENTRE o COMMIT e o registro, a migration roda de novo no proximo deploy:
#    por isso toda migration deve ser idempotente (IF NOT EXISTS, etc.), como as atuais.
#
# Conexao: psql como dono do schema (horizon_owner). A senha vem do ~/.pgpass: nenhuma senha neste arquivo.
# Variaveis opcionais: PGHOST (127.0.0.1), PGPORT (5432), PGUSER (horizon_owner), PGDATABASE (horizon).
set -Eeuo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
DIR=db/migrations
export PGHOST="${PGHOST:-127.0.0.1}" PGPORT="${PGPORT:-5432}" PGUSER="${PGUSER:-horizon_owner}" PGDATABASE="${PGDATABASE:-horizon}"

die() { echo "ERRO: $*" >&2; exit 1; }
sql() { psql -X -q -v ON_ERROR_STOP=1 "$@"; }

mode=apply
baseline_to=""
case "${1:-}" in
  "") ;;
  --status) mode=status ;;
  --baseline)
    mode=baseline
    baseline_to="${2:-}"
    [ -n "$baseline_to" ] || die "informe o arquivo: --baseline 009_nome.sql"
    ;;
  *) die "uso: migrate.sh [--status | --baseline ARQUIVO]" ;;
esac

ensure_table() {
  sql <<'SQL'
CREATE SCHEMA IF NOT EXISTS horizon_agent;
CREATE TABLE IF NOT EXISTS horizon_agent.schema_migrations (
  filename   text PRIMARY KEY,
  checksum   text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE horizon_agent.schema_migrations ENABLE ROW LEVEL SECURITY;
-- So o dono mexe aqui: a API (horizon_app) nao precisa e nao deve alterar o historico de migrations.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'horizon_app') THEN
    EXECUTE 'REVOKE ALL ON horizon_agent.schema_migrations FROM horizon_app';
  END IF;
END $$;
SQL
}

recorded() {  # $1 = arquivo -> imprime o checksum registrado (vazio se nao houver)
  sql -At -v n="$1" <<'SQL'
SELECT checksum FROM horizon_agent.schema_migrations WHERE filename = :'n';
SQL
}

record() {  # $1 = arquivo, $2 = checksum
  sql -v n="$1" -v c="$2" <<'SQL'
INSERT INTO horizon_agent.schema_migrations (filename, checksum) VALUES (:'n', :'c');
SQL
}

count_recorded() {
  sql -At <<'SQL'
SELECT count(*) FROM horizon_agent.schema_migrations;
SQL
}

has_tables() {  # imprime t se o banco ja tem as tabelas do Horizon
  sql -At <<'SQL'
SELECT to_regclass('horizon_agent.leads') IS NOT NULL;
SQL
}

# Checksum ignorando fim de linha (CRLF x LF): o mesmo arquivo nao pode "mudar" por causa do sistema.
checksum_of() { tr -d '\r' < "$1" | sha256sum | cut -d' ' -f1; }

state_of() {  # $1 = arquivo, $2 = checksum atual -> pendente | aplicada | ALTERADA
  local rec
  rec=$(recorded "$1")
  if [ -z "$rec" ]; then echo pendente
  elif [ "$rec" = "$2" ]; then echo aplicada
  else echo ALTERADA
  fi
}

mapfile -t files < <(cd "$DIR" && ls -1 | LC_ALL=C sort)
[ "${#files[@]}" -gt 0 ] || die "nenhuma migration em $DIR"
for f in "${files[@]}"; do
  [[ "$f" =~ ^[0-9]{3}_[a-z0-9_]+\.sql$ ]] || die "nome de migration invalido: $f (use NNN_nome_em_minusculas.sql)"
done

ensure_table

if [ "$mode" = baseline ]; then
  found=0
  for f in "${files[@]}"; do [ "$f" = "$baseline_to" ] && found=1; done
  [ "$found" = 1 ] || die "arquivo nao encontrado em $DIR: $baseline_to"
fi

declare -a sums=() states=()
changed=0
pending=0
for f in "${files[@]}"; do
  s=$(checksum_of "$DIR/$f")
  st=$(state_of "$f" "$s")
  sums+=("$s")
  states+=("$st")
  [ "$st" = ALTERADA ] && changed=$((changed + 1))
  [ "$st" = pendente ] && pending=$((pending + 1))
done

if [ "$mode" = status ]; then
  for i in "${!files[@]}"; do printf '%-9s %s\n' "${states[$i]}" "${files[$i]}"; done
  echo "-- $pending pendente(s), $changed alterada(s)"
  [ "$changed" -eq 0 ] || exit 1
  exit 0
fi

[ "$changed" -eq 0 ] || die "migration(s) ja aplicada(s) foram ALTERADAS (rode --status). Corrija o arquivo: nao se edita migration aplicada; crie uma nova."

if [ "$mode" = baseline ]; then
  for i in "${!files[@]}"; do
    f="${files[$i]}"
    if [ "${states[$i]}" = pendente ]; then
      record "$f" "${sums[$i]}"
      echo "registrada (sem executar): $f"
    fi
    [ "$f" = "$baseline_to" ] && break
  done
  echo "baseline concluido ate $baseline_to"
  exit 0
fi

if [ "$(count_recorded)" = "0" ] && [ "$(has_tables)" = "t" ]; then
  die "o banco ja tem as tabelas do Horizon, mas nenhuma migration registrada. Rode antes: migrate.sh --baseline <ultima migration ja aplicada>"
fi

if [ "$pending" -eq 0 ]; then
  echo "Nenhuma migration pendente."
  exit 0
fi

for i in "${!files[@]}"; do
  [ "${states[$i]}" = pendente ] || continue
  f="${files[$i]}"
  echo "aplicando $f ..."
  sql -f "$DIR/$f"
  record "$f" "${sums[$i]}"
done
echo "$pending migration(s) aplicada(s)."
