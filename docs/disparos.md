# Disparos (broadcasts) e saúde do número

Mensagens ativas por WhatsApp Oficial, somente para quem deu consentimento. **Nada aqui foi testado contra a Meta nem contra um chat real** (sem credenciais): o envio passa por um dublê nos testes. Interruptor geral desligado por padrão.

## Regras que o código impõe (falham fechado)
| Porta | Onde |
|---|---|
| `can_contact` (opt-out, anonimizado, marketing revogado) | público e, de novo, a cada destinatário no envio |
| Consentimento ATIVO com origem registrada: `marketing` (template de marketing) ou `atendimento` (utilidade / texto na janela) | idem |
| Telefone BR válido | idem |
| Template `APPROVED` no momento do envio (cache sincronizado há < 10 min; desconhecido há > 1h = não envia) | início e cada ciclo |
| Marketing exige aviso de saída ("responda PARAR/SAIR" no texto ou botão QUICK_REPLY) | criar template e iniciar |
| Janela de envio (padrão 09:00-18:00, seg-sex, America/Sao_Paulo; configurável) | cada ciclo e cada destinatário. **Confirmar com o jurídico e a regra da Anatel** |
| Frequência: máx. 1 marketing / 7 dias por lead, entre todos os disparos | público e envio |
| Texto livre só até 24h da última mensagem do lead | público e envio |
| `BROADCASTS_ENABLED` (padrão desligado; só `true`/`1`) | iniciar, retomar e worker. Com ele desligado só a simulação (dry-run) roda |
| Variável vazia => lead pulado (nunca vai em branco) | público e envio |
| Unicidade `(broadcast_id, lead_id)` + reivindicação atômica `UPDATE ... WHERE status='pending' ... FOR UPDATE SKIP LOCKED RETURNING` | worker |

Todo motivo de pulo é gravado em `broadcast_recipients.skip_reason`. Auditoria (`audit_log`, sem PII): `broadcast.create|start|pause|resume|cancel|batch|autopause`, `broadcast.template_create`.

## Vazão e resiliência
- `rate_per_minute` (padrão 20, máx. 60), `daily_cap` (padrão 200), teto global `BROADCASTS_GLOBAL_DAILY_CAP` (padrão 250) somando todos os disparos reais do dia.
- Ciclo a cada 15 s (`@Interval`), sob `pg_try_advisory_lock` (conexão dedicada; exige conexão direta, não pgbouncer em modo transação). Budget = `min(rate - enviados_60s, ceil(rate*15/60), teto_dia, global)`.
- 429/5xx/timeout do chat: backoff exponencial 30s, 1m, 2m... (teto 1h), até 5 tentativas, depois `failed` com `error_code` (`chat_429`, `chat_timeout`...). 4xx = falha definitiva.
- **No máximo uma vez**: "em fila" há mais de 5 min (processo caiu) vira `failed/envio_interrompido`, nunca é reenviado.
- Auto-pausa: > 30% de falha nos últimos 20 envios reais (mín. 5), contados só depois da última retomada.
- Chat não configurado (503) ou template deixou de ser aprovado: pausa o disparo.

## Saúde do número (qualidade Meta)
Tabela `number_health_snapshots` (007). Worker lê a cada 15 min via `ChatGatewayService.numberHealth()` -> chat `GET /pilot-bridge/number-health` (só com chat configurado **e** `BROADCASTS_ENABLED`). Política (`health-policy.ts`, testada em matriz):
- **Pausa todos os disparos reais e bloqueia novos inícios**: qualidade VERMELHA; qualidade caiu vs. leitura anterior; tier/limite diminuiu; status diferente de `CONNECTED`; conta WABA com `account_review_status` diferente de `APPROVED`; leitura com mais de 60 min (ou inexistente) quando há disparo rodando/iniciando.
- **AMARELA** (ou sem classificação): aviso e velocidade pela metade, sem pausar.
- `daily_cap` efetivo = `min(daily_cap, limite diário real do número)`; o teto global também respeita o limite real.
- **Retomada só manual** (`POST .../resume {confirm:true}`), com auditoria, e o servidor reconfere a saúde (409 se ainda houver risco).
- Webhook da Meta `phone_number_quality_update` (o chat encaminha): `POST /pilot/broadcasts/webhook/quality {event, currentLimit?, displayPhoneNumber?}` (`x-pilot-key`). Força releitura; se falhar num rebaixamento (`DOWNGRADE`/`FLAGGED`), grava leitura VERMELHA (falha fechado).
- Decisão: qualidade `UNKNOWN` (número novo) = aviso com metade da velocidade, não bloqueio. Revise se preferir bloquear.

