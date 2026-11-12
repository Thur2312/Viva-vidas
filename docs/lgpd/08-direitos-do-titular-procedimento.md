# 08 - Procedimento: pedidos de titulares (LGPD art. 18)

Versão 0.2 (2026-11-12), reconciliada com o código. Responsável: encarregado da Controladora **[DADO A PREENCHER]**; apoio técnico: Horizon (operadora). **Não declara conformidade.**

## 1. Estado dos recursos técnicos (verificado no código)

Endpoints da API (`api/src/modules/pilot/pilot.controller.ts`), todos exigem JWT do painel e o papel indicado (`panel-auth/roles.guard.ts`; hierarquia `owner > manager > viewer`). Tenant resolvido no servidor (`PILOT_TENANT`).

| Ação | Endpoint | Papel | Efeito |
|---|---|---|---|
| Buscar lead | `GET /pilot/leads?search=` | viewer | Telefone mascarado na lista |
| Ver lead | `GET /pilot/leads/:id` | viewer | Telefone completo, eventos, mensagens e rascunhos decifrados; **grava `lead.read` em `audit_log`** |
| Exportar (acesso/portabilidade) | `GET /pilot/leads/:id/export` | manager | JSON com lead, eventos, conversas (com `summary`), mensagens e rascunhos decifrados, revisões de qualificação, exemplos aprendidos, consentimentos, pedidos e `extensions.voice` (ligações e transcrições); abre pedido `acesso` e o conclui; audita `lead.export` |
| Corrigir | `PATCH /pilot/leads/:id/data` `{name?, phone?, qualification?}` | manager | Atualiza (qualification é mesclada); 409 se o telefone já existe; recusa lead anonimizado; pedido `correcao`; audita `lead.correct` |
| Anonimizar | `POST /pilot/leads/:id/anonymize` | manager | Irreversível. Apaga conversas, mensagens, rascunhos, exemplos derivados, gravações e transcrições de voz (no provedor também); zera qualificação e payload dos eventos; revoga consentimentos; mantém `phone_hash` só se havia `opt_out`; pedido `anonimizacao` |
| Eliminar | `DELETE /pilot/leads/:id` | manager | Apaga lead e dependentes (cascata); gravações no provedor apagadas antes. **Lead com `opt_out` é anonimizado, não apagado** (resposta `erased: false`). Pedido `eliminacao` |
| Listar consentimentos | `GET /pilot/leads/:id/consents` | viewer | Histórico (ativos e revogados) |
| Registrar consentimento | `POST /pilot/leads/:id/consents` `{purpose, legalBasis?, textVersion?, source?}` | manager | `marketing` e `aprendizado_agente` exigem base `consentimento`, `textVersion` e `source`; idempotente |
| Revogar consentimento | `POST /pilot/leads/:id/consents/revoke` `{purpose}` | manager | Pedido `revogacao_consentimento` concluído |
| Opt-out (parar de contatar) | `POST /pilot/events` `{phone, type:'opt_out', actor?}` com `x-pilot-key` (`PILOT_API_KEY`) | chave de ingestão | Marca `opt_out`, revoga todos os consentimentos, audita `lead.opt_out`; passa a bloquear contato (`can_contact`), voz, disparos, shadow e aprendizado |
| Listar pedidos | `GET /pilot/data-subject-requests?status=` | manager | Inclui `due_at` (15 dias) e `overdue` |
| Trilha de auditoria | `GET /pilot/audit-log?limit&offset&action` | owner | Sem dado pessoal |
| Rodar retenção | `POST /pilot/retention/run` | owner | Ver doc 07 |

Observações importantes:
- **O BFF do painel (`web/src/app/api/pilot/[...path]/route.ts`) não expõe** export, correção, anonimização, eliminação, consentimentos, pedidos, auditoria nem retenção. Esses endpoints são chamados diretamente na API com um JWT obtido em `POST /panel-auth/login` (manager/owner). **Não há tela nem formulário público** para o titular.
- Cada operação registra o pedido em `data_subject_requests` (`requested_by` = id do operador, `due_at` = agora + 15 dias) e escreve `audit_log`. `notes` não pode ter dado pessoal.
- Opt-out automático: a ponte do chat (`horizon-chat-api`, só se ligada por `PILOT_INGEST_URL`, `PILOT_API_KEY`, `PILOT_CONNECTION_IDS`) envia `opt_out` quando a **mensagem inteira** do contato é `parar`, `sair`, `cancelar`, `não quero` ou `descadastrar`. Outras frases ("pare de me mandar", "stop", botão "Parar mensagens") **não** são reconhecidas: tratar manualmente com o evento acima.
- As operações de anonimização/eliminação não são transacionais; são idempotentes. Se o provedor de voz falhar ao apagar uma gravação, a operação **falha** e o pedido fica `em_andamento`: repetir após resolver.
- Não existe canal para o titular e nada avisa o encarregado de pedido a vencer: o `overdue` só aparece na listagem.

