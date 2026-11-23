# Horizon Agent

Agente comercial por IA no WhatsApp com tracking de Meta Ads (projeto Alberto Apolinário, proposta HZ-2026-0003).

## Estrutura (monorepo: um repositório, duas pastas)

| Pasta | O que é | Como rodar |
|---|---|---|
| [`api/`](api/README.md) | Backend NestJS: CRM, tracking, Meta Ads, piloto (leads, conversas, modo sombra), disparos, voz, LGPD e login do painel | `cd api && npm ci && npm run start:pilot` |
| [`web/`](web/README.md) | Painel Next.js: dashboard, funil, conversas, voz, disparos, decisão do piloto | `cd web && npm ci && npm run dev` (porta 3100) |
| [`docs/`](docs) | Agente de vendas, LGPD, voz, disparos e WhatsApp oficial | |

O navegador só fala com o `web/`. O `web/` fala com a `api/` por um servidor intermediário (BFF), nunca direto do navegador.

O chat roda fora deste repositório: cópia do hdmchat-api em `D:/Projetos/horizon-chat-api`.

## Fases do agente de vendas

1. **Fase 1 (esta entrega):** cérebro de vendas em modo sombra e editor de playbook em `/agente`. Nada é enviado ao lead.
2. **Fase 2:** envio autônomo, follow-up, agenda e CRM. **Fase 3:** voz. Ambas fora desta entrega; a parte autônoma espera o número oficial do WhatsApp.

Ainda pendente, entre outros: o lado do chat da assinatura HMAC (`PILOT_SIGNING_REQUIRED`). Detalhes e pendências conhecidas do agente em [`docs/agente-vendas.md`](docs/agente-vendas.md).

## Documentação

- [`docs/agente-vendas.md`](docs/agente-vendas.md): cérebro de vendas, playbook, guarda-corpos, eval, deploy
- [`docs/disparos.md`](docs/disparos.md): disparos e saúde do número
- [`docs/voice.md`](docs/voice.md): voz
- [`docs/whatsapp-oficial.md`](docs/whatsapp-oficial.md): WhatsApp oficial
- [`docs/chat-integracao.md`](docs/chat-integracao.md): integração com o chat
- [`docs/deploy-vps.md`](docs/deploy-vps.md): deploy na VPS
- [`docs/google-calendar.md`](docs/google-calendar.md): Google Agenda
- [`docs/design-system.md`](docs/design-system.md): design system do painel
- [`docs/lgpd/`](docs/lgpd/README.md): conformidade LGPD

## Notas

- Nenhum segredo foi copiado. Use cada `.env.example` como modelo.
- No chat, `deploy.sh` e `Dockerfile` são herdados e apontam para a infra antiga (pm2 `multipremium-back`); revisar antes de qualquer deploy.
- Branches: `Dev-Daniel` é a principal; o trabalho entra por `Dev-Thulio`.
