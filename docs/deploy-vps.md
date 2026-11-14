# Horizon: operação na VPS

Runbook do ambiente de produção. **Não contém segredos** (só nomes de arquivos e variáveis). Valores ficam no `.env` da VPS e no gerenciador de senhas.

## 1. Visão geral

```
navegador ─► painel (Vercel, pasta web/) ─► BFF (/api/*) ─► https://horizon-api.<IP>.sslip.io
                                                                    │ nginx (TLS, bloqueia rotas do chat)
                                                                    ▼
chat (mesma VPS) ───────────────► http://127.0.0.1:5002 ◄── API Nest (PM2, usuário horizon, PILOT_ONLY=true)
                                                                    │
                                                                    ▼
                                                      Postgres 16 em 127.0.0.1:5432 (banco horizon)
```

- O hostname `sslip.io` **embute o IP da VPS**: se o IP mudar, mude `API_URL` no Vercel, a URL dos webhooks da Twilio e o que apontar para a API. Trocar por domínio próprio é pendência antes de entregar ao cliente.
- A VPS é **compartilhada** com outros projetos (zyra, ginie, inpi, darmais, Ollama, Redis do zyra). Não mexa neles ao mexer no Horizon.

## 2. Onde fica cada coisa

| O quê | Onde |
|---|---|
| Código (clone, branch `Dev-Thulio`) | `/home/horizon/app` (acesso ao GitHub por deploy key **somente leitura**) |
| API (build) | `/home/horizon/app/api/dist/src/main.js` |
| Configuração e segredos da API | `/home/horizon/app/api/.env` (modo 600, dono `horizon`) |
| PM2 | usuário `horizon`, serviço `pm2-horizon`, config `/home/horizon/ecosystem.config.cjs` |
| nginx | `/etc/nginx/sites-available/horizon-api` (link em `sites-enabled`) |
| Postgres | 16, só em `127.0.0.1:5432`; ajustes em `/etc/postgresql/16/main/conf.d/horizon.conf` |
| Senhas do banco | `/home/horizon/.pgpass` (owner) e `/home/horizon/.horizon_app_pw` (API), modo 600 |
| Backup | `/usr/local/bin/horizon-backup.sh`, cron `/etc/cron.d/horizon-backup` (03:15), destino `/var/backups/horizon` |
| Chave pública do backup | `/etc/horizon-backup.pub` (a **privada fica só com o responsável**, nunca na VPS) |
| Logs | `/home/horizon/.pm2/logs/` e `/var/log/horizon-backup.log`; rotação em `/etc/logrotate.d/horizon` |

## 3. Quem é quem no banco

| Usuário | Para quê | Pode |
|---|---|---|
| `horizon_owner` | dono do schema; roda migrations e `pg_dump` | tudo no schema `horizon_agent` |
| `horizon_app` | usado pela API (`PILOT_DATABASE_URL`) | só `SELECT/INSERT/UPDATE/DELETE`; **não** cria nem apaga tabelas. Tem `BYPASSRLS` porque as tabelas têm RLS sem políticas |
| `anon`, `authenticated` | vazios (`NOLOGIN`), existem só porque as migrations 001 e 002 fazem `REVOKE` neles | nada |

## 4. Atualizar a API (deploy)

Como usuário `horizon` (não como root):

```bash
sudo -u horizon -H bash -c 'cd ~ && bash /home/horizon/app/api/scripts/deploy.sh'
```

O script mostra os commits e as migrations que vão entrar, pede confirmação, faz **backup cifrado antes**, atualiza o código (`--ff-only`), instala, compila, aplica as migrations pendentes e reinicia a API conferindo `/health`. Para no primeiro erro e, se falhar depois do reinício, imprime como voltar ao commit anterior.

Limites conhecidos: o build recria `dist/` com a API rodando (alguns segundos de pasta incompleta); o restart tem alguns segundos de indisponibilidade (instância única de propósito: a API roda tarefas agendadas); **as migrations não são desfeitas no rollback**, por isso devem ser aditivas.

Depois de um rollback para um commit antigo, o clone fica sem branch: volte com `git checkout Dev-Thulio` antes do próximo deploy.

### Primeira vez com o `migrate.sh` (uma única vez)
As migrations 001 a 009 foram aplicadas à mão. Registre-as sem reexecutar:

