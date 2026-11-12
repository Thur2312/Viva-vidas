# 01 - Registro das Operações de Tratamento (ROPA) - LGPD art. 37

Modelo para revisão jurídica. Versão 0.2 (2026-11-12, reconciliada com o código após a implementação de compliance, voz, disparos e conversas). **Não é declaração de conformidade.** Caminhos de evidência relativos a `api/src/modules/`.

## 1. Identificação

| Item | Valor |
|---|---|
| Controlador | Corretora de Alberto Apolinário **[DADO A PREENCHER: razão social, CNPJ, endereço, registro SUSEP]** |
| Operador | Horizon **[DADO A PREENCHER: razão social, CNPJ, endereço]** |
| Encarregado (art. 41) | **[DADO A PREENCHER: nome e canal]** |
| Sistema | Horizon Agente (API NestJS, painel Next.js, schema Postgres `horizon_agent`, chat WhatsApp `horizon-chat-api`, telefonia Twilio, STT/TTS) |

## 2. Papéis: controlador, operador e risco de controladoria conjunta

Raciocínio: a corretora define **por que** os dados são tratados (vender planos, qualificar leads) e **quais leads** entram. A Horizon executa o software seguindo essas instruções. Logo, corretora = controladora (art. 5, VI) e Horizon = operadora (art. 5, VII).

Pontos em que a Horizon pode virar **controladora (ou conjunta)** **[DECISÃO JURÍDICA]**:
1. **Aprendizado do agente**: se a Horizon reaproveitar exemplos/playbook de uma corretora para melhorar o produto de outros clientes, ela decide finalidade própria. Recomendação: proibir no contrato (doc 06) e manter a biblioteca isolada por `tenant`.
2. **Meta Ads e Conversions API**: quem define quais eventos enviar à Meta e para qual conta de anúncios? Se a Horizon gere as campanhas e decide, a Horizon se aproxima de controladora conjunta para essa finalidade.
3. **Dados de colaboradores**: a corretora é a empregadora e controladora; a Horizon só opera.
4. **Uso de dados agregados** para métricas da própria Horizon: precisa de base e de previsão contratual.
5. **Meta (WhatsApp) e Anthropic** atuam como suboperadores quanto a este fluxo, mas a Meta também é controladora dos dados da própria conta WhatsApp/Ads (relação própria com o usuário).

## 3. Atividades de tratamento

Legenda de dados: **S** = potencialmente sensível (art. 5, II; art. 11).

