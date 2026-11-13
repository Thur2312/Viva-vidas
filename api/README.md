# API — Horizon Agent

Backend do agente: CRM, tracking e Meta Ads, módulo do piloto (leads, conversas, modo sombra), disparos, voz, LGPD e login do painel.

NestJS 11 + PostgreSQL (SQL parametrizado no schema `horizon_agent`) + Prisma nos módulos herdados do hdm-api.

O painel fica em [`../web`](../web/README.md) e fala com esta API só pelo BFF (servidor Next).

## Rodar local

```powershell
npm ci
npm run prisma:generate
copy .env.example .env   # preencha os valores; nunca commite o .env
npm run start:pilot      # sobe so o piloto (PILOT_ONLY=true), sem Redis/RabbitMQ
```

Redefinir a senha de alguém (quem administra o servidor): `npm run panel:reset-password -- --email a@b.com`. Grava a senha nova, libera a conta bloqueada, revoga os refresh tokens e aumenta `token_version` (as sessões abertas caem em poucos segundos: a API confere a versão a cada requisição, com cache de `PANEL_SESSION_CACHE_MS`, padrão 5000 ms; exige a migration `009_panel_token_version.sql`) e registra na auditoria com o usuário do sistema que rodou o script. Pelo prompt, a senha é pedida duas vezes. Entregue a senha nova por um canal seguro. Não há recuperação por e-mail: o painel não tem envio de e-mail.

Criar o primeiro usuário do painel: `npm run panel:create-user -- --email a@b.com --name "Fulano" --role owner`.

Migrations SQL em `db/migrations/` (aplicar na ordem; não alterar schema pelo painel do banco).

## Verificação

```powershell
npm run build     # nest build (tambem e a checagem de tipos)
npx jest          # 6 suites de integracao so rodam com PILOT_TEST_DATABASE_URL
npx eslint "{src,test}/**/*.ts"
npm audit --omit=dev
```

`npm run typecheck` inclui os `.spec.ts`, que hoje acusam erros de tipo do Prisma nos testes de tracking; use `npm run build` como checagem de tipos. `npm run lint` usa `--fix` e reescreve arquivos: para só conferir, use o `npx eslint` acima.

## Contrato com o front

O front depende do formato das respostas desta API (`../web/src/lib/types.ts`, copiado à mão). Mudou o formato? Atualize os dois no mesmo commit.

`BFF_SHARED_KEY` precisa ter o **mesmo valor** aqui e no `web/`. Em produção é **obrigatória** (32+ caracteres): sem ela a API não sobe. Fora da Vercel, o proxy deve sobrescrever o `x-real-ip` (o BFF só confia nele).

## Produção: o que não pode faltar

- `NODE_ENV=production` e `SECRETKEY` com 32+ caracteres aleatórios (o boot é recusado se for fraca).
- `PILOT_ONLY=true` **ou** `TENANT_GUARD_ENFORCE=true` (o boot é recusado sem um dos dois).
- `PILOT_API_KEY` (chat → API). Sem ela as rotas de ingestão ficam fechadas.
- `PILOT_DATA_KEY` (criptografia das mensagens, 32 bytes em base64) e `BFF_SHARED_KEY`.
- `PILOT_DB_CA` se o provedor do banco usar uma CA que o Node não conhece (o certificado é verificado em produção).
- `PILOT_SIGNING_REQUIRED=true` só depois que o chat passar a assinar as chamadas (`x-pilot-timestamp` + `x-pilot-signature`, HMAC-SHA256 de `timestamp.corpo`).
- Hospedagem com **processo contínuo** (VPS, Railway, Fly): a API roda tarefas agendadas e o worker de disparos. Não use serverless.

## Documentação

[`../docs`](../docs): LGPD (checklist, ROPA, RIPD, políticas, incidentes), voz, disparos e WhatsApp oficial.
