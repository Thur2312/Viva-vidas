# Integração API <-> Chat (horizon-chat, WhatsApp não oficial via Baileys)

O chat roda fora deste repositório (cópia do hdmchat-api) na mesma VPS da API. Conexão por QR code; não usa credenciais da Meta. Sem segredos neste arquivo.

## Topologia (VPS Horizon)
| Peça | Onde | Porta |
|---|---|---|
| API (`api/`) | pm2 `horizon-api` (usuário `horizon`), `/home/horizon/app/api` | `127.0.0.1:5002` |
| Chat | pm2 `horizon-chat` (root), `/opt/horizon-chat` | `4010` (fechada no firewall) |
| Chat público (nginx + SSL) | `horizon-chat.179-199-135-212.sslip.io` -> `127.0.0.1:4010` | 443 |

API e chat falam por loopback.

## Variáveis (só nomes)
- **API (`api/.env`)**: `CHAT_API_URL=http://127.0.0.1:4010`, `CHAT_BRIDGE_KEY`, `CHAT_CONNECTION_ID`.
- **Chat (`.env`)**: `CHAT_BRIDGE_KEY` (igual ao da API), `PILOT_INGEST_URL=http://127.0.0.1:5002`, `PILOT_API_KEY` (igual ao da API), `PILOT_CONNECTION_IDS`.

API -> chat: `x-pilot-key: CHAT_BRIDGE_KEY` em `/pilot-bridge/*`. Chat -> API: `x-pilot-key: PILOT_API_KEY` em `/pilot/ingest/*`. Chaves distintas.

## Conectar o número (painel)
Painel > Integrações > **WhatsApp**: mostra o estado da conexão e, enquanto aguarda pareamento, o QR (renova sozinho). No celular: WhatsApp > Aparelhos conectados > Conectar um aparelho. **Só o dono do painel vê o QR** (é credencial de sessão; resposta `no-store`).

Fluxo: painel (BFF `/api/pilot/whatsapp/connection`) -> API `GET /pilot/whatsapp/connection` (role owner) -> chat `GET /pilot-bridge/connection`.

## Limitações (API não oficial)
- `number-health` e templates oficiais não se aplicam (o chat responde `unsupported_channel`); o monitor de qualidade fica "indisponível".
- Risco de bloqueio do número em disparo em massa ou mensagem fria: volume baixo e só contatos com opt-in.

## Banco do chat
O repo do chat só traz 10 migrations; o schema base foi criado com `sequelize.sync()` a partir dos models (106 tabelas; FKs adicionadas depois por causa de ciclos Tickets/crm_leads). Ficaram sem FK: `Messages.quotedMsgId` e `Chatbots.queueId`.

## Estado atual
Conexão id 1 ("Horizon WhatsApp") criada no chat; `CHAT_CONNECTION_ID=1` e `PILOT_CONNECTION_IDS=1` já definidos. Falta alguém com acesso ao número escanear o QR.
