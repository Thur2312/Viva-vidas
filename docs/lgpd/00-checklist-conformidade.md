# 00 - Checklist de conformidade LGPD (Horizon Agente)

Data-base da verificação: 2026-11-12 (segunda passada, após a implementação do módulo `compliance/`, da autenticação do painel, de voz, disparos e conversas). Base: leitura do código em `api/`, `web/`, da ponte do chat (`D:\Projetos\horizon-chat-api`, `docs/pilot-bridge.md`) e das migrações `001` a `007`. Não existe migração `005` na pasta `api/db/migrations/` (a numeração salta de 004 para 006); conferir se é intencional.
Este documento **não declara conformidade**. Ele mostra o que o código comprova e o que ainda depende de pessoas, contratos ou parecer jurídico. "Atendido tecnicamente" significa que o mecanismo existe e tem teste automatizado nos arquivos `*.spec.ts`; **não** significa que foi exercitado em produção nem contra Meta, Twilio, Anthropic ou STT reais (nenhum deles tem chave configurada neste ambiente).

Legenda de status:
- **Atendido tecnicamente**: existe mecanismo no código/banco que comprova.
- **Parcial**: existe parte; falta algo descrito na coluna "Lacuna".
- **Pendente-organizacional**: depende de decisão, papel, treinamento ou documento assinado.
- **Pendente-jurídico**: depende de parecer/decisão de advogado.

> Aviso importante: software não torna ninguém "conforme". A LGPD exige governança (encarregado, contratos, base legal, treinamento, resposta a titulares). O código só ajuda a executar essas decisões.

Caminhos de evidência são relativos a `api/src/modules/` salvo indicação.

## 1. Princípios (art. 6)

| Obrigação | Status | Evidência | Lacuna / observação |
|---|---|---|---|
| Finalidade, adequação, necessidade (art. 6, I-III) | Parcial | `pilot/compliance/consent.service.ts` (finalidades `atendimento`, `qualificacao`, `aprendizado_agente`, `marketing`); `pilot/compliance/redaction.ts` (`flagSensitive` marca `messages.contains_sensitive`) | `leads.qualification` (jsonb livre) e `messages.body` (até 4096) continuam aceitando qualquer conteúdo, inclusive saúde; a marcação de saúde é uma lista de termos (falso negativo possível) e **só sinaliza**, não bloqueia. Playbook que proíba perguntas de saúde: decisão do dono do produto. |
| Livre acesso (art. 6, IV) | Atendido tecnicamente | `GET /pilot/leads/:id/export` (manager) em `pilot/pilot.controller.ts` e `pilot/compliance/data-subject.service.ts#exportLead` (lead, eventos, conversas, mensagens decifradas, rascunhos, revisões, exemplos aprendidos, consentimentos, pedidos e dados de voz via gancho) | É uma ferramenta do operador; **não há canal de autoatendimento para o titular**. Canal e responsável: ver doc 08. |
| Qualidade dos dados (art. 6, V) | Atendido tecnicamente | `PATCH /pilot/leads/:id/data` (manager), `data-subject.service.ts#correct` (nome, telefone, qualificação; registra pedido e auditoria) | Correção não alcança texto de mensagens nem `conversations.summary`. |
| Transparência (art. 6, VI) | Pendente-jurídico | Docs 03 e 05; página `web/src/app/privacidade/page.tsx` | A página `/privacidade` é um **marcador** ("Texto a ser validado pelo jurídico") com campos de controlador/operador/encarregado vindos de `NEXT_PUBLIC_LGPD_*`; **não contém** o texto do doc 03. O aviso ao lead no WhatsApp não é enviado por nenhum código. |
| Segurança (art. 6, VII) | Parcial | Doc 11 (lista verificada e lacunas) | Ver doc 11, seção 2. |
| Prevenção (art. 6, VIII) | Parcial | RLS e `REVOKE` (migrações 001 a 007); pseudonimização antes do LLM (`pilot/shadow.service.ts`, `compliance/redaction.ts`); cifra de aplicação (`compliance/crypto.service.ts`); retenção (`compliance/retention.service.ts`) | Pseudonimização por regras é redução de risco, não anonimização; mensagens marcadas `contains_sensitive` **ainda vão** ao LLM (só os exemplos aprendidos sensíveis são excluídos). Cron de retenção pode não rodar em modo `PILOT_ONLY` (ver seção 5). |
| Não discriminação (art. 6, IX) | Pendente-organizacional | `leads.score` (0-100) | Definir critérios do score e vedar uso discriminatório (ex.: por condição de saúde). |
| Responsabilização (art. 6, X) | Parcial | `audit_log` escrito por `compliance/audit.service.ts` (sem dado pessoal: chaves proibidas e redação de strings em `sanitizeDetails`) | Falta encarregado, registro de decisões e rotina humana de revisão da trilha. |

