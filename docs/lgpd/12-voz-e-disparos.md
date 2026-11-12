# 12 - Voz (ligações) e disparos (mensagem ativa por WhatsApp)

Versão 0.1 (2026-11-12). Rascunho para revisão de advogado. Fatos extraídos do código em `api/src/modules/voice/**` e `api/src/modules/pilot/broadcasts/**`, de `docs/voice.md`, `docs/disparos.md`, `docs/whatsapp-oficial.md` e de `horizon-chat-api/docs/pilot-bridge.md`. **Nada aqui declara conformidade nem é parecer jurídico.** As duas funções **nunca foram exercitadas contra serviços reais** (sem chaves de Twilio, STT ou Meta; sem chat real): os testes usam dublês e banco de teste.

Dois conjuntos de regras distintos se aplicam e **não se substituem**:
1. **LGPD** (lei brasileira: base legal, transparência, direitos do titular, transferência internacional).
2. **Regras de plataforma e de telecom** (WhatsApp/Meta; Twilio; regulação de telecomunicações/Anatel para ligações). Descumprir a plataforma derruba o número ou a conta mesmo que a LGPD estivesse atendida, e atender a plataforma não dá base legal.

## 1. Estado do código (resumo honesto)

| Item | Estado |
|---|---|
| Voz: click-to-call por operador (Twilio sem SDK), gravação, aviso, transcrição (STT), ganchos LGPD, retenção | Implementado e testado com dublês; **sem credenciais, não testado com Twilio/STT reais** |
| Voz: agente de voz automático (IA falando) | **Não existe** (só projeto, `docs/voice.md` seção 8). O adaptador TTS ElevenLabs existe, mas **o fluxo atual não o usa**: o aviso é `<Say>` do Twilio |
| Voz: "Não Perturbe" | Gancho pronto; **nenhum verificador (`DncChecker`) existe**; ligado e sem verificador, toda ligação é recusada |
| Disparos: criação, público, portas, worker, monitor de saúde do número | Implementado e testado com dublês; **não testado contra a Meta nem contra um chat real**; `BROADCASTS_ENABLED` desligado por padrão e `dry_run` por padrão |
| Disparos: entrega/leitura | **Não chegam**: o chat não propaga `statuses` (webhook `/pilot/broadcasts/webhook/status` existe e não está ligado); só `replied` (mensagem recebida em até 72 h) e a qualidade do número são atualizados |
| Templates | 5 rascunhos em `docs/whatsapp-oficial.md`; **nenhum criado/aprovado na Meta** |
| Conversions API (devolver conversões à Meta) | **Não construída** |

## 2. Voz

### 2.1 O que o código faz
Fluxo (`voice.service.ts`, `voice-webhooks.controller.ts`): o gestor (papel `manager`) aciona `POST /voice/calls {leadId}`; o sistema liga primeiro para o telefone do operador (`VOICE_OPERATOR_PHONE`); quando o operador atende, o Twilio liga ao lead; **quando o lead atende, toca o aviso de gravação** (`<Say language="pt-BR">`, texto configurado pelo `owner` em `PUT /voice/settings`; versão = hash do texto) e só depois conecta a ponte; a gravação (`record-from-answer-dual`) só é retida se o aviso foi registrado como entregue (`recording_announced_at`); caso contrário é apagada no provedor. Com STT configurado, o áudio é baixado de forma transitória, transcrito, e a transcrição vai cifrada para `voice_transcripts`.

Portões que **falham fechado** antes de discar (`voice-gates.ts`, na ordem): lead existente e não anonimizado; `can_contact` (sem opt-out, sem marketing revogado); consentimento ativo `atendimento`; texto do aviso configurado; telefone válido; janela de horário (padrão seg-sex 09:00-18:00 `America/Sao_Paulo`, `VOICE_CALL_WINDOW` ou painel); "Não Perturbe" (se ligado: exige verificador, erro bloqueia); sem ligação ativa para o mesmo lead nos últimos 15 min. Falta de configuração de telefonia = 503. Tudo é auditado sem dado pessoal (`voice.call.place|refused|failed`, `voice.recording.stored|discarded`, `voice.transcript.created|read`).