## 2. Fluxo geral
1. **Receber** (e-mail do encarregado, WhatsApp, painel). Registrar data. Prazo: resposta em até **15 dias** da requisição para declaração completa (art. 19, II); confirmação simples e imediata (art. 19, I) pode ser feita no ato.
2. **Verificar identidade** (seção 3).
3. **Localizar o lead** pelo telefone normalizado (`55` + DDD + número): `GET /pilot/leads?search=`.
4. **Executar** com o endpoint da tabela (o próprio endpoint abre e conclui o pedido em `data_subject_requests`).
5. **Responder** ao titular (linguagem simples) por canal verificado.
6. **Guardar evidência** (seção 5).

## 3. Verificação de identidade
- Pedido recebido do **mesmo número de WhatsApp** da conversa: suficiente para pedidos simples (acesso a metadados, opt-out).
- Pedido de acesso a conteúdo, eliminação ou portabilidade vindo de outro canal: confirmar enviando código ao número do lead ou perguntando dado que só o titular sabe. Não pedir documento sem necessidade.
- Pedido por terceiro/procurador: exigir procuração.
- Nunca enviar dados por canal não verificado. O export traz telefone completo e conteúdo de mensagens (possivelmente saúde): tratá-lo como dado sensível.

## 4. Mapeamento direito x ação

| Direito (art. 18) | Ação técnica | Observação |
|---|---|---|
| I Confirmação, II Acesso | `GET /pilot/leads/:id/export` e entregar por canal verificado | Não incluir dado de outros titulares. Prazo completo: 15 dias. |
| III Correção | `PATCH /pilot/leads/:id/data` | Não corrige texto de mensagens. |
| IV Anonimização/bloqueio/eliminação de dado desnecessário | `POST /pilot/leads/:id/anonymize`; bloqueio por `opt_out` ou revogação | Bloqueio parcial (por finalidade): `consents/revoke`. |
| V Portabilidade | Export JSON | Regulamentação da ANPD pendente **[DECISÃO JURÍDICA]** |
| VI Eliminação de dados tratados com consentimento | `DELETE /pilot/leads/:id` | Exceção: guarda legal de contrato (art. 16), em especial lead `venda` **[DECISÃO JURÍDICA]**. **Manual ainda:** apagar no Pipedrive/Google (planejados), solicitar a suboperadores (Anthropic, Twilio, STT, Meta) e reaplicar após restore de backup |
| VII Informação sobre compartilhamento | Entregar doc 10 resumido | |
| VIII Informação sobre não consentir | Aviso de privacidade (doc 03) | |
| IX Revogação do consentimento | `POST /pilot/leads/:id/consents/revoke` ou evento `opt_out` | |
| Art. 20 Revisão de decisão automatizada | Humano reavalia `stage`/`score` | Documentar |

## 5. Evidências a guardar
- Registro em `data_subject_requests` (id, tipo, datas).
- Linha em `audit_log` por ação (ator, ação, entidade, IP), **sem dado pessoal em `details`**.
- Cópia da resposta enviada (sem conteúdo extra).
- Confirmação de eliminação nos suboperadores quando aplicável.

## 6. Eliminação: checklist
1. Não manter cópia do que será apagado; registrar apenas IDs.
2. `DELETE /pilot/leads/:id` (ou `anonymize` se houver `opt_out`/guarda legal) e conferir `concluido` em `GET /pilot/data-subject-requests`.
3. Se houve ligação gravada, conferir `voiceRecordings` na linha de auditoria e, se o provedor falhou, repetir.
4. Pipedrive e Google (quando ativos).
5. Meta: solicitar exclusão de públicos/eventos enviados (quando a CAPI existir; hoje nada é enviado).
6. Reaplicar após restore de backup (doc 07).
7. Informar titular.

## 7. Negativas
Fundamentar (obrigação legal de guarda, exercício regular de direito). Informar que o titular pode reclamar à ANPD.
