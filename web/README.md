# Painel (web) — Horizon Agent

Dashboard, funil, origem e anúncios, conversas, voz, disparos, playbook e a tela de **decisão do piloto** (custo por qualificado, funil contra a base atual, comissão e caminho até a meta).

Next.js 15 (App Router) + React 18 + Tailwind 3 + TanStack Query. O backend fica em [`../api`](../api/README.md).

## Como fala com a API

O navegador nunca chama a API. Tudo passa pelo **BFF** (rotas em `src/app/api/**`):

- Os tokens ficam em cookies `httpOnly` (`hz_at`, `hz_rt`); o JS do navegador não os vê.
- Lista fechada de rotas e parâmetros em `src/app/api/pilot/[...path]/route.ts`. Endpoint novo na API só chega ao painel se for liberado ali.
- Mutações exigem mesma origem (proteção contra CSRF).
- O BFF repassa o IP real do usuário com `BFF_SHARED_KEY` (mesmo valor da API).

## Rodar local

```powershell
npm ci
copy .env.example .env.local   # API_URL, BFF_SHARED_KEY...
npm run dev                    # http://localhost:3100
```

`NEXT_PUBLIC_DEMO=true` mostra dados de demonstração sem login. Nunca em produção.

## Verificação

```powershell
npm run typecheck
npm run build
npm audit --omit=dev
```

## Deploy (Vercel)

Projeto Vercel com **Root Directory = `web`**. Variáveis: `API_URL` (URL pública da API, https), `BFF_SHARED_KEY`, `REFRESH_COOKIE_DAYS` (opcional) e as `NEXT_PUBLIC_*` do `.env.example`. A Vercel é serverless: o cache de refresh do BFF é por instância (ver `src/lib/api.ts`).

## Contrato com a API

Tipos das respostas em `src/lib/types.ts` (copiados à mão do backend). Se a API mudar o formato, atualize aqui no mesmo commit.

## Design

O painel segue a identidade já existente (tokens em `tailwind.config.ts` e `src/app/globals.css`). `docs/design-system.md` ainda não existe: criar antes de qualquer UI nova grande.