### 2.2 Bases legais (proposta, **[DECISÃO JURÍDICA]**)
- **Ligação em si** (retomar contato com quem pediu informações): art. 7, V (procedimentos preliminares a pedido do titular) pode ser defensável **para quem pediu cotação**; **não** cobre ligar para carteira antiga sem pedido recente. Alternativa: legítimo interesse (art. 7, IX) com teste de balanceamento documentado (LIA).
- **Gravação**: o código registra `recording_consent = true` e `consent_basis = aviso_previo:<versão>` quando o aviso foi **entregue**, ou seja, **aviso prévio com continuidade da ligação**, não consentimento expresso (ex.: tecla para aceitar). Se o jurídico exigir consentimento expresso ou outra base, o fluxo `/announce` precisa mudar. O nome do campo (`recording_consent`) não deve ser lido como consentimento juridicamente válido.
- **Conteúdo**: conversa de venda de plano de saúde pode conter dado sensível (art. 11). Transcrição fica restrita a `manager+`, cifrada, com leitura auditada, e `contains_sensitive` é calculado. A base do art. 11 permanece **[DECISÃO JURÍDICA]** (ver doc 01, seção 4).
- **Transferência internacional**: Twilio (áudio e telefone) e STT (áudio) ficam fora do Brasil; mecanismo do art. 33 e DPA pendentes (doc 10).

### 2.3 Evidência de opt-in e de aviso
- Consentimento `atendimento` **não é mais concedido automaticamente**: só nasce quando o lead escreveu primeiro (`source = mensagem_do_lead`) ou quando quem cria o registro informa uma `optInOrigin` (`pilot.service.ts#upsertLead`, base `procedimentos_preliminares`). Lead importado sem origem fica sem consentimento e é barrado nas portas de voz e de disparo. `marketing` e `aprendizado_agente` exigem base `consentimento`, versão do texto e `source` no formato `tipo:referencia`.
- Cada ligação guarda `announcement_version`, `recording_announced_at`, `answered_at`, `consent_basis` (prova do aviso, não do consentimento).

### 2.4 Regras de telecom e plataforma (distintas da LGPD) **[DECISÃO JURÍDICA / telecom]**
- As regras da Anatel para ligações de oferta (horários, identificação do chamador, prefixo, cadastro "Não Perturbe") **não foram verificadas** e não estão implementadas além da janela padrão (escolha conservadora, não a regra).
- **Número brasileiro no Twilio exige Regulatory Bundle aprovado** (processo manual do Twilio; prazo incerto). Sem número a voz não funciona.
- `VOICE_DNC_ENABLED=true` sem verificador bloqueia tudo; com `false`, **não há consulta a nenhuma lista**.
- Pontos a validar na primeira conta de teste: se `record-from-answer-dual` com `<Number url>` captura o aviso ou começa só na ponte; comportamento de `answerOnBridge`; formato de `RecordingStatusCallback`.

### 2.5 Retenção
Gravação: `VOICE_RECORDING_RETENTION_DAYS`, **padrão 365** (vem do briefing do cliente sobre a SUSEP, **a confirmar**; não é norma verificada). Transcrição: `VOICE_TRANSCRIPT_RETENTION_DAYS`, padrão 365. A retenção diária apaga a gravação **no provedor** (falha do provedor não derruba a rotina) e o titular (anonimizar/eliminar) aciona o gancho de voz, que **falha alto** se não conseguir apagar a gravação. Ver doc 07 (atenção ao cron em `PILOT_ONLY`).

## 3. Disparos

### 3.1 O que o código faz
Disparo = campanha de template (ou texto na janela de 24 h) a um público filtrado (`stages`, `campaignIds`, `scoreMin/Max`, `optInOrigins` por prefixo; máximo 5000 por público). Portas aplicadas na montagem do público **e de novo a cada destinatário no envio** (`gates.ts`, `broadcasts.service.ts`, `broadcasts.worker.ts`), todas falham fechado:

- `opt_out`, anonimizado, marketing revogado (`can_contact`);
- telefone BR válido;
- template de **marketing** exige consentimento ativo `marketing` **com `source` preenchida**; **utilidade/texto na janela** exige consentimento ativo `atendimento` com `source`;
- no máximo **1 marketing por lead a cada 7 dias**, somando todos os disparos reais;
- texto livre só até 24 h da última mensagem do lead;
- template `APPROVED` (cache sincronizado há menos de 10 min no início real); template de marketing precisa de aviso de saída ("responda PARAR/SAIR" ou botão de resposta rápida); variável vazia pula o lead;
- janela de envio (padrão seg-sex 09-18, `America/Sao_Paulo`; **confirmar com o jurídico e a regra da Anatel**);
- interruptor `BROADCASTS_ENABLED` (padrão desligado, só `true`/`1` liga); `dry_run` por padrão; início real exige `confirm: true` e `expectedRecipients` igual ao público elegível recalculado;
- vazão: `rate_per_minute` (padrão 20, máx. 60), `daily_cap` (padrão 200, máx. 1000), teto global `BROADCASTS_GLOBAL_DAILY_CAP` (padrão 250), tudo limitado ainda pelo limite diário real do número;
- **monitor de qualidade do número** (`health-policy.ts`): vermelho, queda de qualidade, queda do limite de mensagens, número desconectado, conta em revisão ou leitura com mais de 60 min **pausam** e impedem iniciar; amarelo reduz a velocidade à metade; **retomada só manual** com `confirm`; auto-pausa se mais de 30% de falha nos últimos 20 envios; no máximo uma tentativa de envio por destinatário (nunca reenvia após queda do processo).

