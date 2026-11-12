# Horizon Agent

Agente comercial por IA no WhatsApp com tracking de Meta Ads (projeto Alberto Apolinário, proposta HZ-2026-0003).

## Estrutura
- `api/` — backend de CRM, tracking e Meta Ads (NestJS + Prisma), extraído de módulos do hdm-api.
- `web/` — interface do painel (a criar), parecida com o HDM e com a proposta de "super funcionário".
- O chat roda fora deste repositório: cópia do hdmchat-api em `D:/Projetos/horizon-chat-api`.

## Pendente
Pipedrive, ferramentas do agente (qualificar, agendar, CRM), captura de `ctwa_clid`, Conversions API e a interface.

## Notas
- Nenhum segredo foi copiado. Use `.env.example` como modelo.
- No chat, `deploy.sh` e `Dockerfile` são herdados e apontam para a infra antiga (pm2 `multipremium-back`); revisar antes de qualquer deploy.
