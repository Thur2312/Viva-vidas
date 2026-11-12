# 07 - Política de retenção e descarte

Versão 0.2 (2026-11-12), reconciliada com o código. Os prazos abaixo são **defaults implementados** que ainda precisam de decisão da Controladora **[DADO A PREENCHER]** e validação jurídica **[DECISÃO JURÍDICA]**, considerando guarda de documentos de corretagem exigida por normas SUSEP/fiscais para quem virou cliente. **Não declara conformidade.**

## 1. Estado do código
Existe job de retenção: `api/src/modules/pilot/compliance/retention.service.ts`.
- Agendamento: `@Cron('30 3 * * *')`, fuso `America/Sao_Paulo` (03:30).
- **Atenção (corrigido, falta confirmar em execução):** `@Cron` depende de `ScheduleModule.forRoot()`. Antes ele só carregava fora de `PILOT_ONLY`; agora também carrega nesse modo (`api/src/app.module.ts`). Confirme em uma instância rodando que o job das 03:30 (America/Sao_Paulo) dispara; o `POST /pilot/retention/run` (dono) continua disponível para execução manual.
- Execução manual: `POST /pilot/retention/run` (owner); grava `audit_log` com ação `retention.purge` (contagens, sem dado pessoal).
- Idempotente e restrito ao tenant do piloto (`PILOT_TENANT`, padrão `alberto`).
- Valores não numéricos, zero ou negativos nas variáveis caem no default.

### Variáveis reais e defaults

| Variável | Default | Efeito |
|---|---|---|
| `PILOT_RETENTION_MESSAGES_DAYS` | 180 | `DELETE` de `messages` mais antigas que o prazo (derruba rascunhos ligados por cascata) |
| `PILOT_RETENTION_DRAFTS_DAYS` | 180 | `DELETE` de `agent_drafts` mais antigos que o prazo |
| `PILOT_RETENTION_LEADS_DAYS` | 730 | **Anonimiza** (não apaga) lead sem atividade (maior entre `updated_at`, último evento e última mensagem) há mais que o prazo, até 500 leads por rodada; etapa `venda` **não** é anonimizada automaticamente; lead já anonimizado é ignorado |
| `VOICE_RECORDING_RETENTION_DAYS` | 365 | Define `voice_calls.retention_until` ao guardar a gravação; a rotina apaga a gravação **no provedor** e zera a referência (até 200 por rodada; falha do provedor fica para a próxima rodada). O painel (`GET /voice/status`) marca `retentionPendingClientConfirmation` enquanto a variável não é definida |
| `VOICE_TRANSCRIPT_RETENTION_DAYS` | 365 | `DELETE` de `voice_transcripts` criadas há mais que o prazo |
| `PILOT_DATA_KEY`, `PILOT_DATA_KEY_VERSION`, `PILOT_DATA_KEY_V<n>`, `PILOT_PHONE_SALT` | - | Não são prazos; ver doc 11 e doc 09 (rotação) |

Não existe variável para `audit_log`, `consents`, `data_subject_requests`, `lead_events`, `learned_examples`, `broadcast_recipients`, metadados de `voice_calls` nem para tokens do painel: **não há purga automática dessas classes**.

## 2. Quadro por classe de dado

