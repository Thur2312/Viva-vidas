# 09 - Plano de resposta a incidentes de segurança (LGPD art. 48)

Versão 0.2 (2026-11-12), reconciliada com o código. Revisão jurídica **[DECISÃO JURÍDICA]**. **Não declara conformidade.** Nenhum valor de segredo deve ser colado em tickets, chats ou neste documento.

## 1. Papéis e árvore de contato
| Papel | Responsabilidade | Contato |
|---|---|---|
| Coordenador de incidente (Horizon) | Conduz contenção e evidências | **[DADO A PREENCHER]** |
| Responsável técnico (Horizon) | Executa passos da seção 5 | **[DADO A PREENCHER]** |
| Encarregado (Controladora) | Avalia risco, decide e faz comunicações | **[DADO A PREENCHER]** |
| Representante legal da Controladora | Aprova comunicação à ANPD | **[DADO A PREENCHER]** |
| Advogado | Orienta | **[DADO A PREENCHER]** |
| Suporte Supabase / Meta / Anthropic / Twilio / provedor de STT | Escalonamento de suboperador | **[DADO A PREENCHER]** |

Ordem: quem detecta avisa o Coordenador (imediato) que avisa o Encarregado (meta: até 24h, ver DPA doc 06).

## 2. Definição
Incidente = acesso não autorizado, perda, alteração, divulgação ou destruição acidental/ilícita de dados pessoais (art. 46). Exemplos: `PILOT_API_KEY` ou `CHAT_BRIDGE_KEY` vazada, banco exposto, `PILOT_DATA_KEY` vazada junto com um dump, envio a número errado, disparo indevido, gravação de voz acessada, conta Meta/Twilio comprometida, ex-colaborador com acesso, refresh token roubado.

## 3. Severidade
| Nível | Critério | Meta de contenção | Notificação |
|---|---|---|---|
| Crítico | Dados sensíveis de saúde ou grande volume expostos, chave de banco vazada, ou dump do banco **mais** `PILOT_DATA_KEY` | 1 h | Provável: ANPD e titulares |
| Alto | Conversas/telefones de leads acessados indevidamente, token de painel comprometido, gravação de voz exposta, disparo para quem não deveria | 4 h | Avaliar |
| Médio | Tentativa bem-sucedida sem evidência de acesso a dados; credencial de baixo privilégio vazada | 24 h | Registrar; avaliar |
| Baixo | Tentativa bloqueada (lockout, rate limit) | - | Registrar |

## 4. Fases
1. **Detecção**: relatos de colaboradores, `GET /pilot/audit-log` (owner), logs do painel/API (método, caminho, status), avisos do Supabase/Meta/Twilio. **Não há alerta automático**: nada monitora a trilha por rotina.
2. **Triagem** (até 2 h): confirmar, classificar, abrir registro com data/hora de ciência.
3. **Contenção**: seção 5.
4. **Avaliação de risco aos titulares**: quais dados (há saúde?), quantos titulares, **o que estava cifrado**. Hoje a cifra de aplicação (AES-256-GCM) cobre `messages.body`, `agent_drafts.draft_body`, transcrições de voz e a referência da gravação. **Não cobre**: telefone, nome, `conversations.summary`, `leads.qualification`, `lead_events.payload`, `agent_drafts.reasoning`, `learned_examples` (redigidos, mas em claro). Se o vazamento incluiu `PILOT_DATA_KEY`, tratar tudo como exposto.
5. **Comunicação (art. 48)**: ao ANPD e aos titulares **se houver risco ou dano relevante**. Prazo regulatório: a Resolução CD/ANPD nº 15/2024 define **3 dias úteis** a contar da ciência do controlador **[DECISÃO JURÍDICA: advogado deve confirmar o prazo vigente e o formulário]**. O controlador decide e assina; a Operadora fornece subsídios (cláusula 10 do DPA). Conteúdo mínimo: natureza, dados afetados, titulares, medidas técnicas, riscos, o que foi feito, motivo se atrasar, contato do encarregado. Aos titulares em linguagem simples.
6. **Evidências**: preservar logs, linha do tempo, decisões, cópias de comunicações (guardar 5 anos).
7. **Pós-mortem** (até 10 dias): causa raiz, o que falhou, ações com dono e prazo, atualização de RIPD e doc 11.