## 2. Bases legais e consentimento (arts. 7, 8, 11)

| Obrigação | Status | Evidência | Lacuna |
|---|---|---|---|
| Base legal definida por finalidade (art. 7) | Pendente-jurídico | Doc 01 propõe; o código grava `legal_basis` por consentimento (`consents.legal_basis`, CHECK em `002_lgpd.sql`) | Confirmar bases. O sistema registra a base escolhida; não a valida juridicamente. |
| Dado sensível de saúde: base do art. 11 | Pendente-jurídico | Doc 01 seção 4 | Há risco real de o lead escrever doença/condição no chat. Nota sobre art. 11, II, "g" e §4º. |
| Consentimento específico, destacado, comprovável (art. 8, 11 I) | Parcial | Tabela `consents` (finalidade, base, `text_version`, `source`, `granted_at`, `revoked_at`, `revoke_reason`); `ConsentService.normalize` exige base `consentimento`, `textVersion` e `source` para `marketing` e `aprendizado_agente`; índice único de consentimento ativo por (lead, finalidade) | O registro guarda **versão** e origem, **não guarda o texto exato nem o hash** (a prova do texto depende de manter a tabela de versões fora do banco, doc 05). **Atenção:** `PilotService.upsertLead` concede automaticamente `atendimento` e `qualificacao` (base `procedimentos_preliminares`) a **todo lead novo**, com `source = optInOrigin` ou `'ingestao'`. Isso registra que o lead entrou pelo pipeline, **não prova opt-in**; quem alimenta a ingestão precisa garantir a origem. |
| Revogação facilitada (art. 8, §5) | Parcial | `ConsentService.revoke/revokeAll`; evento `opt_out` em `pilot.service.ts#addEvent` marca `leads.opt_out`, revoga todos os consentimentos e audita; ponte do chat (`horizon-chat-api/src/services/PilotBridge/PilotBridge.ts`) dispara `opt_out` quando a mensagem **inteira** do contato é `parar`, `sair`, `cancelar`, `nao quero` ou `descadastrar` (sem acento, sem pontuação); `can_contact` e `canLearn` passam a negar; o shadow pula o lead (`status: 'opt_out'`) | A detecção só existe na ponte do chat e **só se a ponte estiver ligada** (`PILOT_INGEST_URL`, `PILOT_API_KEY`, `PILOT_CONNECTION_IDS`). O código da API não detecta stop words. Frases como "pare de me mandar mensagem", "stop" ou o botão "Parar mensagens" (doc 05) **não** são reconhecidas. Retirada separada de marketing x atendimento só via painel/API (`POST /pilot/leads/:id/consents/revoke`). |
| Dados de crianças (art. 14) | Não se aplica por desenho | Produto voltado a adultos | Dependentes menores citados no chat: observação em doc 01. |

## 3. Direitos do titular (art. 18) e prazos