Auditoria (`audit_log`, sem dado pessoal): `broadcast.create|start|pause|resume|cancel|batch|autopause|template_create`.

### 3.2 O que as portas **não** garantem (importante)
- A porta de `marketing` exige consentimento ativo com `source` não vazia, mas **o código não valida a prova** (texto exato, versão válida, data). O painel (`POST /pilot/leads/:id/consents`, manager) aceita registrar `marketing` com qualquer `textVersion` e `source`. A integridade depende de **quem registra**.
- A porta de `atendimento` (utilidade e texto na janela) agora exige consentimento registrado com evidência (o lead escrever primeiro ou origem de opt-in informada). Uma importação em massa da carteira **sem** origem por contato não passa nessa porta. Continua dependendo de a origem informada ser verdadeira: o sistema valida o formato, não o documento de origem. **[DECISÃO JURÍDICA]** se a origem de cada contato da carteira (grupos A, B, C) comprova de fato o opt-in.
- Criar template com texto promocional em UTILITY é barrado na criação pelo painel (`template-rules.ts`), mas a Meta pode reclassificar; categoria errada afeta custo e qualidade.

### 3.3 Bases legais (proposta, **[DECISÃO JURÍDICA]**)
- **Marketing por WhatsApp**: consentimento (art. 7, I; art. 8), específico, destacado, comprovável (`text_version`, origem, data) e revogável (`PARAR`). É a base recomendada **e** é o que a plataforma exige (opt-in).
- **Utilidade** (confirmação/lembrete de reunião já marcada, remarcação): art. 7, V, a pedido do titular.
- **Legítimo interesse** (art. 7, IX) para relacionamento com ex-lead: possível em tese **para a LGPD**, com avaliação documentada (LIA: finalidade legítima, necessidade, balanceamento, expectativa razoável do titular, opt-out fácil). **A LIA é decisão jurídica e precisa estar escrita antes de qualquer contato.** Mesmo com LIA válida, **a regra da plataforma de WhatsApp exige opt-in** para mensagem ativa de marketing; a LIA não resolve a plataforma.
- **Dado de saúde nas variáveis**: proibido (doc 05). Variáveis só nome e dados neutros.

### 3.4 Regras de plataforma (WhatsApp/Meta; **não são LGPD**) **[confirmar na política vigente]**
- Mensagem ativa a quem não escreveu nas últimas 24 h exige **template aprovado** e **opt-in** do contato.
- A Meta mede a qualidade do número (feedback de bloqueio/denúncia/leitura). Qualidade baixa reduz o limite diário de mensagens e pode levar a bloqueio do número e até da conta (WABA). O monitor do código reage a esses sinais, mas **não os previne**: o que previne é não enviar a quem não deu opt-in.
- Custos por conversa/template variam por categoria; categoria errada pode ser reclassificada.
- O canal Baileys (não oficial) **não** é usado por disparos: a ponte de saída recusa canal não oficial.

## 4. Carteira de leads perdidos (~70 mil contatos)
Contexto: a carteira citada em `docs/whatsapp-oficial.md` é um **portfólio existente, majoritariamente de leads perdidos do corretor** (não é lista comprada). Isso muda o risco jurídico, mas **não muda a regra da plataforma**: sem opt-in não há mensagem ativa de marketing por WhatsApp.

### 4.1 Segmentação proposta
| Grupo | Definição | Pode receber marketing por WhatsApp? | Tratamento |
|---|---|---|---|
| **A: opt-in comprovado** | Contato que pediu ser contatado ou aceitou receber mensagens, com **prova** (texto/versão, origem, data, id da mensagem/anúncio/formulário), sem opt-out | **Sim**, por template aprovado, dentro das portas e dos limites, **começando por lotes pequenos** | Importar com consentimento `marketing` real (`textVersion`, `source`); é o único grupo elegível ao disparo |
| **B: relacionamento sem opt-in** | Ex-lead que o corretor atendeu ou que pediu cotação no passado, sem prova de consentimento para mensagens ativas | **Não.** Não enviar marketing por WhatsApp | Coletar opt-in por canais de consentimento (formulário/landing com texto versionado; e-mail; outros canais lícitos **[DECISÃO JURÍDICA]**) ou reativar via **anúncios click-to-WhatsApp**: é o contato que **escreve primeiro** e abre a janela de atendimento |
| **C: desconhecido ou com opt-out** | Origem desconhecida, sem histórico claro, ou que já pediu para sair/bloqueou | **Não** | Não importar para o sistema com consentimento; **opt-outs conhecidos entram numa lista de supressão** (o sistema guarda o bloqueio por `phone_hash` só para leads anonimizados com `opt_out`) |