| # | Atividade | Finalidade | Dados | Titulares | Base legal proposta | Retenção proposta | Destinatários | Transf. internacional | Segurança |
|---|---|---|---|---|---|---|---|---|---|
| A1 | Captação de lead (anúncio click-to-WhatsApp, formulário Meta; ingestão `POST /pilot/leads` e `/pilot/ingest/message` com `x-pilot-key`) | Responder pedido de contato e iniciar atendimento | telefone, nome, `source` (ctwa_clid, ad_id, adset_id, campaign_id, UTMs, fbc, fbp), `opt_in_origin`; consentimentos `atendimento`/`qualificacao` registrados na criação (`procedimentos_preliminares`, origem = `optInOrigin` ou `'ingestao'`) | Leads | Art. 7, V (procedimentos preliminares a contrato a pedido do titular); para tracking publicitário, art. 7, IX ou consentimento **[DECISÃO JURÍDICA]** | **730 dias após a última atividade (default implementado**, `PILOT_RETENTION_LEADS_DAYS`; anonimiza, não apaga; `venda` não é anonimizado automaticamente) | Corretora, Horizon, Supabase, Meta | Sim (Meta, Supabase sa-east-1 é no Brasil) | RLS, chave de ingestão, HTTPS |
| A2 | Conversa de atendimento | Qualificar e vender plano | texto das mensagens (`messages.body`), **S** se o lead citar doença, medicação, gestação, idade de dependentes | Leads, dependentes citados | Art. 7, V; para dado de saúde ver seção 4 | **180 dias (default implementado)**, `PILOT_RETENTION_MESSAGES_DAYS` | Corretora, colaboradores, Horizon, Meta (canal), Supabase | Sim (Meta; Baileys usa WhatsApp) | `messages.body` cifrado na aplicação (AES-256-GCM); `contains_sensitive` marcado na ingestão; telefone, nome e `conversations.summary` **não** cifrados |
| A3 | Qualificação e score | Priorizar atendimento | `stage`, `score`, `qualification` jsonb (plano atual, vidas, valor) | Leads | Art. 7, V / IX | Idem lead | Corretora, Horizon | Não | RLS |
| A4 | Funil e eventos | Métricas de vendas, dashboard | `lead_events` (tipo, valor de venda, ator) | Leads | Art. 7, IX (legítimo interesse) | Idem lead | Corretora, Horizon | Não | RLS |
| A5 | Rascunho do agente em modo sombra | Treinar e medir o agente sem enviar nada | `agent_drafts` (rascunho, palpites de etapa/qualificação, raciocínio), histórico enviado ao LLM | Leads, colaboradores | Art. 7, IX **[DECISÃO JURÍDICA]**; se houver saúde, art. 11 | **180 dias (default implementado)**, `PILOT_RETENTION_DRAFTS_DAYS` | Anthropic | **Sim: Anthropic (EUA)** | Chave de API em env; **pseudonimização antes da chamada** (`pilot/shadow.service.ts`, `pilot/compliance/redaction.ts`); lead com `opt_out` ou anonimizado é pulado; `draft_body` cifrado. Mensagens `contains_sensitive` **ainda são enviadas** (só pseudonimizadas por regras; termos de saúde não são mascarados). Provedor nunca exercitado contra a API real |
| A6 | Comparação agente x humano | Medir concordância para liberar modo assistido/auto | `similarity`, `human_action`, `qualification_reviews` | Colaboradores (conduta de escrita) | Art. 7, IX; ver doc 04 | 180 dias | Corretora, Horizon | Não | RLS |
| A7 | Biblioteca de exemplos e playbook | Few-shot e padrão de atendimento | `learned_examples` (situação sem PII, fala do lead, resposta do colaborador), `playbook_versions` | Leads (anonimizados), colaboradores | Art. 7, IX; anonimização (art. 12) onde efetiva | Enquanto aprovado e útil; revisão anual (**sem purga automática**) | Anthropic (entra no prompt) | Sim | Captura só com consentimento ativo `aprendizado_agente` e sem opt-out (`pilot/compliance/learning.service.ts`); texto redigido antes de gravar; nasce `approved = false`; só `approved AND NOT contains_sensitive` entra no prompt; `source_lead_id` permite apagar por titular |
| A8 | Tracking de origem de anúncio | Atribuir vendas a campanhas | ctwa_clid, fbc, fbp, UTMs em `leads.source`; na anonimização só `campaign_id` e `campaign_name` são mantidos | Leads | Consentimento (cookies/pixel) ou art. 7, IX **[DECISÃO JURÍDICA]** | Idem lead | Meta | Sim | Armazenamento local apenas; nada é devolvido à Meta |
| A9 | Conversions API (**não construída**: nenhum código envia eventos à Meta; `lead_events.sent_to_meta_at` existe sem uso) | Devolver conversões à Meta | evento, valor, identificadores (hash) | Leads | Consentimento recomendado **[DECISÃO JURÍDICA]**; **evitar enviar qualquer sinal de saúde** | - | Meta | Sim | Futuro |
| A10 | Painel de acompanhamento | Gestão pela corretora | leitura de leads, mensagens, rascunhos; telefone mascarado nas listas, completo só no detalhe do lead e no export | Leads, colaboradores | Art. 7, IX | Sessão (access 15 min, refresh 7 dias) | Corretora | Não | Login real com scrypt, bloqueio, papéis `viewer/manager/owner`, leituras auditadas (`audit_log`) |
| A11 | CRM e agenda (Pipedrive: código pronto e desligado; Google Calendar: código pronto e desligado) | Registrar negócio e agendar reunião | nome, telefone, etapa do funil, valor da venda, horário (sem conteúdo de conversa) | Leads | Art. 7, V | Conforme contrato dos fornecedores | Pipedrive, Google | Sim | Futuro |
| A12 | Gestão de contas Meta Ads (OAuth) | Sincronizar gasto/insights | tokens criptografados (AES-256-GCM), métricas de campanha | Usuários da corretora | Art. 7, V | Enquanto ativo | Meta | Sim | `ENCRYPTION_KEY` |
| A13 | **Envio de mensagem pelo painel (Conversas)** | Atendente responde o lead dentro da janela de 24 h | texto enviado (`messages.body` cifrado), autor `humano`, `requestedBy` repassado ao chat | Leads | Art. 7, V (resposta a contato iniciado pelo lead) | Idem A2 | Corretora, chat, Meta | Sim | `POST /pilot/conversations/:id/messages` (manager): recusa se `can_contact` falso (422 `contact_blocked`) ou se a janela de 24 h está fechada (422 `window_closed`); audita `conversation.send`; 20 envios/min (throttler em memória) (`pilot/conversations/conversations.service.ts`) |
| A14 | **Aprendizado em modo sombra a partir de resposta humana** | Transformar a resposta real do colaborador em candidato a exemplo | fala do lead e resposta humana **redigidas** (`[LEAD]`, `[TELEFONE]`, `[CPF]`...), `situation`, `contains_sensitive` | Leads, colaboradores | Consentimento `aprendizado_agente` (base `consentimento`, versão do texto e origem obrigatórias) **[DECISÃO JURÍDICA]** | Sem purga automática; apagado por titular via `source_lead_id` | Horizon; Anthropic se aprovado e não sensível | Sim | Só com consentimento ativo e sem opt-out; aprovação humana |
| A15 | **Ligação assistida por operador (click-to-call) com gravação e transcrição** | Atendimento comercial por voz | telefone do lead e do operador, metadados da chamada, **áudio gravado** (no provedor), **transcrição** (cifrada), `contains_sensitive`, versão do aviso de gravação | Leads, operadores | Art. 7, V para a ligação; para **gravação** o código registra "aviso prévio" (`consent_basis = aviso_previo:<versão>`), que **não é consentimento expresso** **[DECISÃO JURÍDICA]**; saúde: art. 11 | Gravação e transcrição: **365 dias por padrão** (`VOICE_RECORDING_RETENTION_DAYS`, `VOICE_TRANSCRIPT_RETENTION_DAYS`), prazo a confirmar com o cliente | Twilio (telefonia e áudio), provedor de STT (ElevenLabs Scribe ou compatível OpenAI); ElevenLabs TTS **não é usado** no fluxo atual (o aviso é `<Say>` do Twilio) | **Sim** (Twilio, STT) | Referência da gravação e segmentos da transcrição cifrados (AES-256-GCM); gravação só retida se o aviso foi entregue; transcrição só para `manager+` e leitura auditada; webhooks por assinatura (`voice/*`). **Nenhum adaptador foi testado com provedor real** |
| A16 | **Disparos (mensagem ativa por WhatsApp oficial)** | Retomar contato com quem deu consentimento | telefone, primeiro nome (variável de template), status de entrega/leitura/resposta, motivo de pulo | Leads com consentimento | `marketing`: consentimento (art. 7, I) com origem registrada; `UTILITY`/texto na janela: consentimento `atendimento` com origem **[DECISÃO JURÍDICA]** | `broadcast_recipients` sem purga automática | Chat, Meta | Sim | `BROADCASTS_ENABLED` desligado por padrão, `dry_run` por padrão, portas por destinatário (consentimento, opt-out, template aprovado, janela, frequência), monitor de saúde do número com auto-pausa (`pilot/broadcasts/*`). **Nada testado contra a Meta.** Doc 12 |
| A17 | **Autenticação e trilha de auditoria do painel** | Controle de acesso e prestação de contas | e-mail, nome, papel, hash scrypt, hash de refresh token, hash do user-agent; `audit_log` (ator, ação, entidade, IP) | Usuários do painel (colaboradores da corretora) | Art. 7, IX **[DECISÃO JURÍDICA]** | Tokens expirados e `audit_log`: sem purga automática; 5 anos propostos para auditoria | Corretora, Horizon | Não | Doc 11 |

