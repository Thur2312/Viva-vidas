# 11 - Medidas de segurança técnicas e organizacionais (LGPD art. 46)

Versão 0.2, verificado no código em 2026-11-12 (leitura de `api/`, `web/`, ponte do chat e migrações 001 a 007; testes automatizados existem para a maior parte, mas **nada foi exercitado em produção nem contra Meta, Twilio, Anthropic ou STT reais**). Descreve apenas o que o código evidencia. **Não declara conformidade.** Caminhos relativos a `api/src/modules/` salvo indicação.

## 1. Medidas comprovadas

| Medida | Evidência | Detalhe |
|---|---|---|
| Isolamento do schema | `api/db/migrations/001_horizon_agent.sql` | Schema `horizon_agent` separado; reversível |
| RLS ligado em todas as tabelas novas, sem políticas | migrações 001 a 007 | `anon` e `authenticated` sem acesso (`REVOKE`); só a conexão direta do backend. A role dona do banco ignora RLS: proteger a credencial |
| Autenticação da ingestão | `pilot/pilot-key.guard.ts` | `x-pilot-key`, `timingSafeEqual`; **sem `PILOT_API_KEY` as rotas ficam fechadas**. Distinta de `CHAT_BRIDGE_KEY` (direção oposta) |
| Login do painel | `panel-auth/password.util.ts`, `panel-auth.service.ts` | scrypt N=32768 r=8 p=1, sal por usuário, parâmetros dentro do hash; scrypt executado também para usuário inexistente/bloqueado (reduz enumeração por tempo); resposta genérica `Credenciais invalidas`; política de senha em `passwordProblems` (12+ caracteres, 3 de 4 classes, sem palavras comuns) usada pelo script de criação de usuário (`api/scripts/create-panel-user.ts`) |
| Bloqueio | `panel-auth.service.ts` | 5 falhas consecutivas bloqueiam por 15 min (atômico no SQL) |
| Tokens | `panel-auth/tokens.util.ts`, `panel-roles.ts`, migração 003 | Access JWT **HS256 fixo** de 15 min (emissor e claims verificados; `alg` diferente rejeitado), assinado com `SECRETKEY`; refresh de 7 dias, 256 bits aleatórios, **só o SHA-256 vai ao banco**; rotação a cada uso; **reuso de token revoga a família inteira**; logout revoga a família; refresh de usuário desativado revoga a família |
| Papéis por rota | `panel-auth/roles.guard.ts`, `@Roles` nos controllers | `owner > manager > viewer`, guard global, falha fechada (papel desconhecido = 403). Rotas sem `@Roles` exigem apenas JWT válido. Matriz resumida: ler = viewer; enviar mensagem, ligar, disparos, export/correção/anonimização/eliminação/consentimentos = manager; configurações de voz, criar template, auditoria e retenção = owner; transcrição de voz só manager+ |
| Rate limit por rota | `panel-auth.controller.ts`, `conversations.controller.ts` | Login 10/min por IP, refresh/logout 30/min, leitura de mensagens 60/min, envio 20/min; global 1500 por 15 min (`app.module.ts`) |
| Cifra de aplicação | `pilot/compliance/crypto.service.ts` | AES-256-GCM, IV aleatório de 12 bytes por valor, formato `enc:v<N>:`; cobre `messages.body`, `agent_drafts.draft_body`, `voice_transcripts.segments_enc` e `voice_calls.recording_url_ref`; **falha fechada** sem chave (ingestão e leitura); versionamento de chave (`PILOT_DATA_KEY_VERSION`, `PILOT_DATA_KEY_V<n>`) |
| Pseudonimização antes do LLM | `pilot/shadow.service.ts`, `pilot/compliance/redaction.ts` | Doc 10, seção 2 |
| Minimização na exibição | `pilot/compliance/phone.ts` | Telefone mascarado nas listas de leads, conversas, destinatários de disparo e ligações; completo só no detalhe do lead e no export; busca de conversas só por nome e telefone (corpo cifrado nunca entra na busca) |
| Trilha de auditoria | `pilot/compliance/audit.service.ts` | `details` sem dado pessoal: chaves proibidas (nome, telefone, corpo, e-mail, CPF, resumo, qualificação...) removidas e strings passam por redação; leituras de lead (`lead.read`), conversa (`conversation.read`, 1 por operador+conversa a cada 5 min) e transcrição (`voice.transcript.read`) são auditadas, além de ações sensíveis |
| Retenção | `pilot/compliance/retention.service.ts` | Doc 07 |
| Direitos do titular | `pilot/compliance/data-subject.service.ts` | Doc 08 |
| Consentimento | `pilot/compliance/consent.service.ts` | `can_contact`, `canLearn`; opt-out revoga tudo |
| Hardening HTTP da API | `main.ts`, `panel-auth/security/hardening.ts` | `helmet` com CSP `default-src 'none'`, `frame-ancestors 'none'`, `Referrer-Policy: no-referrer`, HSTS 180 dias; `Cache-Control: no-store`; `x-powered-by` desligado; **CORS nega por padrão** (só origens exatas de `CORS_ORIGINS`, sem `*`, sem `localhost` implícito); corpo limitado (`BODY_LIMIT`, padrão 1 MB); `SafeExceptionFilter` não devolve detalhe de erros 5xx; `trust proxy` só para proxies conhecidos |
| Logs sem PII | `hardening.ts#requestLogger`, `scrub` | Só id, método, caminho sem query, status e duração; segmentos numéricos longos e tokens viram `:redacted`; erros 5xx passam por `scrub` (telefone, Bearer, JWT, valores longos); webhooks de voz e erros de STT/LLM não registram corpo |
| Fail-fast de ambiente | `main.ts`, `validateEnv` | Em produção o boot é recusado com `SECRETKEY` ausente, com menos de 32 caracteres ou parecida com placeholder, ou com `CORS_ORIGINS` contendo `*` |
| Web: sessão | `web/src/lib/session.ts`, `middleware.ts`, `app/api/auth/*`, `app/api/pilot/[...path]` | Tokens só em cookies `httpOnly`, `SameSite=Lax`, `Secure` em produção; o navegador nunca vê tokens; BFF com lista fechada de rotas e parâmetros; login confere mesma origem; modo demo só com `NEXT_PUBLIC_DEMO=true`. O middleware confere apenas a **presença** do cookie; a validade é conferida pelo BFF a cada chamada |
| Web: cabeçalhos | `web/next.config.mjs` | CSP (`default-src 'self'`, `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, `upgrade-insecure-requests` em produção), `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: no-referrer`, `Permissions-Policy` restritiva, COOP/CORP `same-origin`, HSTS em produção. **Sem `'unsafe-eval'` em produção; ainda com `'unsafe-inline'` em scripts** |
| Webhooks assinados | `voice/voice-webhooks.controller.ts`, `voice/telephony/twilio-signature.ts`; `meta-webhook` | Voz: HMAC do Twilio em tempo constante sobre a URL pública configurada; sem base ou token = recusa; chamada desconhecida = 200 sem revelar nada; idempotência por evento. Meta: verificação de assinatura (`WHATSAPP_META_WEBHOOK_SIGNATURE_DISABLED` nunca `true` em produção) |
| Ponte do chat | `horizon-chat-api/docs/pilot-bridge.md` | Saída: `x-pilot-key` = `CHAT_BRIDGE_KEY` em tempo constante, fechada sem a variável (503), 120 req/min por IP e 10 tentativas erradas/min, só canal oficial. Entrada: opt-in por conexão, fila em memória, circuito de falha, mídia só como placeholder, grupos/status/notas/importadas nunca enviados |
| Segredos fora do código | `api/.env.example` | Somente nomes de variáveis |
| Interruptores de risco | `broadcasts.service.ts`, `voice.service.ts` | `BROADCASTS_ENABLED` desligado por padrão; `dry_run` por padrão; voz e DNC falham fechado |
| Segredos de terceiros em repouso | `shared/util/encryption.utils.ts` | AES-256-GCM para tokens Meta, chave `ENCRYPTION_KEY` |

## 2. Lacunas honestas (o que ainda falta ou é diferente do desejável)

1. **CSP do web com `'unsafe-inline'` em `script-src`** (scripts de hidratação do Next e do tema). Evolução: nonce via middleware.
2. **Throttler em memória** (`ThrottlerModule.forRoot` sem storage): os contadores zeram a cada reinício e não são compartilhados entre instâncias; em mais de uma instância o limite efetivo é multiplicado.
3. **Cache de refresh por instância no BFF** (`web/src/lib/api.ts`: `inflight`/`recent` em memória, 30 s). Com mais de uma instância do web, duas chamadas concorrentes com o mesmo refresh token podem ir a instâncias diferentes, uma delas parecerá "reuso" e **a família é revogada** (usuário deslogado).
4. **Sem endpoint de troca/recuperação de senha.** Usuários são criados por script (`api/scripts/create-panel-user.ts`); trocar a senha exige operar o script/banco. Sem 2FA.
5. **JWT de acesso de 15 min não é revogável**: `JwtStrategy.validate` não consulta `panel_users.active`. Desativar um usuário só barra o refresh; o acesso continua até 15 min depois (a menos que `SECRETKEY` seja trocada).
6. **Achados de auditoria do Prisma CLI** (dependência de desenvolvimento): reportados na auditoria do projeto e **não reverificados nesta leitura**; tratar antes de produção.
7. **`DncChecker` não existe.** `DNC_CHECKER` é fixo em `null`; com `VOICE_DNC_ENABLED=true` toda ligação é recusada; sem ele, não há consulta a nenhuma lista "Não Perturbe".
8. **Entrega e leitura não chegam do chat**: o chat não propaga os `statuses` do Graph; o endpoint `POST /pilot/broadcasts/webhook/status` existe mas **não está ligado**. Só o evento de qualidade do número é encaminhado. KPIs de entrega/leitura dos disparos ficam vazios.
9. **Distinção humano x agente é heurística** na ponte do chat (usuário associado à mensagem). Palavras de parada só valem como mensagem inteira (`parar`, `sair`, `cancelar`, `nao quero`, `descadastrar`).
10. **Edições e exclusões de mensagem não são reenviadas** pela ponte: o texto armazenado pode divergir do que o contato vê (e do que o titular apagou).
11. ~~`SendTextOfficialService` do chat registrava `payload` (número e texto) em `console.error`~~ **Corrigido** em `SendTextOfficialService` e `SendMediaOfficialService` (`horizon-chat-api`). Resta revisar outros pontos do chat que possam registrar corpo de mensagem.
12. **Campos sem cifra de aplicação:** `leads.phone`, `leads.name`, `conversations.summary`, `leads.qualification`, `lead_events.payload`, `agent_drafts.reasoning`, `learned_examples.*` (redigidos). O telefone não é cifrado de propósito (índice único e buscas); fica mascarado nas listas.
13. **Mensagens sensíveis ainda seguem ao LLM** (doc 10).
14. **Credencial única do banco**, sem separação leitura (painel) x escrita (ingestão).
15. **`PILOT_API_KEY` única e compartilhada**; rotação manual; sem lista de IPs.
16. **Sem recifragem de `PILOT_DATA_KEY`** (doc 09) e **sem purga** de `audit_log`, `consents`, `learned_examples`, `lead_events` etc. (doc 07).
17. ~~Cron de retenção e worker de disparos podem não rodar em `PILOT_ONLY=true`~~ **Corrigido** (`ScheduleModule` agora também no modo piloto); falta confirmação em instância em execução.
18. **Backups e logs de infraestrutura estão fora da aplicação**: hoje há backup diário cifrado com `age` (7 dias na VPS e 30 dias no Cloudflare R2), com restauração testada em 14/11/2026, e logs rotacionados por `logrotate`. Falta confirmar **[DADO A PREENCHER: retenção de snapshots do provedor e dos logs]**.
19. **Canal Baileys** não oficial: sessão no servidor equivale a acesso total ao WhatsApp; guardar credenciais com cifra e acesso restrito.
20. **Deploy herdado** do chat (`deploy.sh`, Dockerfile) aponta para infra antiga, conforme README.
21. **Sem teste de intrusão**, sem alerta automático sobre `audit_log`, sem plano de backup/restauração documentado.
22. **Numeração de migrações**: não existe `005_*.sql` (de 004 salta para 006); confirmar que nada foi perdido.

## 3. Medidas organizacionais (todas pendentes)
Nomear encarregado; treinar colaboradores; contratos com suboperadores; política de senhas e de mesa limpa; gestão de acessos (revisão trimestral, desativar usuários ao sair); segregação de funções; revisão periódica da trilha de auditoria; teste de restauração de backup; teste de resposta a incidente (doc 09); guarda de `PILOT_DATA_KEY` em cofre separado.

## 4. Política de logs (proposta)
Registrar: ator, ação, entidade, IP, horário. Não registrar: corpo de mensagem, nome, telefone completo, tokens, URLs com senha. A API já segue isso (seção 1); lacunas no chat (item 11 acima). Retenção de logs de aplicação: 90 dias **[DADO A PREENCHER]**.
