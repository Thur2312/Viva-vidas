# Módulo de voz / VoIP

Versão 0.1 (2026-11-12). Estado: **construído sem nenhuma chave de API. Nenhum adaptador foi testado contra um provedor real.** Tudo o que fala com Twilio, ElevenLabs ou STT foi escrito contra a documentação pública e testado só com dublês (fetch falso). Sem credenciais o módulo falha fechado e a tela `/voz` mostra "pendente".

Contexto: agente de vendas de IA do Alberto Apolinário (corretor de planos de saúde; ele é o controlador na LGPD, a Horizon é a operadora). O agente trabalha em **modo sombra**: aprende com os colaboradores humanos. A voz nasceu como "fase 2" e o proprietário quer rápido. Esta primeira entrega é **ligação assistida por operador humano (click-to-call) com gravação, aviso, transcrição e conformidade**. O agente de voz automático tem projeto e núcleo testado com dublês, sem telefonia real (seção 8).

## 1. O que existe

| Peça | Onde | Estado |
|---|---|---|
| Interface de telefonia + adaptador Twilio (REST/webhook, sem SDK) + `DisabledTelephony` | `api/src/modules/voice/telephony/` | escrito, **não testado com Twilio real** |
| TTS ElevenLabs + `DisabledTts` | `voice/providers/tts.ts` | escrito, não testado |
| STT: ElevenLabs Scribe e API compatível com OpenAI + `DisabledStt` | `voice/providers/stt.ts` | escrito, não testado |
| Portões de conformidade, máquina de estados | `voice/voice-gates.ts` | testado (unitário + banco real) |
| Serviço, webhooks, configurações | `voice/voice*.ts` | testado (HTTP com dublês + banco real em transação com rollback) |
| Migração `004_voice.sql` | `api/db/migrations/` | **aplicada no banco compartilhado** (só schema `horizon_agent`, aditiva, idempotente) |
| Ganchos LGPD (titular e retenção) | `pilot/compliance/subject-hooks.ts` + 2 pequenas edições | testado em banco real |
| Página `/voz` | `web/src/app/(app)/voz`, `web/src/components/voz` | compila; não verificada visualmente com sessão real |

### Escolha: Twilio sem SDK
A assinatura `X-Twilio-Signature` é HMAC-SHA1 de `URL + (chaves ordenadas, "chave+valor")`, em base64: 15 linhas, implementadas à mão em `twilio-signature.ts` com comparação em tempo constante. O SDK oficial é grande e traria dependências sem necessidade; o REST usado (`Calls.json`, `Recordings`) é pequeno. Troca de provedor = novo adaptador que implemente `TelephonyAdapter`.

### Alternativas (NÃO implementadas)
- **Zenvia Voz**: provedor brasileiro, número local mais fácil, API e preços próprios.
- **Telnyx**: API de chamadas e TeXML parecidos com o Twilio; cobertura do Brasil a confirmar.
- **Tronco SIP genérico** (operadora brasileira, ex.: via Asterisk/FreeSWITCH): custo por minuto menor e número local, em troca de operar infraestrutura; exigido se o número precisar ser de operadora específica.

## 2. Fluxo da ligação (click-to-call)

1. Gestor clica em "Ligar" em `/voz` (ou `POST /voice/calls {leadId}`).
2. O servidor roda **todos os portões** (seção 4). Falhou algum: 422 com o motivo, auditado, nada é discado.
3. Cria `voice_calls` (`queued`) e pede ao Twilio uma ligação para o **telefone do operador** (`VOICE_OPERATOR_PHONE`) com `Url = {base}/voice/webhooks/twilio/bridge?callId=…`.
4. Operador atende: o Twilio chama `/bridge`; respondemos TwiML com `<Dial record=…><Number url=…/announce…>` para o lead.
5. Lead atende: o Twilio chama `/announce` **na perna do lead antes de ligar a ponte**; tocamos o aviso (`<Say language="pt-BR">`) e gravamos no banco `recording_announced_at`, `recording_consent=true` e `consent_basis=aviso_previo:<versão>`.
6. Eventos de status chegam em `/status` e atualizam a ligação (idempotente, só avança).
7. Gravação pronta em `/recording`: **só se guarda a referência se o aviso foi entregue**; do contrário a gravação é apagada no provedor e nada é retido (evento `voice.recording.discarded`). A referência (`twilio:RE…`) é criptografada (AES-256-GCM, mesmo `CryptoService` das mensagens) e nunca é URL pública. Com STT configurado, o áudio é baixado de forma transitória, transcrito e a transcrição vai criptografada para `voice_transcripts`.