## 5. Primeiros passos técnicos neste stack
Ordem sugerida; registre horário de cada ação fora do sistema (sem dado pessoal). Nomes são de variáveis de ambiente; **nunca** imprima ou cole os valores.

1. **Preservar evidência antes de mexer**: exportar logs da aplicação e do Supabase (Postgres/API), `audit_log` (`GET /pilot/audit-log`), listagem de `panel_refresh_tokens` (só `user_id`, `family_id`, datas; não o hash). Não apagar nada.
2. **Parar envios**:
   - Disparos: definir `BROADCASTS_ENABLED=false` (qualquer valor diferente de `true`/`1` desliga) e **reiniciar a API**; o worker só processa disparos em simulação com o interruptor desligado. Para o disparo em curso: `POST /pilot/broadcasts/:id/pause` (manager) ou `/cancel`.
   - Mensagens pelo painel: remover `CHAT_API_URL` ou `CHAT_BRIDGE_KEY` da API (envio devolve 503 "Chat não configurado") ou remover `CHAT_BRIDGE_KEY` do chat (ponte de saída fecha com 503 `bridge_closed`).
   - Voz: esvaziar `TWILIO_ACCOUNT_SID`/`TWILIO_AUTH_TOKEN` ou `VOICE_WEBHOOK_BASE_URL` (ligações passam a ser recusadas com 503, auditado).
3. **Desligar a ponte de entrada do chat**: no chat, remover/esvaziar `PILOT_INGEST_URL`, `PILOT_API_KEY` ou `PILOT_CONNECTION_IDS` e reiniciar (`docs/pilot-bridge.md`: nada é enviado). **Desativar ingestão no lado da API:** remover/trocar `PILOT_API_KEY` (sem chave, `PilotKeyGuard` fecha `/pilot/leads`, `/pilot/ingest/message`, `/pilot/events`, `/pilot/shadow/run`, `/pilot/leads/:id/qualification` e os webhooks `/pilot/broadcasts/webhook/*`).
4. **Rotacionar segredos** (cada item: gerar novo, atualizar quem usa, reiniciar, revogar o antigo):
   - `PILOT_API_KEY` (e `PILOT_API_KEY` do chat, que é o mesmo valor), `CHAT_BRIDGE_KEY` (API e chat).
   - `SECRETKEY`: assina os JWT de acesso do painel (15 min). Trocar **invalida os tokens de acesso**, mas **não** os refresh tokens (são aleatórios, com hash no banco, não dependem de `SECRETKEY`): faça também o passo 5. Em produção o boot recusa `SECRETKEY` com menos de 32 caracteres ou placeholder.
   - Credenciais do banco: senha do usuário em `PILOT_DATABASE_URL`/`DATABASE_URL` (Supabase: reset da senha e das chaves service/anon).
   - `TWILIO_AUTH_TOKEN` (também valida a assinatura dos webhooks de voz), `ELEVENLABS_API_KEY`, `STT_API_KEY`, `ANTHROPIC_API_KEY` (revogar no console do provedor).
   - `ENCRYPTION_KEY` (tokens Meta) **somente com plano de recifragem**: trocar sem migrar impede ler tokens Meta já gravados. Tokens do WhatsApp/Meta (revogar token do usuário do sistema, regenerar), `FB_APP_SECRET`, Pipedrive/Google quando existirem.