| Classe | Tabela | Prazo implementado / proposto | Ação no fim | Observação |
|---|---|---|---|---|
| Mensagens da conversa | `messages` | **180 dias (implementado)** | Eliminar | `contains_sensitive = true`: reduzir para 30-60 dias **[DECISÃO JURÍDICA]**; o código não distingue prazo por sensibilidade |
| Rascunhos da IA | `agent_drafts` | **180 dias (implementado)** | Eliminar | Contêm `reasoning` (não cifrado) que pode repetir dado do lead |
| Resumo de conversa | `conversations.summary` | Segue a conversa; **a linha de `conversations` só é apagada quando o lead é anonimizado/eliminado**, não quando as mensagens vencem | Eliminar com o lead | Não cifrado |
| Lead sem interação | `leads` | **730 dias (implementado)** | **Anonimizar** (nome nulo, telefone `anon:<hash|aleatório>`, `qualification = {}`, `source` reduzido a `campaign_id`/`campaign_name`, `pipedrive_ids = {}`, `opt_in_origin = NULL`, `anonymized_at`) | `phone_hash` (HMAC) só se havia `opt_out`; apaga também conversas, mensagens, rascunhos e exemplos derivados e zera `lead_events.payload`; revoga consentimentos |
| Venda/cliente | `leads.stage = 'venda'` | **Nunca anonimizado automaticamente** | Prazo legal de guarda **[DADO A PREENCHER]**; hoje depende de ação manual (`POST /pilot/leads/:id/anonymize`) | Bases: art. 16, I (obrigação legal) |
| Eventos de funil | `lead_events` | Enquanto o lead existir; payload zerado na anonimização | Manter sem vínculo identificável | Métrica histórica de vendas |
| Exemplos aprendidos | `learned_examples` | Sem purga automática; apagados na anonimização/eliminação do lead de origem (`source_lead_id` ou `source_message_id`) | Descartar os `contains_sensitive`; revisão anual | Redigidos antes de gravar, mas redação por regras não é anonimização |
| Playbook | `playbook_versions` | Permanente (sem dado pessoal) | - | Revisar se não contém dado pessoal |
| Consentimentos | `consents` | Sem purga automática; proposta: vigência + 5 anos (prova) | Eliminar depois | Prova de consentimento, art. 8, §2. Revogados na anonimização, não apagados |
| Pedidos de titulares | `data_subject_requests` | Sem purga automática; proposta: 5 anos | Eliminar | Sem FK, sobrevive à eliminação do lead |
| Auditoria | `audit_log` | Sem purga automática; proposta: 5 anos **[DECISÃO JURÍDICA]** | Eliminar | `details` sem dado pessoal (`sanitizeDetails`) |
| Ligações (metadados) | `voice_calls`, `voice_call_events` | Sem purga automática; ficam ligadas ao lead (cascata na eliminação) | A decidir | Na anonimização, `transcript_status` vira `none` e `retention_until` é zerado |
| Gravação de voz | Áudio no provedor (Twilio) + referência cifrada em `voice_calls.recording_url_ref` | **365 dias por padrão, a confirmar com o cliente** (vem do briefing sobre SUSEP, não de norma verificada) | Apagar no provedor e zerar a referência | Falha ao apagar no provedor **impede** a eliminação do lead (gancho falha alto) |
| Transcrição de voz | `voice_transcripts` | **365 dias por padrão** | Eliminar | Cifrada; leitura só `manager+` e auditada |
| Disparos (destinatários) | `broadcast_recipients` | Sem purga automática | A decidir | Telefone vem de `leads`; apagado em cascata com o lead |
| Saúde do número | `number_health_snapshots` | Sem purga automática | A decidir | Sem dado pessoal (campos normalizados) |
| Tokens e usuários do painel | `panel_users`, `panel_refresh_tokens` | Refresh expira em 7 dias; **sem purga das linhas expiradas** | Eliminar tokens expirados; desativar usuários ao sair | |
| Logs de aplicação | servidor | 90 dias **[DADO A PREENCHER]**; **fora da aplicação** | Rotacionar | A API loga só método/caminho/status/duração; a retenção real depende do host |

## 3. Anonimização x eliminação
- **Eliminação** (`DELETE /pilot/leads/:id`): apaga o lead; `ON DELETE CASCADE` remove conversas, mensagens, rascunhos, eventos, avaliações, consentimentos, ligações, transcrições e destinatários de disparo; ganchos apagam antes as gravações no provedor. Exemplos aprendidos ligados são apagados explicitamente. **Exceção:** lead com `opt_out` é anonimizado em vez de apagado, para manter o bloqueio (`phone_hash`).
- **Anonimização (art. 12)**: remove o que identifica e mantém estatística. Telefone, nome e texto livre são identificadores; o código apaga as conversas inteiras em vez de tentar anonimizar texto. `phone_hash` (HMAC-SHA256 salgado com `PILOT_PHONE_SALT`, ou derivado de `PILOT_DATA_KEY`) é pseudonimização, não anonimização; base: cumprir opt-out.
- As operações não são transacionais (pool de conexões): são ordenadas para cortar primeiro o vínculo com a pessoa e são idempotentes; repetir o pedido conclui o trabalho.

## 4. Backups
- Supabase mantém backups conforme o plano **[DADO A PREENCHER: confirmar retenção do plano contratado]**. A eliminação não é imediata nos backups. **Backups estão fora do código desta aplicação.**
- Regra: dados eliminados não são restaurados para produção sem reaplicar a lista de eliminações; manter registro de `data_subject_requests` concluídas para reaplicação após restore.
- Backups expiram em até 35 dias (proposta; ajustar ao plano).
- Se `PILOT_DATA_KEY` for perdida, os backups cifrados de mensagens/rascunhos/transcrições **ficam ilegíveis** (doc 09, seção 6).

## 5. Verificação
Mensal: executar consulta de leitura de registros acima do prazo e conferir as linhas `retention.purge` em `GET /pilot/audit-log` (owner), que trazem as contagens (`drafts`, `messages`, `leadsAnonymized`, `voiceRecordings`, `voiceTranscripts`). Se nenhuma linha `retention.purge` aparece em dias úteis, o agendamento não está rodando (ver seção 1).