## Endpoints (API, prefixo `/pilot/broadcasts`)
| Método e caminho | Papel |
|---|---|
| `GET /` lista com contagens e `safety` | viewer |
| `GET /:id` KPIs, funil (enviado→entregue→lido→respondeu→convertido via `lead_events` reunião/venda em 30 dias), erros por código, pulos por motivo | viewer |
| `GET /:id/recipients?status&page` (telefone mascarado, só primeiro nome) | viewer |
| `GET /templates?refresh=1` cache + 5 rascunhos de `docs/whatsapp-oficial.md` com estado | viewer |
| `GET /number-health` última leitura + 14 dias + veredito + disparos auto-pausados | viewer |
| `POST /` cria rascunho (simulação ligada por padrão); `PATCH /:id` edita rascunho | manager |
| `POST /:id/audience/preview` (aceita sobrescrita de filtro/template/variáveis) | manager |
| `POST /:id/start {confirm:true, expectedRecipients:n}` (n precisa bater com o público elegível; senão 409 com a contagem nova) | manager |
| `POST /:id/pause`, `/:id/resume {confirm:true}`, `/:id/cancel` | manager |
| `POST /templates` cria template na Meta (validações do chat + categoria + aviso de saída) | owner |
| `POST /webhook/status {wid, status:'delivered'\|'read'\|'failed', errorCode?}` | `@Public` + `x-pilot-key` |
| `POST /webhook/quality {event, currentLimit?, displayPhoneNumber?}` | `@Public` + `x-pilot-key` |

`replied`: `PilotService.ingestMessage` chama `markBroadcastReply` (try/catch) para mensagem **recebida** de lead: marca `replied` o envio **real** dos últimos 72 h. Uma linha em `pilot.service.ts`.

## O que o dono precisa fazer
1. **Chat (`horizon-chat-api`)**: definir `CHAT_BRIDGE_KEY` (mesmo valor no `.env` da API). Ponte em `/pilot-bridge/*` (ver `docs/pilot-bridge.md`). Na API: `CHAT_API_URL`, `CHAT_BRIDGE_KEY`, `CHAT_CONNECTION_ID`.
2. **Número oficial**: conexão `whatsapp_official` (ou coexistência) com `coexistencePhoneNumberId`, `coexistenceWabaId` e token permanente com `whatsapp_business_management` e `whatsapp_business_messaging`.
3. **Templates**: criar os 5 (aba "Modelos") e aguardar a aprovação da Meta; só `APPROVED` envia.
4. **Retorno de entrega (não ligado)**: o chat hoje não propaga `ack`/status do Graph. Para `delivered/read/failed`, o chat deve chamar `POST {API}/pilot/broadcasts/webhook/status` com `x-pilot-key: PILOT_API_KEY` ao processar o webhook `statuses` da Meta (`id` = wid). Sem isso, entregues/lidos ficam em zero; respondidos vêm da ingestão.
5. **Qualidade**: o webhook `phone_number_quality_update` precisa estar assinado no app Meta; o chat encaminha se `PILOT_INGEST_URL`, `PILOT_API_KEY` e `PILOT_CONNECTION_IDS` estiverem definidos.
6. Só então ligar `BROADCASTS_ENABLED=true`. Antes, rodar simulações.
7. Definir com o jurídico: janela de horário, texto do opt-in de marketing (`docs/lgpd/05-textos-consentimento-optin.md`) e se "Agora não" basta como saída. Observação: o chat só trata como opt-out automático a mensagem inteira `parar/sair/cancelar/não quero/descadastrar`; um botão "Agora não" ou "Parar mensagens" **não** dispara opt-out hoje.

## Linhas que o dono dos arquivos compartilhados deve aplicar
**Shell** (`web/src/components/Shell.tsx`): importar `Send` de `lucide-react` e, na categoria Marketing:
```ts
{ category: "Marketing", items: [
  { title: "Origem e anúncios", icon: Megaphone, path: "/origem" },
  { title: "Disparos", icon: Send, path: "/disparos" },
] },
```

**BFF** (`web/src/app/api/pilot/[...path]/route.ts`):
```ts
// GET_ROUTES
{ re: /^broadcasts$/, params: [] },
{ re: /^broadcasts\/templates$/, params: ["refresh"] },
{ re: /^broadcasts\/number-health$/, params: [] },
{ re: new RegExp(`^broadcasts/${UUID}$`), params: [] },
{ re: new RegExp(`^broadcasts/${UUID}/recipients$`), params: ["status", "page"] },

// POST_ROUTES
{ re: /^broadcasts$/, params: [] },
{ re: /^broadcasts\/templates$/, params: [] },
{ re: new RegExp(`^broadcasts/${UUID}/(audience/preview|start|pause|resume|cancel)$`), params: [] },

// PATCH_ROUTES (novo handler PATCH, igual ao POST com method: "PATCH")
{ re: new RegExp(`^broadcasts/${UUID}$`), params: [] },
```
Também: no POST/PATCH, repassar `{error, message}` do servidor para `400`, `403` e `409` quando o caminho começa com `broadcasts` (hoje só 422 e 503), senão a tela mostra mensagens genéricas. `message` do Nest pode ser string ou lista (junte com espaço). Sem essas linhas a página `/disparos` mostra erro 404 do BFF.

## Limites e decisões
- Público máximo 5.000 leads por disparo. Filtros: etapa, campanha, score, origem do opt-in (API), mais as portas fixas de consentimento.
- `text_in_window` existe na API (texto com `{{n}}`), mas o assistente web cobre só template.
- Dry-run marca `sent` sem `wid`; não conta para frequência de 7 dias nem para respostas.
- Pausa/cancelamento: o cancelamento marca a fila como `skipped/disparo_cancelado`.
- Bridge: só canal oficial/coexistência (Baileys não suportado, 422).
- Migrações: `006_broadcasts.sql` e `007_number_health.sql` (já aplicadas no banco compartilhado, schema `horizon_agent`, idempotentes).