Regras de importação: não criar consentimento `atendimento`/`marketing` por presunção; origem registrada como o que é (ex.: `carteira_perdidos`, nunca igual a uma origem com prova); como o código concede `atendimento` automático, **importar somente depois de corrigir isso ou usar `optInOrigins` para bloquear essas origens**.

### 4.2 Audiências de anúncios (click-to-WhatsApp) para o grupo B
Subir uma lista de telefones como público personalizado de anúncios é, em si, **tratamento e compartilhamento com a Meta** (transferência internacional e base legal próprias) **[DECISÃO JURÍDICA]**. Não está construído no código (Conversions API e envio de públicos inexistem). Se o jurídico aprovar, a opção é fazer o upload manual no gerenciador de anúncios, com a base e o aviso adequados, e medir o retorno por conversas iniciadas pelo lead.

### 4.3 Proibição de base fria
**Não fazer disparo em massa para os ~70 mil contatos.** Mesmo sendo carteira própria, sem opt-in comprovado por contato o envio viola a política da plataforma e arrisca (a) qualidade do número, (b) bloqueio da conta, (c) reclamações de titulares e ANPD. O código impõe o teto de 5000 por público, 1000 por dia por disparo e 250 por dia no global (padrões), mas **esses limites não substituem o opt-in**.

## 5. Risco de qualidade do número e estrutura Meta
- Um número com qualidade vermelha, limite reduzido ou bloqueado **para o atendimento** inteiro, não só para os disparos.
- **Recomendação: o corretor deve ter o próprio portfólio empresarial Meta e a própria conta WhatsApp Business (WABA) e número**, com a Horizon como parceira/usuário do sistema com permissões delegadas e não como dona. Assim, um bloqueio por disparo malfeito **não expõe o portfólio verificado da Horizon** e a corretora, que é a controladora, mantém o controle sobre a conta e os dados. Esta é uma recomendação operacional, não uma exigência verificada; confirmar com a Meta e o jurídico (papéis controlador x operador, doc 01 seção 2).
- Antes do primeiro disparo real: número de teste, templates aprovados, grupo A pequeno (ordem de dezenas), `BROADCASTS_ENABLED=true` só no momento, monitor de saúde conferido (`GET /pilot/broadcasts/number-health`), e pausa imediata ao primeiro sinal amarelo/vermelho.

## 6. Checklist antes de ligar cada função

### Disparos
- [ ] Contrato Controlador-Operador e DPA com Meta/chat revisados (doc 06, doc 10).
- [ ] Templates criados e **aprovados** na Meta; texto sem dado de saúde.
- [ ] Textos de opt-in versionados e publicados (doc 05); prova guardada fora do banco (texto/hash).
- [ ] Carteira segmentada A/B/C (seção 4); somente A elegível; importação sem consentimento presumido.
- [ ] Correção do consentimento `atendimento` automático (ou uso obrigatório de `optInOrigins`).
- [ ] LIA escrita se o jurídico aceitar legítimo interesse para algum grupo.
- [ ] Encarregado e canal de opt-out/direitos publicados; `PARAR` funcionando (ponte do chat ligada e testada; ver doc 05 sobre palavras reconhecidas).
- [ ] Webhook de status de entrega ligado (hoje não está).
- [ ] Número/portfólio/WABA do corretor (seção 5).
- [ ] Cron/worker confirmado em execução (`ScheduleModule`, ver doc 07).

### Voz
- [ ] Conta e número Twilio (Regulatory Bundle do Brasil), `VOICE_WEBHOOK_BASE_URL` pública HTTPS, `VOICE_OPERATOR_PHONE`.
- [ ] Texto do aviso de gravação **validado pelo jurídico**; decisão se "aviso prévio" basta ou se é preciso consentimento expresso.
- [ ] Prazo de retenção de gravação/transcrição confirmado com o cliente (`VOICE_RECORDING_RETENTION_DAYS`, `VOICE_TRANSCRIPT_RETENTION_DAYS`).
- [ ] Regras da Anatel e "Não Perturbe" verificadas; verificador implementado ou decisão documentada.
- [ ] DPA e art. 33 com Twilio e provedor de STT.
- [ ] Teste real das dúvidas de gravação do aviso (seção 2.4).
- [ ] Atualizar o aviso de privacidade (doc 03) e o ROPA/RIPD (docs 01 e 02) com a decisão final.