## 4. Análise de bases legais

### 4.1 Execução de contrato / procedimentos preliminares (art. 7, V)
Serve para responder um lead que pediu contato ("quero saber de planos"), pois o tratamento é necessário para a proposta pedida pelo titular. **Não cobre** contato frio, nem uso do histórico para treinar IA, nem envio de sinais à Meta.

### 4.2 Consentimento (art. 7, I; art. 8)
Adequado para: (a) mensagens de marketing ativas após a conversa; (b) tracking publicitário e Conversions API; (c) uso da conversa para "aprendizado do agente" se não houver outra base. Deve ser livre, informado, específico, destacado e **comprovável** (guardar texto, versão, data). Fácil de revogar. Em WhatsApp, a regra da plataforma de opt-in vale em paralelo (ver doc 05).

### 4.3 Legítimo interesse (art. 7, IX; art. 10)
Pode sustentar métricas de funil (A4), painel (A10) e, com teste de balanceamento, o rascunho em modo sombra (A5) **se não houver dado sensível**. Exige LIA (teste de proporcionalidade) documentado **[DECISÃO JURÍDICA]**. **Não pode** ser base para dado sensível (art. 11 não prevê legítimo interesse).

### 4.4 Proteção do crédito e tutela da saúde (art. 7, X; art. 11, II, "f")
- Proteção do crédito (art. 7, X): **não se aplica**. Não há análise de crédito.
- Tutela da saúde (art. 11, II, "f"): restrita a procedimento realizado por profissionais de saúde, serviços de saúde ou autoridade sanitária. Corretora de seguros **não** se enquadra. **[DECISÃO JURÍDICA]** confirmar; a conclusão provável é que não se aplica.
- Garantia da prevenção à fraude (art. 11, II, "g") não é o caso aqui.
- Atenção ao art. 11, §4º: é vedada a comunicação ou uso compartilhado de dado de saúde entre controladores com objetivo de vantagem econômica, salvo hipóteses legais (portabilidade a pedido do titular, serviços de saúde). Se o corretor repassar dado de saúde a operadora de plano, avaliar. **[DECISÃO JURÍDICA]**

