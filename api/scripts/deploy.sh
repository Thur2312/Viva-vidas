#!/usr/bin/env bash
# Deploy da API do Horizon na VPS. Rode como o usuario `horizon` (nunca como root):
#
#   bash /home/horizon/app/api/scripts/deploy.sh          pergunta antes de aplicar
#   bash /home/horizon/app/api/scripts/deploy.sh --yes    sem pergunta (para automacao)
#
# Ordem (para no PRIMEIRO erro, sem seguir adiante):
#   1. recusa se o clone tiver alteracao local ou se o historico divergiu;
#   2. mostra os commits que vao entrar e as migrations novas;
#   3. backup cifrado do banco ANTES de mexer em qualquer coisa (mantem os 5 ultimos);
#   4. git merge --ff-only; npm ci; prisma generate; build;
#   5. migrations pendentes (migrate.sh), ANTES de reiniciar: o codigo novo ja encontra o schema novo;
#   6. pm2 restart e confere o /health. Se falhar, imprime como voltar ao commit anterior.
#
# Limites conhecidos (ver docs/deploy-vps.md):
#   - o build apaga e recria dist/ com a API ainda rodando (alguns segundos de dist incompleto; o Node ja carregou o codigo);
#   - o restart tem alguns segundos de indisponibilidade (instancia unica, de proposito);
#   - migrations NAO sao desfeitas no rollback: sao aditivas; o codigo antigo convive com o schema novo.
set -Eeuo pipefail

APP="${APP_DIR:-/home/horizon/app}"
API="$APP/api"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:5002/health}"
PM2_APP="${PM2_APP:-horizon-api}"
BACKUP_DIR="$HOME/predeploy-backups"
RECIPIENTS=/etc/horizon-backup.pub

die() { echo "ERRO: $*" >&2; exit 1; }

yes=0
case "${1:-}" in
  "") ;;
  --yes) yes=1 ;;
  *) die "uso: deploy.sh [--yes]" ;;
esac

[ "$(id -u)" -ne 0 ] || die "nao rode como root: use o usuario horizon"
command -v age >/dev/null || die "age nao encontrado (apt install age)"
[ -r "$RECIPIENTS" ] || die "chave publica do backup ausente: $RECIPIENTS"

cd "$APP"
[ -z "$(git status --porcelain)" ] || die "o clone tem alteracoes locais (git status). No servidor nao se edita codigo: resolva antes."
BRANCH=$(git rev-parse --abbrev-ref HEAD)
[ "$BRANCH" != HEAD ] || die "HEAD solto (sem branch). Volte para uma branch: git checkout <branch>"
OLD=$(git rev-parse HEAD)

git fetch --quiet origin "$BRANCH"
NEW=$(git rev-parse "origin/$BRANCH")
if [ "$OLD" = "$NEW" ]; then
  echo "Nada novo em $BRANCH (${OLD:0:7})."
  exit 0
fi
git merge-base --is-ancestor "$OLD" "$NEW" || die "o historico de origin/$BRANCH nao contem o commit atual (force-push?). Investigue antes de aplicar."

echo "Branch: $BRANCH   ${OLD:0:7} -> ${NEW:0:7}"
echo "Commits que vao entrar:"
git --no-pager log --oneline "$OLD..$NEW"
echo "Migrations novas ou alteradas neste deploy:"
git --no-pager diff --name-status "$OLD" "$NEW" -- api/db/migrations | sed 's/^/  /' || true

if [ "$yes" -ne 1 ]; then
  [ -t 0 ] || die "sem terminal para confirmar: use --yes"
  read -r -p "Aplicar? [s/N] " ans
  [[ "$ans" =~ ^[sS]$ ]] || { echo "Cancelado."; exit 0; }
fi

rollback_hint() {
  echo >&2
  echo "FALHOU. A API pode estar fora do ar ou em estado intermediario." >&2
  echo "Para voltar ao codigo anterior (as migrations aplicadas ficam: sao aditivas):" >&2
  echo "  git -C $APP checkout --detach ${OLD}   # ou: git -C $APP reset --hard ${OLD}" >&2
  echo "  cd $API && npm ci && npm run prisma:generate && npm run build && pm2 restart $PM2_APP" >&2
  echo "Backup feito antes do deploy: ${OUT:-<nao chegou a ser feito>}" >&2
}
trap rollback_hint ERR

install -d -m 700 "$BACKUP_DIR"
OUT="$BACKUP_DIR/pre-$(date +%F_%H%M)-${OLD:0:7}.dump.age"
echo "Backup pre-deploy -> $OUT"
pg_dump -Fc -h 127.0.0.1 -U horizon_owner horizon | age -R "$RECIPIENTS" > "$OUT.partial"
[ -s "$OUT.partial" ] || die "backup pre-deploy vazio"
mv "$OUT.partial" "$OUT"
# mantem so os 5 mais recentes
# shellcheck disable=SC2012
ls -1t "$BACKUP_DIR"/pre-*.age 2>/dev/null | tail -n +6 | xargs -r rm --

git merge --ff-only "$NEW"
cd "$API"
npm ci --no-audit --no-fund
npm run prisma:generate
npm run build
bash scripts/migrate.sh

pm2 restart "$PM2_APP"
sleep 5
if curl -fsS -m 5 "$HEALTH_URL" | grep -q '"status":"ok"'; then
  trap - ERR
  echo "OK: $PM2_APP no ar em ${NEW:0:7}."
else
  false  # dispara o trap ERR com as instrucoes de volta
fi
