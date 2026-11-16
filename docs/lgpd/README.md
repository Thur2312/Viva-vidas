# Pasta LGPD - Horizon Agente

Conjunto de documentos para apoiar a adequação do Horizon Agente (agente de IA para WhatsApp da corretora de Alberto Apolinário) à LGPD (Lei 13.709/2018). Fatos extraídos do código em 2026-11-12 (versão 0.2, reconciliada após a implementação de compliance, autenticação do painel, voz, disparos e conversas). **Nada aqui declara conformidade**; são rascunhos para decisão do dono do produto e revisão de advogado. Nada foi exercitado contra Meta, Twilio, Anthropic ou provedor de STT reais (sem chaves).

> **Atualização de 16/11/2026:** a infraestrutura real de produção (VPS com Postgres próprio, painel no Vercel em São Paulo e backup cifrado no Cloudflare R2) substitui as menções ao Supabase, que nunca foi usado. Os demais textos seguem na versão de 12/11/2026.

## Índice
| Arquivo | Para quê |
|---|---|
| `00-checklist-conformidade.md` | Obrigações por artigo, status e onde está a evidência |
| `01-registro-operacoes-ropa.md` | Registro das operações (art. 37), bases legais, papéis controlador/operador (A1 a A17) |
| `02-ripd-relatorio-impacto.md` | Matriz de riscos e mitigações (art. 38), R1 a R16 |
| `03-politica-privacidade-titular.md` | Aviso de privacidade em linguagem simples para leads |
| `04-aviso-colaboradores.md` | Aviso e regras para os colaboradores cujas conversas alimentam o aprendizado |
| `05-textos-consentimento-optin.md` | Textos de opt-in/opt-out e versionamento (`text_version`) |
| `06-contrato-operador-dpa.md` | Modelo de contrato Controlador-Operador (art. 39) |
| `07-politica-retencao-descarte.md` | Prazos, variáveis reais e descarte por classe de dado |
| `08-direitos-do-titular-procedimento.md` | Roteiro para pedidos do art. 18 com os endpoints reais |
| `09-plano-resposta-incidentes.md` | Plano de incidentes (art. 48) com passos técnicos e rotação de chaves |
| `10-transferencia-internacional-e-subprocessadores.md` | Suboperadores (inclui Twilio e ElevenLabs/STT), LLM, art. 33 |
| `11-seguranca-medidas-tecnicas.md` | Medidas verificadas e lacunas |
| `12-voz-e-disparos.md` | Ligações e disparos: bases legais, evidência de opt-in, regras de plataforma, plano para a carteira de leads perdidos |

## Como usar
1. Ler 00 para ver o quadro geral.
2. Resolver os marcadores `**[DADO A PREENCHER]**` (informação da empresa) e a pendência de revisão jurídica (precisa de advogado). Nenhum dado da empresa foi inventado.
3. Levar 01, 02, 03, 05, 06 e 12 ao advogado. Publicar 03 e 05 só depois.
4. Os itens `[reconferir]` da primeira versão foram verificados contra o código nesta revisão; restam apenas os marcados `[reconferir em execução]` (ex.: se o agendamento da retenção roda).
5. Revisar os documentos ao mudar de modo (shadow para assisted/auto), ao ligar voz, disparos, Pipedrive/Google/Conversions API ou ao trocar de LLM.

## O que falta (atualizado em 2026-11-12)

### (a) Software
Já implementado e verificado no código (com testes, sem serviços reais): registro de consentimentos, `can_contact`, opt-out que bloqueia contato e aprendizado, endpoints de titular (export, correção, anonimização, eliminação, consentimentos, pedidos com prazo de 15 dias), `audit_log`, retenção, redação e pseudonimização antes do LLM, cifra AES-256-GCM, login do painel e papéis, helmet/CORS/limites, cabeçalhos e CSP no web, voz, disparos com portas e monitor de qualidade, envio pelo painel dentro da janela de 24 h.

