# Integração API <-> Chat (horizon-chat)

O chat roda fora deste repositório (cópia do hdmchat-api) na mesma VPS da API. Sem segredos neste arquivo.

## Topologia (VPS Horizon)
| Peça | Onde | Porta |
|---|---|---|
| API (este repo, `api/`) | pm2 `horizon-api` (usuário `horizon`), `/home/horizon/app/api` | `127.0.0.1:5002` |
| Chat | pm2 `horizon-chat` (root), `/opt/horizon-chat` | `4010` (fechada no firewall) |
| Chat público (nginx + SSL) | `https://horizon-chat.179-199-135-212.sslip.io` -> `127.0.0.1:4010` | 443 |

Os dois falam por loopback; a porta 4010 não é exposta.

## Variáveis (nomes apenas)
**API (`api/.env`)**: `CHAT_API_URL=http://127.0.0.1:4010`, `CHAT_BRIDGE_KEY`, `CHAT_CONNECTION_ID` (id da conexão no chat, depois de criada).
**Chat (`.env`)**: `CHAT_BRIDGE_KEY` (mesmo valor da API), `PILOT_INGEST_URL=http://127.0.0.1:5002`, `PILOT_API_KEY` (mesmo valor do `PILOT_API_KEY` da API), `PILOT_CONNECTION_IDS` (ids de `Whatsapps.id`, separados por vírgula).

Direções: API -> chat usa `x-pilot-key: CHAT_BRIDGE_KEY` em `/pilot-bridge/*`; chat -> API usa `x-pilot-key: PILOT_API_KEY` em `/pilot/ingest/*`. As duas chaves são distintas. Sem `PILOT_INGEST_URL`, `PILOT_API_KEY` e `PILOT_CONNECTION_IDS` o envio do chat para a API fica desligado.

## Verificação
- Sem chave: `GET /pilot-bridge/number-health` -> 401.
- Com `CHAT_BRIDGE_KEY` e sem conexão -> `400 connection_required` (ponte OK, falta conexão).

## Banco do chat
O repositório do chat só traz 10 migrations (afiliados/idiomas); o schema base foi criado com `sequelize.sync()` a partir dos models (106 tabelas, FKs adicionadas depois por causa de dependências cíclicas Tickets/crm_leads). Ficaram sem FK: `Messages.quotedMsgId` e `Chatbots.queueId`.

## Pendente
1. Criar a conexão do número oficial no chat (token permanente, ID do número, ID da WABA, `VERIFY_TOKEN`) e preencher `CHAT_CONNECTION_ID` na API e `PILOT_CONNECTION_IDS` no chat.
2. Webhook da Meta apontando para o chat público.
3. Opcional: `NEXT_PUBLIC_CHAT_URL` na Vercel para o botão "Conversas".