5. **Revogar sessões do painel**: `UPDATE horizon_agent.panel_refresh_tokens SET revoked_at = now() WHERE revoked_at IS NULL;` e desativar usuários suspeitos: `UPDATE horizon_agent.panel_users SET active = false WHERE id = '<id>';`. **Atenção:** o JWT de acesso (15 min) **não é revogado individualmente** e `JwtStrategy.validate` não consulta `panel_users.active`; um usuário desativado mantém acesso até o token expirar, a menos que `SECRETKEY` seja trocada. O refresh de usuário desativado revoga a família (`panel-auth.service.ts#refresh`).
6. **Rotação de `PILOT_DATA_KEY`** (chave AES-256-GCM, 32 bytes em base64; `compliance/crypto.service.ts`):
   1. Gere uma chave nova de 32 bytes (base64) fora do repositório.
   2. Anote a versão atual `N` (`PILOT_DATA_KEY_VERSION`, padrão 1).
   3. Mova a chave **antiga** para `PILOT_DATA_KEY_V<N>`, ponha a nova em `PILOT_DATA_KEY` e defina `PILOT_DATA_KEY_VERSION=<N+1>`. Reinicie.
   4. Valores gravados antes continuam legíveis (o prefixo `enc:v<N>:` indica a chave); os novos saem na versão nova.
   5. **Não há rotina de recifragem no código.** Linhas antigas continuam cifradas com a chave antiga: se a chave antiga foi **comprometida**, a rotação sozinha **não** protege o histórico; é preciso escrever e rodar uma migração que decifre e recifre (não existe) ou apagar/anonimizar os dados. Guardar `PILOT_DATA_KEY_V<N>` enquanto existir linha nessa versão.
   6. **Perder a chave (ou a chave de uma versão) torna ilegíveis, sem recuperação**, as mensagens, rascunhos, transcrições e referências de gravação dessa versão; a leitura falha fechado com erro e a ingestão não sobe sem `PILOT_DATA_KEY` (`assertReady`). Backups cifrados dependem da mesma chave. Guardar cópia da chave em cofre separado do banco e do backup.
   7. **`PILOT_PHONE_SALT`**: se não estiver definido, o hash de telefone (bloqueio de opt-out de lead anonimizado, `leads.phone_hash`) é derivado de `PILOT_DATA_KEY`. Rotacionar `PILOT_DATA_KEY` nesse caso **muda o hash e libera o recontato** de números já bloqueados. Defina `PILOT_PHONE_SALT` explicitamente e não o altere.
7. **Conter o canal**: se a sessão Baileys vazou, desconectar o dispositivo no WhatsApp do número; no canal oficial, revogar tokens e, se necessário, desativar o webhook (conferir `WHATSAPP_META_WEBHOOK_SIGNATURE_DISABLED` fora de `true`). Gravações de voz comprometidas: apagar no Twilio e listar por `voice_calls` os `recording_url_ref` ainda não nulos.
8. **Revisar acesso ao banco**: confirmar RLS ligado e `REVOKE` para anon/authenticated (migrações 001 a 007); revisar quais roles e IPs acessam; a credencial do backend é única.
9. **Bloquear o LLM** se o provedor de IA for fonte do incidente: remover `ANTHROPIC_API_KEY` (o provedor fica desativado e o pipeline segue).
10. **Verificar escopo**: consultar `audit_log` por ator/ação/IP (`lead.read`, `conversation.read`, `lead.export`, `voice.transcript.read`, `conversation.send`, `broadcast.*`, `voice.call.*`); estimar leads afetados.
11. **Restaurar** só depois de confirmar causa; reaplicar eliminações concluídas em `data_subject_requests` (doc 07).

## 6. Registro do incidente (modelo)
| Campo | Valor |
|---|---|
| ID, data/hora da ciência | |
| Quem detectou / como | |
| Dados e titulares afetados (estimativa) | |
| Contém dado sensível? | |
| O que estava cifrado na aplicação? A chave `PILOT_DATA_KEY` foi exposta? | |
| Medidas de contenção e horários | |
| Decisão de notificar (quem, quando) | |
| Comunicações enviadas (ANPD, titulares) | |
| Causa raiz e ações corretivas | |