### 4.5 Dado de saúde (art. 11): conclusão e recomendação
Hoje o sistema **não pede** dado de saúde, mas **não impede** que o lead o escreva e, uma vez escrito, ele entra em `messages.body`, `qualification` e no prompt do LLM. Recomendações:
1. **Minimizar**: o playbook deve orientar o agente a **não perguntar** sobre doenças, medicamentos, gestação ou preexistências. Para cotação, coletar apenas: faixa etária, número de vidas, cidade, plano atual e valor, tipo de contratação (PME, adesão, individual).
2. Se o lead informar saúde espontaneamente, o agente deve responder sem repetir o dado e repassar ao humano (`repassar_humano`).
3. Se a corretora precisar de dado de saúde para cotar (declaração de saúde existe em alguns produtos), tratar **fora do chat de IA**, em formulário da operadora, com consentimento específico e destacado para essa finalidade (art. 11, I) **[DECISÃO JURÍDICA]**.
4. Detecção de termos de saúde **existe** (`flagSensitive`): marca `messages.contains_sensitive`, `learned_examples.contains_sensitive` e `voice_transcripts.contains_sensitive`, e exemplos sensíveis nunca entram no prompt. Mas é lista de termos (falso negativo possível), **não mascara** termos de saúde e **não impede** que mensagens sensíveis do histórico sigam ao LLM (pseudonimizadas). Decisão pendente: pular ou escalar ao humano quando `contains_sensitive` (doc 10).
5. Não usar nenhum sinal de saúde em audiência, score ou evento para Meta.

## 5. Titulares e dependentes
Dependentes citados (cônjuge, filhos, inclusive menores) são titulares que não participaram da conversa. Art. 14 trata de crianças: coletar só o mínimo (idade) e pelo responsável. **[DECISÃO JURÍDICA]**

## 6. Retenção
Ver doc 07. Valores propostos acima são defaults e **[DADO A PREENCHER]** pela corretora após considerar prazo de guarda de documentos de corretagem/SUSEP.

## 7. Compartilhamento
Corretora e colaboradores; Horizon; Supabase (banco); Anthropic (LLM); Meta (WhatsApp, anúncios); Pipedrive e Google (planejados); hospedagem Vercel/servidor da API **[DADO A PREENCHER: onde a API roda]**. Detalhes no doc 10.

## 8. Medidas de segurança
Resumo no doc 11. Implementado: cifra de aplicação de mensagens, rascunhos, transcrições e referência de gravação; login real e papéis; trilha de auditoria; retenção; pseudonimização antes do LLM. Lacunas principais: CSP com `'unsafe-inline'`, throttler em memória, sem troca de senha, telefone/nome/resumo/qualificação sem cifra, cron de retenção possivelmente inativo em modo `PILOT_ONLY`.

## 9. Manutenção deste registro
Atualizar quando: nova integração (Pipedrive, Google, Conversions API), mudança de LLM, novo canal, ou mudança de modo do agente (shadow para assisted/auto). Cada alteração, anotar data e responsável.