Falta ou é diferente do desejável:
- [x] **Cron de retenção e worker de disparos em `PILOT_ONLY=true`**: corrigido (`ScheduleModule.forRoot()` agora também carrega nesse modo, `api/src/app.module.ts`). **Ainda falta confirmar em instância em execução** que os jobs disparam no horário.
- [x] **Consentimento `atendimento` automático**: corrigido. `pilot.service.ts#upsertLead` só registra `atendimento`/`qualificacao` quando há evidência (o lead escreveu primeiro, `source = mensagem_do_lead`, ou foi informada uma `optInOrigin`). Lead importado sem origem **não ganha consentimento** e não passa nas portas de voz e disparo. Consentimento de `marketing` e de `aprendizado_agente` agora exige `source` no formato `tipo:referencia` (`whatsapp_optin`, `formulario_com_aviso`, `anuncio_click_to_whatsapp`, `ligacao_gravada`, `presencial_assinado`, `cadastro_site`); texto livre é recusado (`compliance/consent.service.ts`, testes em `consent-source.spec.ts` e `compliance.integration.spec.ts`). **Segue pendente:** a referência é verificada só no formato, não contra o documento de origem; a comprovação real do opt-in da carteira continua sendo trabalho humano.
- [ ] Decidir/implementar: pular ou escalar ao humano mensagens `contains_sensitive` antes do LLM (hoje só pseudonimiza; termos de saúde não são mascarados).
- [ ] CSP do web sem `'unsafe-inline'` (nonce).
- [ ] Throttler com storage compartilhado (hoje em memória); cache de refresh do BFF compartilhado (hoje por instância).
- [ ] Endpoint de troca/recuperação de senha; 2FA; revogar o JWT de 15 min ao desativar usuário.
- [ ] Tratar os achados de auditoria do Prisma CLI (não reverificados aqui).
- [ ] `DncChecker` real (ou decisão documentada) para voz.
- [ ] Ligar o retorno de entrega/leitura do chat (`/pilot/broadcasts/webhook/status`); ponte reenviando edições/exclusões; rotulagem humano x agente ainda é heurística.
- [ ] Reconhecimento de mais formas de opt-out ("pare", "stop", frases, botão de template) e confirmação ao contato.
- [ ] Rotina de recifragem para `PILOT_DATA_KEY` (hoje não existe); definir `PILOT_PHONE_SALT` explícito.
- [ ] Purga automática de `audit_log`, `consents`, `learned_examples`, `lead_events`, `broadcast_recipients`, metadados de voz e tokens expirados (prazos a decidir).
- [x] Log de `payload` (número e texto) removido de `SendTextOfficialService` e `SendMediaOfficialService` no chat (cópia em `horizon-chat-api`). Os logs de sucesso também deixaram de imprimir a resposta bruta da Graph API.
- [ ] Texto real da página `/privacidade` (hoje é marcador) e canal de pedidos do titular; alerta de pedido vencendo.
- [ ] Conferir a ausência da migração `005_*.sql`.
- [ ] Conversions API: **não construída**; só construir após decisão jurídica.

### (b) Papéis para assinar ou preencher
- [ ] Dados da corretora e da Horizon (razão social, CNPJ, endereço, SUSEP).
- [ ] Nome e canal do encarregado (e variáveis `NEXT_PUBLIC_LGPD_*` da página `/privacidade`).
- [ ] Contrato Controlador-Operador (doc 06) assinado.
- [ ] DPAs com Anthropic, o provedor da VPS, Vercel, Cloudflare, Meta, **Twilio, ElevenLabs/provedor de STT**, Pipedrive e Google.
- [ ] Aviso aos colaboradores com ciência assinada (doc 04).
- [ ] Prazos de retenção aprovados (doc 07), incluindo gravação de voz e leads `venda`.
- [ ] Contatos da árvore de incidentes (doc 09); guarda de `PILOT_DATA_KEY` em cofre separado.
- [ ] Confirmar provedor e região da VPS, região do bucket do R2, retenção de snapshots do provedor e de logs.
- [ ] Portfólio empresarial Meta, WABA e número do **próprio corretor**; templates criados e aprovados.
- [ ] Conta Twilio, Regulatory Bundle e número brasileiro, URL pública HTTPS dos webhooks.
- [ ] Segmentar a carteira de ~70 mil contatos em A/B/C (doc 12) e guardar a prova de opt-in do grupo A.

### (c) Revisão jurídica
- [ ] Papéis (controlador/operador/conjunto), Conversions API e controladoria conjunta com a Meta.
- [ ] Base legal de cada atividade, em especial dado de saúde (art. 11) e legítimo interesse para o rascunho de IA e para o aprendizado.
- [ ] Aviso de gravação de voz: "aviso prévio" basta ou é preciso consentimento expresso; prazo de guarda das gravações; Anatel e "Não Perturbe".
- [ ] LIA escrita (legítimo interesse) para qualquer contato com a carteira; vedação de base fria.
- [ ] Subir lista de telefones como público de anúncios (grupo B): base e transferência à Meta.
- [ ] Mecanismo do art. 33 para Anthropic, Meta, Twilio, ElevenLabs/STT, Google, Pipedrive.
- [ ] Prazo de comunicação de incidente à ANPD (Res. CD/ANPD nº 15/2024: 3 dias úteis; confirmar vigência).
- [ ] Consentimento para marketing e "aprendizado do agente".
- [ ] Tratamento de dados de colaboradores (doc 04) e vedação de uso para avaliação.
- [ ] Limitação de responsabilidade do DPA.
- [ ] Uso do canal Baileys.

Regras de plataforma (opt-in, templates, qualidade do número) vêm da Meta/WhatsApp e não substituem a LGPD; regras de ligação vêm da regulação de telecom.
