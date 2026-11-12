# Horizon Agent

Agente comercial por IA no WhatsApp com tracking de Meta Ads (projeto Alberto Apolinário, proposta HZ-2026-0003).

## Estrutura (monorepo: um repositório, duas pastas)

| Pasta | O que é | Como rodar |
|---|---|---|
| [`api/`](api/README.md) | Backend NestJS: CRM, tracking, Meta Ads, piloto (leads, conversas, modo sombra), disparos, voz, LGPD e login do painel | `cd api && npm ci && npm run start:pilot` |
| [`web/`](web/README.md) | Painel Next.js: dashboard, funil, conversas, voz, disparos, decisão do piloto | `cd web && npm ci && npm run dev` (porta 3100) |
| [`docs/`](docs) | LGPD, voz, disparos e WhatsApp oficial | |

O navegador só fala com o `web/`. O `web/` fala com a `api/` por um servidor intermediário (BFF), nunca direto do navegador.

O chat roda fora deste repositório: cópia do hdmchat-api em `D:/Projetos/horizon-chat-api`.

## Pendente

Pipedrive, Google Agenda, ferramentas do agente (qualificar, agendar, CRM), captura de `ctwa_clid`, Conversions API, registro de custo de tokens e voz, e o lado do chat da assinatura HMAC (`PILOT_SIGNING_REQUIRED`).

## Notas

- Nenhum segredo foi copiado. Use cada `.env.example` como modelo.
- No chat, `deploy.sh` e `Dockerfile` são herdados e apontam para a infra antiga (pm2 `multipremium-back`); revisar antes de qualquer deploy.
- Branches: `Dev-Daniel` é a principal; o trabalho entra por `Dev-Thulio`.