```bash
sudo -u horizon -H bash -c 'cd /home/horizon/app/api && bash scripts/migrate.sh --status'                       # cria a tabela de controle e lista tudo como "pendente"
sudo -u horizon -H bash -c 'cd /home/horizon/app/api && bash scripts/migrate.sh --baseline 009_panel_token_version.sql'
sudo -u horizon -H bash -c 'cd /home/horizon/app/api && bash scripts/migrate.sh --status'                       # tudo "aplicada"
```

## 5. Migrations

- Arquivo novo em `api/db/migrations/NNN_nome_em_minusculas.sql` (próximo número; a `005` não existe e isso é normal).
- **Idempotente** (`IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`) e dentro de `BEGIN; ... COMMIT;`.
- Tabela nova: `ENABLE ROW LEVEL SECURITY`. O dono cria, e a API ganha leitura e escrita automaticamente (privilégios padrão do schema).
- **Nunca edite uma migration já aplicada**: o `migrate.sh` compara checksums e recusa. Corrija com uma migration nova.
- Se a migration for **incompatível** com o código antigo (renomear ou remover coluna), faça em duas etapas (primeiro compatível, depois limpeza), porque o deploy aplica a migration antes de reiniciar a API.

## 6. Painel (Vercel)

- Root Directory `web`; Production Branch `Dev-Thulio`.
- Variáveis: `API_URL` (sem barra final), `BFF_SHARED_KEY` (**igual** à da API; marcar *Sensitive*), `NEXT_PUBLIC_DEMO=false` (com `true` o build de produção **falha de propósito**).
- O plano Hobby do Vercel é de uso **não comercial**: confira o plano antes de colocar cliente.

## 7. Backup e restauração

**Rotina:** todo dia às 03:15 o `horizon-backup.sh` gera `pg_dump` do banco e `pg_dumpall --globals-only` (usuários do Postgres), **cifra na hora** com a chave pública (`age`) e apaga os de mais de 7 dias, **só se os novos deram certo**. Nenhum dado em claro toca o disco. O deploy faz outro backup antes de cada atualização (`~/predeploy-backups`, mantém 5).

**Restaurar (testado em 14/11/2026 num banco temporário):**
1. No PC: `scp root@<VPS>:/var/backups/horizon/horizon-AAAA-MM-DD_HHMM.age .`
2. No PC: `age -d -i horizon-backup.key -o horizon.dump horizon-AAAA-MM-DD_HHMM.age` (o arquivo começa com `PGDMP`).
3. Envie o dump para a VPS, dê o arquivo ao usuário `postgres` (`chmod 600`), crie um banco de teste e restaure: `pg_restore -d <banco_teste> --no-owner --no-privileges horizon.dump`.
4. Confira a contagem de tabelas e apague o banco de teste e o dump em claro (`shred -u`).

**Não testado ainda:** restaurar num servidor novo **com donos e permissões** (precisa recriar os usuários antes, a partir do `globals`, e criar o banco com ICU `pt-BR`). Faça este ensaio antes de depender dele.

**Pendente:** cópia dos backups **fora da VPS** e alerta de falha (hoje, perder a VPS é perder os backups).

## 8. Segredos e chaves

Variáveis do `.env`: `SECRETKEY`, `BFF_SHARED_KEY`, `PILOT_API_KEY`, `PILOT_DATA_KEY`, `PILOT_PHONE_SALT`, `PILOT_DATABASE_URL`.

| Chave | Se perder | Trocar |
|---|---|---|
| `PILOT_DATA_KEY` | mensagens do banco **ilegíveis para sempre** | **não** sem perder dados (há rotação por versão: `PILOT_DATA_KEY_VERSION` + `PILOT_DATA_KEY_V<n>`) |
| `PILOT_PHONE_SALT` | hashes de telefone mudam e o opt-out de leads anonimizados deixa de ser reconhecido | **não** sem quebrar o opt-out |
| chave **privada** do backup (`age`) | backups irrecuperáveis | gere outro par, troque `/etc/horizon-backup.pub`; os backups antigos seguem exigindo a chave antiga |
| `SECRETKEY` | derruba as sessões abertas | sim (edite o `.env` e reinicie a API) |
| `BFF_SHARED_KEY` | sem efeito sobre dados | sim, **nos dois lados** (API e Vercel) |
| `PILOT_API_KEY` | sem efeito sobre dados | sim, nos dois lados (API e chat) |

Guarde `PILOT_DATA_KEY` e `PILOT_PHONE_SALT` no gerenciador de senhas **e** em uma segunda cópia fora do computador. **Nunca** cole valores do `.env` em chat, ticket ou commit.