| Direito | Status | Evidência | Lacuna |
|---|---|---|---|
| Confirmação e acesso (I, II) | Atendido tecnicamente | `GET /pilot/leads/:id/export` (manager); registra pedido `acesso` em `data_subject_requests` | Entrega ao titular por canal verificado é manual (doc 08). |
| Correção (III) | Atendido tecnicamente | `PATCH /pilot/leads/:id/data` (manager) | Ver livre acesso acima. |
| Anonimização, bloqueio, eliminação (IV, VI) | Atendido tecnicamente | `POST /pilot/leads/:id/anonymize` e `DELETE /pilot/leads/:id` (manager); `data-subject.service.ts#anonymizeLead/eraseLead`; ganchos de voz apagam gravações no provedor antes da cascata (`compliance/subject-hooks.ts`, `voice/voice.service.ts#subjectHook`) | Lead com `opt_out` é **anonimizado e não apagado** (mantém `phone_hash` para bloquear recontato). Operações não são transacionais: são idempotentes e o pedido fica `em_andamento` se cair no meio (repetir conclui). A exclusão alcança o Pipedrive (gancho `crm`, só quando `CRM_PROVIDER` está ligado e o lead foi sincronizado). Não alcança backups, Google (planejado) nem a conta Meta; a anonimização (sem exclusão) ainda não remove a pessoa do Pipedrive. |
| Portabilidade (V) | Parcial | Mesmo JSON do export | Formato estruturado existe; regulamentação da ANPD pendente. |
| Informação sobre compartilhamento (VII) | Parcial | Docs 03 e 10 | Publicar. |
| Revogação do consentimento (IX) | Atendido tecnicamente | `POST /pilot/leads/:id/consents/revoke` (manager) via `DataSubjectService.revokeConsent`; opt-out automático (ver acima) | Depende da ponte para o automático. |
| Prazo de resposta | Parcial | `data_subject_requests.due_at` = pedido + 15 dias (default da coluna); `GET /pilot/data-subject-requests` (manager) devolve `overdue` | Nada notifica o encarregado de pedido vencendo. Canal e responsável: **[DADO A PREENCHER]**. Pedidos nascem **de operador do painel**; não há formulário público. |

## 4. Agentes de tratamento, encarregado e registro (arts. 5, 37, 38, 39, 41)

| Obrigação | Status | Evidência | Lacuna |
|---|---|---|---|
| Papéis controlador/operador definidos | Pendente-jurídico | Doc 06 | Risco de controladoria conjunta (doc 01, seção 2). |
| Contrato com operador (art. 39) | Pendente-organizacional | Doc 06 (modelo) | Assinar. |
| Encarregado (art. 41) | Pendente-organizacional | - | **[DADO A PREENCHER]** nome e canal. |
| Registro das operações (art. 37) | Parcial | Doc 01 (atualizado com voz, disparos, conversas e aprendizado em sombra) | Revisar e manter atualizado. |
| RIPD (art. 38) | Parcial | Doc 02 (atualizado) | Há dado sensível, IA, gravação de voz e disparos; concluir antes de sair do modo sombra e antes de ligar voz ou disparos reais. |
| Operador segue instruções do controlador (art. 39) | Pendente-organizacional | Doc 06 | - |

## 5. Segurança, incidentes e boas práticas (arts. 46 a 49)

| Obrigação | Status | Evidência | Lacuna |
|---|---|---|---|
| Medidas de segurança (art. 46) | Parcial | Doc 11: login do painel com scrypt, bloqueio, refresh rotativo, JWT 15 min HS256, papéis por rota (`panel-auth/*`); cifra AES-256-GCM de mensagens, rascunhos, transcrições e referência de gravação (`compliance/crypto.service.ts`); helmet estrito, CORS por lista exata, limite de corpo, filtro de exceções, log sem PII (`panel-auth/security/hardening.ts`, `main.ts`); CSP e cabeçalhos no web (`web/next.config.mjs`) | CSP do web ainda com `'unsafe-inline'` em scripts; throttler em memória; sem endpoint de troca de senha; JWT de 15 min não é revogado ao desativar usuário; achados de auditoria do Prisma CLI; telefone, nome, `conversations.summary`, `lead_events.payload` e `leads.qualification` **sem** cifra de aplicação. Lista completa no doc 11. |
| Privacidade desde a concepção (art. 46, §2) | Parcial | Shadow sem envio; aprendizado só com consentimento `aprendizado_agente` e redação antes de gravar (`compliance/learning.service.ts`); exemplos nascem `approved = false` | **Cron de retenção e worker de disparos dependem de `ScheduleModule`, que só é carregado fora do modo `PILOT_ONLY`** (`app.module.ts`: `ScheduleModule.forRoot()` está em `fullImports`). Em `npm run start:pilot` (que força `PILOT_ONLY=true`) a retenção diária e o worker de disparos **não são agendados**; resta `POST /pilot/retention/run` (owner). Conferir em execução. |
| Retenção e descarte (arts. 15, 16) | Atendido tecnicamente (com a ressalva acima) | `compliance/retention.service.ts` (mensagens 180 d, rascunhos 180 d, leads inativos 730 d anonimizados, `venda` nunca anonimizado automaticamente, ganchos de voz) | Prazos são defaults **a aprovar**; `audit_log`, `consents`, `data_subject_requests`, `lead_events`, `voice_calls` (metadados), `broadcast_recipients` e `learned_examples` **não** têm purga automática. Doc 07. |
| Trilha de auditoria | Atendido tecnicamente | `lead.read` (`pilot.service.ts#getLead`), `conversation.read` (deduplicado em 5 min por operador+conversa, `conversations.service.ts`), `voice.transcript.read`, `lead.export|correct|anonymize|erase`, `consent.grant|revoke|revoke_all`, `lead.opt_out`, `conversation.send`, `broadcast.*`, `voice.call.*`, `voice.settings.update`, `retention.purge`; `GET /pilot/audit-log` (owner) | Leitura de metadados de ligações e de listas de destinatários não é auditada; ninguém revisa a trilha por rotina. |
| Comunicação de incidente (art. 48) | Pendente-organizacional | Doc 09 | Confirmar prazo. |
| Governança e boas práticas (art. 50) | Pendente-organizacional | Esta pasta | Treinamento de colaboradores. |