Pontos a **validar na primeira conta de teste** (não dá para garantir sem executar): (a) se com `<Number url>` a gravação `record-from-answer-dual` captura o aviso ou começa só na ponte (o aviso é registrado no banco de qualquer jeito); (b) o comportamento de `answerOnBridge` com o aviso; (c) formato exato dos parâmetros de `RecordingStatusCallback`; (d) `SequenceNumber` nos eventos de status.

## 3. Variáveis de ambiente (só nomes; nenhuma é obrigatória para o servidor subir)

| Variável | Para quê |
|---|---|
| `VOICE_TELEPHONY_PROVIDER` | `twilio` (padrão) |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` | credenciais Twilio (o token também valida os webhooks) |
| `TWILIO_VOICE_NUMBER` | número de origem, E.164 (número brasileiro exige bundle, seção 7) |
| `VOICE_OPERATOR_PHONE` | telefone do operador (perna 1), E.164 |
| `VOICE_WEBHOOK_BASE_URL` | base pública HTTPS da API, sem barra final; entra na validação da assinatura |
| `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`, `ELEVENLABS_MODEL_ID` | TTS (só para o agente de voz futuro) |
| `STT_PROVIDER` (`elevenlabs` ou `openai`), `STT_API_KEY`, `STT_BASE_URL`, `STT_MODEL` | transcrição; com `elevenlabs`, `STT_API_KEY` cai para `ELEVENLABS_API_KEY` |
| `VOICE_DNC_ENABLED` | `true` liga a checagem Não Perturbe; **sem verificador plugado toda ligação é recusada** |
| `VOICE_CALL_WINDOW` | padrão da janela, ex. `1-5@09:00-18:00` ou `1-5@09:00-18:00@America/Sao_Paulo`. Valor inválido cai no padrão (seg-sex 09-18), nunca relaxa. O proprietário pode sobrescrever no painel (`PUT /voice/settings`) |
| `VOICE_RECORDING_RETENTION_DAYS` | padrão **365**, a confirmar com o cliente (ver seção 6) |
| `VOICE_TRANSCRIPT_RETENTION_DAYS` | padrão 365 |
| `PILOT_DATA_KEY*` | já existentes: chaves da criptografia de transcrição e referência de gravação |

## 4. Portões antes de qualquer ligação (todos falham fechado, `voice-gates.ts`)

Ordem fixa; o primeiro que falha é devolvido em 422 `{code, message}` e registrado em `audit_log` (`voice.call.refused`, só o código, sem nome nem telefone):

1. `lead_nao_encontrado` / `lead_anonimizado`.
2. `contato_bloqueado`: `ConsentService.canContact` falso, opt-out, ou resultado ausente.
3. `sem_consentimento_atendimento`: precisa de consentimento ativo da finalidade `atendimento`.
4. `aviso_gravacao_ausente`: texto do aviso não configurado (a chamada não é feita; a gravação também depende do aviso ter sido entregue, seção 2).
5. `telefone_invalido`.
6. `fora_da_janela`: padrão seg-sex 09:00-18:00 America/Sao_Paulo, configurável (dias, horas, fuso).
7. `dnc_sem_verificador` / `dnc_bloqueado`: com `VOICE_DNC_ENABLED=true` (ou ligado no painel; o mais restritivo vence) é preciso um `DncChecker` (token `DNC_CHECKER`, **nenhum vem implementado**); erro do verificador bloqueia; só `blocked === false` libera.
8. Fora dos portões: `ligacao_em_andamento` (não duplica ligação ativa ao mesmo lead nos últimos 15 min).

Antes dos portões: telefonia não configurada, `VOICE_WEBHOOK_BASE_URL` ou `VOICE_OPERATOR_PHONE` ausentes => **503** (auditado).

> **Não é afirmação jurídica.** A janela padrão é uma escolha conservadora, não a regra. As regras da Anatel para ligações de oferta/telemarketing (horários, identificação do chamador, prefixo do número, cadastro "Não Perturbe") e se este fluxo as atrai **precisam de confirmação do jurídico/telecom**. O "consentimento" de gravação aqui é **aviso prévio com continuidade da ligação**; se o jurídico exigir consentimento expresso (ex.: tecla para aceitar), o fluxo `/announce` precisa mudar.

## 5. API

JWT (`@NoTenant`), papéis via `@Roles`. Servida em `/voice/*` **e** em `/pilot/voice/*`. O BFF do painel (`/api/pilot/voice/...`) encaminha para `/voice/...`. O filtro global de exceções esconde o corpo de erros 5xx; por isso o motivo detalhado de "não configurado" vem de `GET /voice/status`, não do 503.

| Rota | Papel | Resposta |
|---|---|---|
| `GET /voice/status` | viewer | `{telephony:{provider,configured,ready,missing[]}, tts:{…}, stt:{…}, recording:{announcementConfigured,announcementVersion,retentionDays,retentionPendingClientConfirmation}, dnc:{enabled,configured,blocking}, callWindow:{days,start,end,tz,source}, webhookUrl, canPlaceCalls}`. `missing` só tem nomes de variáveis |
| `GET /voice/calls?page&pageSize&leadId&status&from&to` | viewer | `{data:[{id,lead_id,lead_name,phone_masked,direction,status,requested_at,started_at,answered_at,ended_at,duration_sec,has_recording,recording_consent,transcript_status,retention_until,cost_cents,failure_reason}], meta}` |
| `GET /voice/calls/:id` | viewer; transcrição só manager+ | detalhe + `events[]` + `transcript` (nulo para viewer, com `transcript_restricted:true`). Cada leitura de transcrição gera `voice.transcript.read` |
| `POST /voice/calls {leadId}` | manager | `201 {id,status}`; `422 {code,message}` bloqueio; `503` não configurado; `502` provedor recusou |
| `GET /voice/settings` | viewer | configuração efetiva (janela, DNC, texto e versão do aviso) |
| `PUT /voice/settings` | owner | `{callWindow?, dncEnabled?, announcementText?}`; versão do aviso é um hash do texto |
| `POST /voice/webhooks/:provider/status`, `/recording`, `/bridge`, `/announce` | público, **só assinatura** | status/recording: `{ok}`; bridge/announce: XML |

Webhooks: assinatura validada em tempo constante sobre `VOICE_WEBHOOK_BASE_URL + url original (com query)`; sem base ou sem token => recusa (503/403); chamada desconhecida => 200 sem revelar nada; sem log de corpo, query ou telefone; idempotentes por `(call_id, event_key)` e transição atômica no SQL.

## 6. Dados, retenção e LGPD

Tabelas (`004_voice.sql`, schema `horizon_agent`, RLS ligado e **sem policies**, `REVOKE` de `anon`/`authenticated`): `voice_calls`, `voice_call_events` (linha do tempo e idempotência), `voice_transcripts` (segmentos criptografados), `voice_settings` (singleton por tenant). `lead_id` tem `ON DELETE CASCADE`.

**Transcrições não vão para `messages`.** `messages.author` só aceita `lead|humano|agente`, o pipeline de sombra/aprendizado lê `messages` sem distinguir canal, e a transcrição de voz é dado de saúde potencial que precisa de consentimento de aprendizado e redação próprios. Ficam em `voice_transcripts` com `contains_sensitive` calculado. Para alimentar o aprendizado depois: um serviço novo lê `voice_transcripts`, **exige `ConsentService.canLearn`**, pseudonimiza (`redaction.ts`) e só então cria exemplos.

**Retenção**: gravação 365 dias por padrão (`VOICE_RECORDING_RETENTION_DAYS`). **O prazo de 1 ano vem do briefing do cliente sobre a SUSEP; é exigência do cliente a confirmar**, assim como se vale para toda venda ou só as concluídas. A rotina diária de retenção apaga a gravação **no provedor** e zera a referência; falha do provedor não derruba a rotina e a gravação fica para a próxima rodada. Transcrições vencem em `VOICE_TRANSCRIPT_RETENTION_DAYS`.

**Titular (art. 18)**: o código de `pilot/compliance` ganhou um registro de ganchos (`subject-hooks.ts`). Mudanças feitas fora do módulo de voz:
- `compliance/subject-hooks.ts` (novo): interface `SubjectDataHook` (`exportLead`, `anonymizeLead`, `eraseLead`, `purgeExpired`) e registro por nome.
- `compliance/data-subject.service.ts`: `exportLead` devolve `extensions.<módulo>`; `anonymizeLead` chama os ganchos antes de apagar o conteúdo e soma os contadores na auditoria; `eraseLead` chama os ganchos **antes** do `DELETE` (a gravação fica fora do banco e a cascata não a alcança). Se o gancho falha (ex.: não conseguiu apagar no provedor), **a eliminação falha** e o pedido fica `em_andamento` (repetir conclui).
- `compliance/retention.service.ts`: roda `purgeExpired` dos ganchos; `RetentionResult` ganhou `extensions`. Falha de um gancho vira `<nome>Erro:1` e não derruba o resto.
O módulo de voz registra o gancho em `onModuleInit`. Anonimizar apaga gravação e transcrição e mantém só metadados (duração, estado); eliminar apaga tudo.

**Auditoria** (`audit_log`, sem dado pessoal): `voice.call.place|refused|failed`, `voice.recording.stored|discarded`, `voice.transcript.created|read`, `voice.settings.update`.

**Outros pontos LGPD**
- **Art. 11 (saúde)**: conversa de venda de plano de saúde envolve dado sensível; base legal e minimização precisam constar no RIPD (`docs/lgpd/02`) e no ROPA (`01`); transcrição restrita a manager+ e auditada.
- **Art. 33 (transferência internacional)**: Twilio, ElevenLabs e provedor de STT processam voz/áudio fora do Brasil. Entram na lista de subprocessadores (`docs/lgpd/10`) com cláusulas e DPA; confirmar região de armazenamento das gravações no Twilio.
- **Aviso e consentimento**: texto do aviso validado pelo jurídico; versão registrada em cada ligação.
- Atualizar `docs/lgpd/01`, `02`, `07` e `10` com a voz quando o cliente aprovar.

## 7. O que o proprietário precisa obter e decidir

| Item | Prazo realista (estimativa de mercado, não promessa) |
|---|---|
| Conta Twilio (cartão, verificação) | minutos a 1 dia |
| **Regulatory Bundle do Brasil** + número brasileiro: documentos da empresa (CNPJ, endereço comprobatório, representante); a aprovação do Twilio é manual | de alguns dias a algumas semanas; sem isso não há número brasileiro |
| Chave ElevenLabs + escolha da voz (só para o agente de voz futuro) | minutos |
| Chave de STT (ElevenLabs Scribe ou provedor compatível) | minutos |
| URL pública HTTPS da API (`VOICE_WEBHOOK_BASE_URL`) | depende do deploy |
| Texto do aviso de gravação validado | jurídico do cliente |
| Decisões: prazo de retenção de gravação (SUSEP), regras Anatel/janela/prefixo, política Não Perturbe e qual lista, base legal da voz, operador (um telefone fixo por enquanto), se aviso basta ou precisa de consentimento expresso | cliente + jurídico |

Passo a passo do Twilio no Brasil (conferir no console, que muda): criar conta; em *Phone Numbers > Regulatory Compliance* criar o *Bundle* para o Brasil (tipo de número local/móvel conforme o caso) com os documentos pedidos e aguardar aprovação; comprar o número vinculado ao bundle; preencher as variáveis acima. Os webhooks **não precisam ser colados no console para o click-to-call**: as URLs de status e instruções vão em cada chamada. A tela `/voz` mostra a URL base de qualquer forma.

## 8. Agente de voz de baixa latência (projeto + núcleo; nada ligado a telefonia real)

Estado: existe o **núcleo testado só com dublês** (`voice/agent/`) e a **medição de latência** (`voice/latency/`). Não existe adaptador de streaming real (Twilio Media Streams, STT em streaming, LLM em streaming, TTS em μ-law): é o próximo passo.

### 8.1 Métrica e meta
**Latência percebida** = do instante em que o lead para de falar até o primeiro áudio do agente tocar. Metas de projeto (estimativas, a validar): **p50 ≤ 800 ms e p95 ≤ 1200 ms**. Acima de ~1,5 s a conversa soa travada. O orçamento por estágio fica em `latency/latency-budget.ts`.

### 8.2 Arquitetura: decisão
| Opção | Latência típica (estimativa) | Prós | Contras |
|---|---|---|---|
| **A. Cascata em streaming** (STT → LLM → TTS) | ~700 a 1000 ms | Passa por texto: dá para aplicar o portão de dado sensível e a redação antes do modelo; troca cada peça sozinha | Mais peças para ajustar; soma de três estágios |
| **B. Voz nativa** (Gemini Live: áudio entra e sai do mesmo modelo) | ~300 a 600 ms | Menor latência, sem STT/TTS separados | O áudio cru vai ao provedor **sem** portão de texto antes (art. 11 e art. 33); menos controle da fala |
| **C. Plataforma pronta** (Vapi, Retell, Pipecat gerenciado) | ~600 a 900 ms | Rápido de pôr no ar | Mais um subprocessador, custo por minuto, pouco controle sobre o filtro |

**Decisão:** **A é o caminho principal**, porque o portão de texto antes do LLM (o mesmo princípio do PR de dado sensível) só existe quando há texto no meio. **B só como protótipo em modo sombra, com dados inventados**, para medir o ganho real; promover só com parecer do jurídico sobre áudio cru de saúde. **C fica descartada por ora.**

### 8.3 Orçamento por estágio (p95, ms)
| Estágio | Teto | Tática |
|---|---|---|
| Fim de turno (`endpoint`) | 400 | VAD + detector semântico de fim de turno; silêncio curto só quando a frase parece completa |
| STT final | 250 | STT em streaming com resultado parcial; não esperar o arquivo |
| 1º token do LLM | 600 | Modelo rápido (candidato: `gemini-3.1-flash-lite`), prompt curto, contexto do lead carregado **antes** da ligação, início especulativo sobre o parcial |
| 1ª frase (`first_chunk`) | 150 | `SentenceChunker` solta a primeira fala numa vírgula, sem esperar a frase inteira |
| 1º áudio do TTS | 350 | TTS em streaming já em μ-law 8 kHz (sem reamostrar); frases curtas e comuns pré-sintetizadas |
| Tocar na linha (`playback`) | 80 | Conexões (WebSocket/TLS) abertas antes da primeira fala |

Os tetos somam mais que o total de propósito: os p95 não se somam; o que manda é o total.

### 8.4 O que mais pesa (sem medir ainda)
1. **Distância dos provedores.** A VPS é no Brasil; STT/LLM/TTS fora do país somam ~150 a 250 ms por ida e volta. No simulador, a mesma cascata sai de p50 ~1000 ms (perto) para ~1500 ms (longe). Escolher região/provedor antes de otimizar código.
2. **1º token do LLM** é o estágio dominante nos perfis simulados.
3. **Fora do caminho quente:** nada de consulta ao banco, gravação de auditoria ou `ShadowService` entre a fala e a resposta; isso roda depois, de forma assíncrona.

### 8.5 Núcleo implementado (`voice/agent/`)
- `VoiceAgentSession`: **barge-in** (a fala do lead aborta LLM/TTS e limpa o áudio pendente), **portão de texto antes do LLM** (bloqueado ou com erro => passagem ao humano; falha fechado), passagem ao humano por pedido do lead, 2 falas ininteligíveis ou erro, frase de preenchimento se o primeiro áudio demorar.
- `SentenceChunker`: frases em pt-BR (abreviações e decimais), primeira fala antecipada.
- Cada turno alimenta o `LatencyRecorder`.
- **Ainda falta:** adaptadores reais, VAD/detecção de fim de turno de verdade, política de eco, métricas por ligação no painel.

### 8.6 Como medir
`npm run voice:latency -- --turns 1000 --seed 1` roda o simulador em tempo virtual com três perfis (`cascata-br`, `cascata-eua`, `voz-nativa`). **Os perfis são suposições.** Resultado da última execução: `cascata-br` p50 ~986 ms / p95 ~1338 ms (fora da meta; domina o 1º token); `cascata-eua` p50 ~1529 ms; `voz-nativa` p50 ~639 ms / p95 ~967 ms. **A meta só é considerada atingida com medição real** (`LatencyRecorder` em ligações de teste), nunca pelo simulador.

### 8.7 Sombra, prontidão e LGPD
- **Continua em modo sombra até medir:** voz não tem botão de desfazer; erro dito ao lead é irreversível, há dado de saúde e risco regulatório (SUSEP, consumidor). A prontidão (`agent_readiness`) hoje mede texto no WhatsApp, não fala. Cada etapa começa em sombra de voz (o agente "ouve" ligações humanas gravadas e gera o que diria).
- **Passagem para humano sempre disponível:** pedido do lead, confiança baixa, assunto fora do playbook, sinal de saúde sensível, 2 falhas de entendimento ou o operador "pega" a ligação.
- **LGPD:** avisar que é assistente automatizado e que a ligação é gravada; art. 11 em toda ligação; art. 33 para cada provedor no caminho do áudio (inclusive o de voz nativa); retenção mínima do áudio bruto.
- **Antes de qualquer chamada real:** bundle regulatório do Twilio, chaves, texto do aviso validado e decisões da seção 7.

## 9. Limites conhecidos

- Nada foi executado contra Twilio, ElevenLabs ou STT reais; só dublês e a especificação.
- Um único telefone de operador por instalação (`VOICE_OPERATOR_PHONE`); sem fila de operadores nem ligação receptiva (`inbound` existe no schema, sem fluxo).
- A página de configuração (`PUT /voice/settings`) existe na API, mas o painel só **lê** o estado: o BFF não libera `PUT`. Até lá o proprietário usa a API (ou o texto do aviso fica sem como ser cadastrado pela tela).
- Custo por ligação (`cost_cents`) não é preenchido ainda (o adaptador sabe ler o preço do Twilio em `getCall`, sem rotina que o busque).
- Nenhum `DncChecker` real. Com Não Perturbe ligado e sem verificador, tudo é recusado de propósito.
- O PgService do módulo tem um pool próprio (o `PilotModule` não exporta o dele).
- Transcrição roda em `setImmediate` no mesmo processo: se o processo cair no meio, a ligação fica `pending` (sem reprocessamento automático).