## 9. Dia a dia

```bash
# estado e logs da API (sempre a partir da pasta do horizon)
sudo -u horizon -H bash -c 'cd ~ && pm2 list && pm2 logs horizon-api --lines 50 --nostream'
curl -s https://horizon-api.<IP>.sslip.io/health

# criar usuário do painel (senha pedida com digitação oculta)
sudo -u horizon -H bash -c 'cd /home/horizon/app/api && npm run panel:create-user -- --email X --name "Nome" --role owner'

# redefinir senha (pede duas vezes; sessões abertas caem em ~5 s; exige a migration 009)
sudo -u horizon -H bash -c 'cd /home/horizon/app/api && npm run panel:reset-password -- --email X'
```

Cuidado: comandos `sudo -u horizon` rodados de dentro de `/root` falham com `EACCES`, porque o `horizon` não acessa essa pasta. Use `cd ~` ou o caminho completo, como acima.

## 10. Segurança: o que está no lugar

- **nginx** só expõe o painel e `/voice/webhooks/*`. Respondem `404` na internet: `POST /pilot/leads`, `PATCH /pilot/leads/:id/qualification`, `/pilot/ingest/*`, `/pilot/events`, `/pilot/shadow/*`, `/pilot/broadcasts/webhook/*`. O chat chama a API por `127.0.0.1:5002`.
- **API** só escuta em loopback (`HOST=127.0.0.1`); em produção recusa subir sem `SECRETKEY`, `BFF_SHARED_KEY`, `PILOT_API_KEY` e `PILOT_DATA_KEY` válidas.
- **Sessão:** o access token vale 15 min, mas a API confere no banco (cache de 5 s, `PANEL_SESSION_CACHE_MS`) se o usuário está ativo e se a `token_version` bate.
- **Servidor:** SSH só por chave, `ufw` liberando 22/80/443, `fail2ban` ativo, Postgres sem porta pública.
- **Não faça:** alterar o código no servidor (o deploy recusa), rodar a API como root, abrir a porta 5432, editar o `.env` de outros projetos.

## 11. Testes de integração (banco real)

A suíte local pula 79 testes que precisam de um Postgres de verdade (LGPD, autenticação, voz, conversas, disparos e as migrations). Na VPS existe o banco descartável `horizon_test` (**nunca** rode isto apontando para o `horizon`). Cada teste roda numa transação desfeita (`ROLLBACK`) e as suítes conferem que nada sobrou.

```bash
# 1) (só se o banco de teste estiver vazio ou desatualizado) aplicar as migrations nele
sudo -u horizon -H bash -c 'cd /home/horizon/app/api && PGDATABASE=horizon_test bash scripts/migrate.sh'

# 2) rodar as 6 suítes de integração (a senha é lida do ~/.pgpass, sem aparecer)
sudo -u horizon -H bash -c 'cd /home/horizon/app/api && PW=$(grep ":horizon_test:" ~/.pgpass | cut -d: -f5) && PILOT_TEST_DATABASE_URL="postgres://horizon_owner:${PW}@127.0.0.1:5432/horizon_test" npx jest --runInBand --testTimeout=60000 integration 2>&1 | grep -vE "^\s+at " | tail -40'
```

Resultado de referência (14/11/2026): 6 suítes, 79 testes, 0 falhas. Rode depois de qualquer mudança em SQL, migrations ou no `PgService`. O banco precisa de SSL ligado (`show ssl` = `on`, padrão do Ubuntu), porque os testes conectam exigindo SSL.

**Pool de conexões:** a API usa **um único** `PgService` (módulo `PgModule`), com `PILOT_DB_POOL_MAX` conexões (padrão 10), mais 1 da trava de sessão do worker. O teste `pg.module.spec.ts` falha se algum módulo voltar a declarar o próprio `PgService`. Para conferir em produção: `sudo -u postgres psql -Atc "select count(*) from pg_stat_activity where datname='horizon'"` (deve ficar em até ~11 com a API ociosa ou sob carga leve).

## 12. Pendências conhecidas

Cópia externa dos backups e alerta de falha; textos legais da `/privacidade` e atualização do ROPA (`docs/lgpd`); integrações nunca testadas com serviço real (Twilio, Anthropic, Pipedrive, Google Calendar); ligar o chat (`wid`, `PILOT_REQUIRE_WID`, assinatura); domínio próprio; senha no Redis do zyra; pacotes do `apt` por atualizar.