## 6. Transferência internacional (arts. 33 a 36)

| Obrigação | Status | Evidência | Lacuna |
|---|---|---|---|
| Mecanismo do art. 33 para Anthropic, Meta, Twilio, ElevenLabs/STT, outros | Pendente-jurídico | Doc 10 | `shadow.service.ts` envia histórico (até 20 mensagens), resumo, playbook e até 5 exemplos a `api.anthropic.com` **após pseudonimização** (nome e telefone do lead viram `[LEAD]`/`[TELEFONE]`; CPF, CNPJ, e-mail, cartão e RG são mascarados). Continua sendo transferência de texto livre que pode conter identificadores indiretos e dado de saúde. Cláusulas-padrão (Res. CD/ANPD nº 19/2024) ou outro mecanismo. |

## 7. Regras de plataforma (não são LGPD)

| Regra | Origem | Status |
|---|---|---|
| Opt-in para mensagens ativas, templates, qualidade do número | Política de Mensagens do WhatsApp Business / Meta | Parcial: disparos exigem consentimento ativo **com origem registrada**, template `APPROVED`, aviso de saída em marketing, frequência (1 marketing por 7 dias), janela 24 h, monitor de qualidade com pausa automática (`pilot/broadcasts/*`), interruptor `BROADCASTS_ENABLED` desligado por padrão. **Nada foi testado contra a Meta.** Ver doc 12. |
| Canal Baileys (não oficial) | Termos do WhatsApp | Risco de banimento. A ponte de saída do chat só aceita canal oficial/coexistência (422 `unsupported_channel`); a ponte de entrada (observação para o agente) é restrita só por lista de conexões (`PILOT_CONNECTION_IDS`); o documento da ponte não impõe o tipo de canal. Ver doc 02. |
| Ligação ativa (Anatel, "Não Perturbe") | Regulação de telecom | **Pendente-jurídico.** Voz tem janela de horário e gancho de "Não Perturbe", mas **nenhum verificador real** (`DncChecker`) existe. Doc 12. |

## 8. O que o software não resolve sozinho

1. Escolher e documentar base legal (art. 7 e 11), inclusive para a lista de leads perdidos (doc 12).
2. Nomear o encarregado e publicar o canal.
3. Assinar o contrato Controlador-Operador e os de suboperadores (inclui Twilio e ElevenLabs/STT).
4. Decidir sobre uso de dado de saúde e sobre transferência internacional.
5. Treinar e avisar colaboradores (doc 04).
6. Operar o atendimento de titulares dentro do prazo.
7. Decidir se e quando enviar eventos à Meta (Conversions API **não foi construída**; `lead_events.sent_to_meta_at` existe sem uso).
8. Validar juridicamente o aviso de gravação de voz, a janela de ligação e a regra de "Não Perturbe".
9. Confirmar o prazo de guarda de gravações (default de 365 dias vem do briefing do cliente, não de norma verificada) e de `venda`.
