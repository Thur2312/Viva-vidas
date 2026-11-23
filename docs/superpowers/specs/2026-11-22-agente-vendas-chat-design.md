# Agente de vendas no chat: qualificação e persuasão consultiva (design)

Data: 2026-11-22. Estado: rascunho para aprovação. Escopo: **cérebro de vendas + ação no chat (WhatsApp) + voz**, em 3 fases (ver Fases). Os detalhes finos abaixo (política, guarda-corpos, eval, playbook) são da **Fase 1**; Fases 2 e 3 têm desenho de alto nível aqui e ganham plano próprio.

## Intenção e porquê

O agente de hoje (`api/src/modules/pilot/shadow.service.ts`) só escreve um rascunho por mensagem do lead, numa chamada única ao Claude, sem ferramentas, sem perfil estruturado e sem como medir se melhorou. O dono do projeto quer um agente **muito bom em qualificar e persuadir, como um profissional de vendas de verdade**, no chat e depois na ligação.

O cliente (Alberto, corretor de planos de saúde) vai **preencher o playbook**: o conhecimento comercial dele (oferta, objeções, tom). Nós entregamos o **modelo** do playbook e o motor que o usa. **Nada de conteúdo comercial é inventado por nós.**

Persuasão aqui significa a de um bom consultor: entender a dor, comparar com o plano atual, tratar objeção com argumento verdadeiro e propor o próximo passo. Sem pressão artificial. Em plano de saúde isso também protege o Alberto (SUSEP, consumidor) e a LGPD.

## Estado real do código (branch `feat/agente-vendas`, base `feat/voz-agente-adaptadores`)

Verificado por leitura completa em 2026-11-22; vale mais do que qualquer afirmação anterior deste documento.

- Já existe: provedores **Anthropic e Gemini** (`pilot/shadow.service.ts`, escolha por `LLM_PROVIDER`/chaves; **os dois são mantidos**), CRM Pipedrive por fila (`crm/`), Google Agenda de **um** calendário (`calendar/`), click-to-call com operador (`voice/`), biblioteca de agente de voz em streaming **não ligada a nada** (`voice/agent/`), disparos com travas (`pilot/broadcasts/`), LGPD, painel web.
- Não existe: cérebro de vendas, qualquer envio autônomo, gatilho de ligação ao chegar o lead, agente usando agenda/CRM, playbook preenchido (nenhum endpoint o cria; hoje o agente roda **sem playbook e sem exemplos**), voz grátis.
- Falhas do cérebro atual a corrigir na Fase 1: o prompt **ignora** o perfil do lead (`ctx.lead`); `conversations.summary` nunca é gravado; `sensitive_human_only` bloqueia a conversa **para sempre** ao primeiro termo de saúde (falso positivo e trava a qualificação); `already_drafted` é SELECT+INSERT sem UNIQUE (corrida, custo dobrado); rascunho é gerado mesmo quando já há resposta humana posterior; Anthropic sem timeout/retry e nunca testada com chave real.
- O chat é **Baileys (não oficial)**; disparos e saúde do número recusam Baileys. O envio autônomo da Fase 2 deve esperar o número oficial. A Fase 1 não depende disso.
- Migrations: existem 001 a 010 (sem 005). A próxima é **011**.

**Decisão sobre dado sensível (muda o comportamento atual; autor):** em vez de bloquear a conversa inteira, a mensagem marcada como sensível **nunca vai ao provedor** (vira o marcador `[mensagem omitida: conteúdo sensível]`), o sinal `falou_saude` é definido **em código** (não pelo LLM) e a política passa **aquele turno** para um humano. Turnos seguintes sem termo sensível continuam normais. Falso negativo da lista de termos segue possível e é aceito em modo sombra. Exige validação do jurídico antes de qualquer envio autônomo.

## Objetivos

1. **Modelo de playbook estruturado**, versionado, que o Alberto preenche por tela, com checagem de completude.
2. **Perfil do lead** (plano atual, vidas, idades, cidade, valor, dor principal, quem decide, vencimento etc.) mantido por ferramenta (tool use) a cada mensagem, com a evidência (trecho/mensagem de origem).
3. **Política da próxima melhor pergunta**, em código: o que falta no perfil, na ordem do playbook, decide a pergunta. O LLM só desvia com motivo registrado (o lead fez uma pergunta, trouxe uma objeção).
4. **Redação persuasiva** pelo LLM com tom do playbook, biblioteca de objeções, exemplos reais aprovados e fatos aprovados.
5. **Guarda-corpos em código** (não só no prompt) sobre o rascunho gerado.
6. **Banco de testes (eval)** repetível: leads simulados mais conversas reais gravadas, avaliados por rubrica, para provar que cada mudança melhorou.
7. **Agir de verdade, por etapa e com trava** (Fase 2): enviar sozinho no WhatsApp (`assisted` e depois `auto`) nas etapas liberadas pela prontidão medida, com interruptor geral, pausa por conversa e retomada pelo humano.
8. **Follow-up autônomo** (Fase 2): retomar quem sumiu, confirmar, lembrar e remarcar reunião, seguindo a cadência do playbook e as travas de disparo existentes.
9. **CRM e agenda como ações** (Fase 2): atualizar etapa, qualificação e eventos (Conversions API) e marcar reunião. Entram implementados contra uma interface, ligados quando o Alberto liberar Pipedrive e Google Agenda; sem acesso, ficam em modo simulado.
10. **Agente de voz** (Fase 3): ligar e atender usando o mesmo cérebro, com STT/TTS em streaming, interrupção (barge-in), passagem para humano e aviso de assistente automatizado e de gravação. Detalhes em `docs/voice.md` §8.

## Fluxo do funil (definido pelo dono do projeto)

**A IA conduz o funil inteiro até a reunião; a reunião é feita por humano.**

```
lead chega ──► [ligar automático ligado?] ──sim──► IA liga ──► qualificação (na ligação)
      │                     │ não                      │ não atendeu / porta recusou
      │                     ▼                          ▼
      └──────────────► qualificação por WhatsApp ◄── follow-up no WhatsApp
                                  │
                                  ▼
                 marcar reunião na agenda do Alberto ou do vendedor
                                  │
                                  ▼
          confirmação e lembretes (WhatsApp/ligação) ──► REUNIÃO (humano)
```

Pontos do fluxo e como o design os trata (minhas propostas, ajustáveis):

- **Ligar automaticamente** é um interruptor (global e por campanha/origem), padrão **desligado**. Ligado, a ligação sai assim que o lead chega, **dentro da janela legal**; fora dela, fica agendada para a próxima janela e, enquanto isso, entra o WhatsApp. Todas as portas de `voice-gates.ts` valem (consentimento/base legal, janela, Não Perturbe, telefone válido).
- **Qualificação** usa o mesmo perfil e a mesma política de perguntas, seja na ligação ou no WhatsApp; o que foi coletado numa vale na outra.
- **Não atendeu ou ligação recusada pelas portas**: cai para o WhatsApp (template aprovado de abertura, dentro das regras de opt-in) e segue a cadência de retomada do playbook; pode tentar nova ligação conforme a cadência.
- **Marcar reunião**: o agente consulta a agenda (Google Agenda, disponibilidade livre/ocupada) do Alberto ou do vendedor responsável, oferece horários, cria o evento e confirma. **Como se estrutura o vendedor da reunião (cadastro, atribuição, agenda de cada um) está EM ABERTO e será definido com o dono do projeto antes da Fase 2.** O design só exige que o agendamento receba "um responsável" por uma interface (hoje: Alberto), para a regra de atribuição poder entrar depois sem refazer nada. A agenda é **núcleo do produto**, e não um "ligar depois".
- **Follow-up** (WhatsApp, e ligação quando configurado): lembretes, confirmação, remarcação, retomada de quem sumiu; tudo pela cadência do playbook e pelas travas de disparo.
- **Passagem para humano antes da reunião** continua sempre possível (pedido do lead, assunto sensível, falhas de entendimento, humano assume a conversa).
- **A reunião e o que vem depois** (proposta, fechamento) são humanos. O agente entrega o perfil do lead, o resumo e a gravação/transcrição ao vendedor antes da reunião.

## Fases

Cada fase é entregável e testável sozinha; a seguinte só começa com a anterior aprovada. Como a ligação é o primeiro contato do fluxo, a voz é **desenhada desde a Fase 1** (o cérebro é agnóstico ao canal), mas sua entrega depende de contas externas que levam dias a semanas. Por isso o funil funciona primeiro por WhatsApp e a ligação **entra no fluxo existente** como a primeira etapa assim que estiver pronta, sem refazer nada.

- **Fase 1: cérebro + sombra.** Modelo de playbook, perfil do lead, política de perguntas, guarda-corpos, eval, prontidão. Nada é enviado. (Detalhado abaixo.)
- **Fase 2: funil no chat até a reunião.** Orquestrador do funil (estados, gatilho de chegada do lead, cadência), envio autônomo por etapa, follow-up, **agenda com vendedores (disponibilidade, rodízio, criação do evento)**, ações de CRM. Depende da Fase 1 e do chat/número oficial conectados.
- **Fase 3: voz no fluxo.** Ligar automático na chegada do lead, qualificação por voz, atender, lembretes por ligação. Depende da Fase 2 (orquestrador, agenda, prontidão) e de contas externas (Twilio com Regulatory Bundle do Brasil, ElevenLabs, STT). **O pedido das contas externas deve começar já**, em paralelo à Fase 1, porque é o caminho crítico.

## Autonomia: como o envio é liberado (Fase 2)

- Níveis por conversa e por etapa: `shadow` → `assisted` (humano aprova com um clique) → `auto`. Padrão `shadow`. Subir de nível é ação do `owner`, nunca automática.
- **Critério de liberação por etapa**: mínimo de rascunhos comparados, taxa de uso (igual/editou) e zero violações de guarda-corpo no período; limiares configuráveis, o sistema recomenda e o `owner` decide.
- Ao enviar sozinho, **reaproveita as mesmas portas dos disparos** (`pilot/broadcasts/gates.ts`): `can_contact`, consentimento ativo, telefone BR válido, janela de 24h para texto livre, template aprovado fora dela, saúde do número, teto diário e frequência. Falhou qualquer porta: não envia e vira tarefa para o humano.
- **Interruptor geral** (padrão desligado) e **pausa imediata** por conversa; se o humano escrever na conversa, o agente se cala (humano assume). Toda ação do agente vai para `audit_log`, sem PII.
- No máximo uma vez: sem reenvio de mensagem em caso de falha incerta (mesma regra dos disparos).
- Follow-up usa a cadência do playbook, os templates aprovados e respeita opt-out e a regra de no máximo 1 marketing por 7 dias.

## Voz: pontos de desenho (Fase 3)

- **A ligação é telefônica (não é chamada de WhatsApp) e feita por uma API externa; o provedor ainda não foi escolhido.** O código atual tem adaptador Twilio (click-to-call com operador, nunca testado) e a interface `TelephonyAdapter`, que permite trocar de provedor. A escolha define quanto construímos: (a) telefonia pura (ex.: Twilio) mais nosso orquestrador de STT/LLM/TTS em streaming, com controle total do cérebro e mais trabalho; ou (b) plataforma de agente de voz pronta que chama nosso cérebro por ferramenta/webhook, mais rápida, com menos controle de latência, guarda-corpos e dados (LGPD, art. 33). Decidir antes da Fase 3.
- **Restrição de custo (dono do projeto): gerar a voz de forma gratuita ou a mais barata possível.** A voz (TTS) e a transcrição (STT) ficam atrás das interfaces `TtsProvider`/`SttProvider`, para trocar sem refazer. Candidatos a avaliar na Fase 3, com teste de qualidade em pt-BR e de latência antes de escolher: TTS/STT de código aberto rodando local (ex.: Piper, Kokoro, Whisper), camadas gratuitas de provedores em nuvem, e só em último caso pago (ex.: ElevenLabs, hoje o único TTS implementado). Gratuito local troca custo por infraestrutura própria e pode não atingir a latência de ~1,5 s; medir. O custo por minuto de ligação (telefonia) é separado e inevitável.
- Reaproveita `TelephonyAdapter`, `TtsProvider`, `SttProvider` e `decide()`. Falta, conforme o provedor, streaming de mídia, orquestrador de turnos e política de passagem.
- Meta de latência fala-do-lead até primeira fala do agente de ~1,0 a 1,5 s; estourou, frase curta de preenchimento ou passa ao humano. Interrupção em menos de 200 ms.
- Entrada em degraus: **sombra de voz** (o agente "ouve" ligações humanas gravadas e gera o que diria), depois **assistida** (operador acompanha e pode assumir), depois automática por etapa liberada.
- Obrigatório: aviso de que é assistente automatizado e de gravação; art. 11 LGPD; janela e Não Perturbe; passagem para humano sempre disponível. O aviso e a base legal precisam de validação jurídica do cliente antes de qualquer ligação real.
- O guarda-corpo precisa funcionar em fala (sem revisão visual): o texto é verificado antes do TTS.

## Não-objetivos

- Escrever conteúdo comercial: preços, coberturas, carências, argumentos de venda. Isso é do Alberto.
- Treinar/fine-tunar modelos.
- Operar infraestrutura nova (Railway etc.) ou fila de vários operadores de voz nesta fase.

## Anti-objetivos (seria falha mesmo que "funcione")

- O agente inventa preço, cobertura, prazo, carência ou desconto.
- Usa urgência ou escassez falsas, ou pressiona quem pediu para parar.
- Pergunta sobre doença, medicamento, gestação ou preexistência (minimização LGPD, `docs/lgpd/01-registro-operacoes-ropa.md`).
- Respostas longas, robóticas, várias perguntas numa mensagem.
- Mexer no que já funciona: pseudonimização antes do provedor, opt-out, retenção, criptografia.

## Restrições

- Mantém: pseudonimização antes de sair para a Anthropic (`redaction.ts`), `opt_out`/anonimizado não chamam o provedor, mensagens e rascunhos criptografados.
- Estrutura existente: tabelas `leads.qualification jsonb`, `playbook_versions(version, body, notes, source, active)`, `agent_drafts`, `learned_examples`, view `agent_readiness`, `conversations.mode`. O design estende, não substitui.
- Sem chave Anthropic no desenvolvimento: o provedor real **nunca foi testado**. Testes de unidade usam provedor falso; a primeira validação com chave real é um marco explícito. O eval real **consome API paga** (ver Custo).
- Modelo padrão `claude-sonnet-5-5` (`PILOT_MODEL`).
- Persistência: migrations SQL numeradas em `api/db/migrations` (última é a 007; falta a 005, ver Pendências).
- Idioma: pt-BR. WhatsApp: mensagens curtas, uma pergunta por vez (já é regra do prompt atual).

## Abordagens consideradas

- **A. Só playbook e prompt melhores, uma chamada.** Rápida e barata, mas não mensurável e a qualificação fica solta.
- **B. Qualificação estruturada com ferramentas e medição. (escolhida)** Perfil do lead por tool use, próxima pergunta por regra, redação pelo LLM, eval com leads simulados. Trabalho maior de início, mas prova melhoria e serve à voz.
- **C. Dois agentes (estrategista e redator) com revisão.** Qualidade final mais alta, 2 a 3 vezes mais custo e latência por resposta; ruim para voz. Pode entrar depois como camada de revisão só no chat, se o eval mostrar ganho.

Decisão do dono do projeto: **B**, com o playbook preenchido pelo Alberto e nós entregando só o modelo.

## O modelo de playbook (o que o Alberto preenche)

Documento estruturado por seções. Cada seção tem instrução, exemplo **claramente marcado como exemplo** (nunca ativo) e campo `obrigatório`. O sistema não ativa uma versão incompleta como "pronta" (mostra o que falta, mas permite rascunho).

1. **Oferta e público**: o que a corretora vende, para quem, proposta de valor em linguagem do cliente.
2. **Campos de qualificação** (lista ordenada; é o que gera o perfil do lead): chave, pergunta sugerida, por que perguntamos, obrigatório?, valores esperados, se é dado sensível (sensível = proibido perguntar).
3. **Critérios**: o que torna o lead *qualificado* e o que o *desqualifica* (regra sobre os campos do perfil).
4. **Objeções**: gatilho (como o lead diz), resposta recomendada, o que nunca dizer. Ex.: preço, carência, "vou pensar", "já tenho plano".
5. **Fatos aprovados** (FAQ): texto exato que o agente pode afirmar (carência, redução etc.). Tudo fora disso vira `repassar_humano`.
6. **Tom de voz**: formalidade, tamanho, uso de emoji, exemplos de frase do Alberto.
7. **Regras proibidas**: lista do que o agente nunca diz/faz (acrescenta às regras fixas do sistema).
8. **Passagem para humano**: quando repassar (pedido do lead, assunto fora do playbook, sinal sensível, 2 falhas de entendimento).
9. **Agenda e próximo passo**: tipos de reunião, duração, janelas, o que prometer.
10. **Cadência de retomada**: quantas tentativas sem resposta e o que dizer (hoje: não insistir após 2 mensagens).

Entrega: o **modelo vazio** (com instruções e exemplos rotulados), o **validador de completude** e o **editor** na tela `/agente` (hoje essa tela só mostra texto estático de referência, `web/src/lib/playbook.ts`). Escrita pelo painel só para papel `owner`.

Compatibilidade: continua existindo `playbook_versions.body` como texto renderizado a partir das seções; o dado estruturado entra numa coluna nova. Versões antigas seguem válidas.

## Como o agente decide, a cada mensagem do lead

1. Carrega: playbook ativo, perfil do lead, resumo, histórico (últimas 20), exemplos aprovados relevantes.
2. **Extração**: o LLM chama `atualizar_perfil` com campos novos mencionados pelo lead, com evidência e confiança. Valores de baixa confiança não sobrescrevem os confirmados.
3. **Política (código)**: avalia gatilhos de passagem para humano; senão, se houve objeção casada com o playbook, trata a objeção; senão, pergunta o próximo campo obrigatório que falta; se o lead está qualificado, propõe o próximo passo (`propor_horario`).
4. **Redação**: o LLM escreve a mensagem obedecendo a ação escolhida, o tom do playbook, os fatos aprovados e as regras. Uma pergunta por vez.
5. **Guarda-corpos**: checagem determinística do texto. Valores em R$, percentuais, prazos e afirmações de cobertura só passam se constarem nos fatos aprovados; sem urgência falsa; sem perguntas sobre saúde; tamanho máximo. Reprovou: regera uma vez; reprovou de novo: rascunho de `repassar_humano` com o motivo.
6. Grava o rascunho com: ação escolhida, objeção detectada, campo perguntado, motivo de passagem, versão do playbook, violações detectadas.

Saída agnóstica de canal: `decide(estado, entrada) -> {acao, texto, perfil, motivo}`. A voz reaproveita isso.

## Banco de testes (eval)

- **Leads simulados** (persona + roteiro de comportamento, interpretados por um LLM): o desconfiado, o que só quer preço, o que enrola, o que some, o que traz objeção de carência, o que já tem plano e está satisfeito, o que menciona doença sem ser perguntado (não pode virar pergunta de saúde).
- **Conversas reais gravadas** (quando o Alberto as fornecer): reexecuta a partir de cada mensagem do lead e compara com o que o humano fez.
- **Rubrica** (juiz LLM mais checagens em código): cobertura da qualificação (campos obrigatórios coletados, na ordem, sem repetir), tratamento de objeção, tom e tamanho, **zero violações de guarda-corpo**, passagem para humano no momento certo.
- Roda por script (`npm run eval`), grava resultado por versão do playbook/prompt para comparação; falha de guarda-corpo reprova a execução.
- Os leads simulados e o **playbook de teste** são fictícios e rotulados como tal; nunca vão para o banco de produção nem viram conteúdo do Alberto.
- Sem chave, o eval roda só as checagens em código contra saídas fixas (fixtures); com chave, roda a bateria completa.

## Medição de prontidão

Estender `agent_readiness` (ou view irmã) com: concordância de qualificação por campo, taxa de uso do rascunho (igual/editou) por ação, violações de guarda-corpo. Serve de critério futuro para liberar `assisted`/`auto` por etapa. A **Fase 1** não muda `conversations.mode`; quem sobe o nível é a Fase 2.

## Custo e operação

- Cada resposta passa a ter pelo menos 2 chamadas ao Claude (extração mais redação; mais uma se a guarda-corpo regerar). Tem custo por conversa: **medir e registrar tokens por rascunho**.
- O eval completo usa a API da Anthropic (custo por execução). Rodar só com autorização explícita do dono do projeto. Limite de gasto configurável.
- Nenhuma infra nova (sem Railway/novos serviços); roda no mesmo processo da API.

## Pendências e riscos conhecidos

- Provedor Anthropic nunca exercitado com chave real; primeiro teste real é marco.
- Falta a migration 005 na sequência (001 a 004, 006, 007); definir se é lacuna ou numeração pulada antes de criar a próxima (que será numerada pelo construtor depois de confirmar).
- A estrutura do banco compartilhado já tem migrations aplicadas; novas migrations devem ser aditivas e idempotentes (padrão atual).
- Playbook e exemplos não passam por redação no envio ao provedor (doc LGPD 10): o modelo deve avisar o Alberto para não colocar dado pessoal de clientes no playbook.

## Decisões do autor após a revisão (marcadas como minhas; o dono do projeto pode trocar)

1. **Quem detecta objeção, qualificação e passagem.** A chamada de extração (a mesma que atualiza o perfil) devolve também `objecao` (id de uma objeção do playbook ou `nenhuma`/`outra`) e `sinais` (`pediu_humano`, `falou_saude`, `nao_entendeu`). Sem terceira chamada. "Falha de entendimento" = contador por conversa de turnos com `nao_entendeu`; 2 seguidos disparam passagem. Os critérios de qualificado/desqualificado são **predicados JSON simples** sobre os campos do perfil (igual, maior que, presente/ausente, E/OU), avaliados em código; o editor monta isso por formulário, sem texto livre.
2. **Chamadas por mensagem.** Chamada 1 (extração, tool use `atualizar_perfil` + objeção + sinais; vê a última mensagem do lead, o perfil atual e a lista de campos, não o histórico todo). A política decide em código. Chamada 2 (redação; vê histórico, playbook, ação escolhida, exemplos e fatos). `propor_horario` e `repassar_humano` **não são ferramentas**: são ações da política, gravadas no rascunho. Prompt caching no bloco estável (playbook e regras).
3. **Guarda-corpos: mecanismo.** Camada 1 determinística (obrigatória): números monetários, percentuais, prazos e termos de cobertura/carência só passam se o valor normalizado ou a frase constar nos fatos aprovados; lista de termos de urgência falsa; termos de saúde; tamanho; mais de um "?" por mensagem. Camada 2 (LLM, **barata e só quando a camada 1 acha o texto "de risco" ou quando o texto cita cobertura/prazo/preço**, para pegar paráfrases como "cobre tudo"): um verificador pequeno devolve passa/reprova. Falso negativo residual é aceito em modo sombra, e o rascunho nunca é enviado; antes de qualquer envio automático o eval deve mostrar zero violações nas simulações. Isso é a decisão de segurança mais importante deste design: se preferir só a camada 1, é mais barato e menos seguro.
4. **Dados sensíveis e criptografia.** `leads.qualification` hoje **não** é criptografado (mensagens e rascunhos são). O perfil guarda só os campos do playbook (sem saúde). A evidência **não** guarda trecho do texto do lead, só o `id` da mensagem de origem e a confiança, que já é criptografada. Se o lead falar de saúde, o extrator é instruído a ignorar e devolve o sinal `falou_saude`; a política passa a pergunta para humano. Caso de eval obrigatório: lead que cita doença sem ser perguntado.
5. **Migrations.** Antes de criar a próxima, o construtor confere o histórico de migrations no banco e em outras branches (`git log --all -- api/db/migrations`); se 005 não existir em lugar nenhum, a nova usa 008 e o fato fica registrado no doc. Aditiva e idempotente, como as anteriores.
6. **Versionamento do playbook.** Coluna `data jsonb` (seções) e `status` (`rascunho`|`ativo`|`arquivado`) em `playbook_versions`; `active` continua sendo o ponteiro único. Editar o ativo **cria nova versão rascunho**; vários rascunhos podem coexistir; ativar exige validação de completude dos campos obrigatórios (senão 422 com a lista do que falta). "Versão do prompt" = hash do prompt no código, gravado junto do rascunho e do resultado do eval.
7. **Limites.** Gasto do eval: teto **em tokens por execução** (variável de ambiente, padrão baixo), abortando ao estourar. Tokens por rascunho em colunas novas de `agent_drafts` (`input_tokens`, `output_tokens`, `calls`).
8. **Papel `owner`.** Já existe (`panel-roles.ts`: owner, manager, viewer; `@Roles('owner')` em `PUT /voice/settings` e templates). O BFF do web precisa liberar `PUT` para o playbook; é trabalho pequeno, não um subprojeto.
9. **Concordância de qualificação.** A fonte de verdade humana é a tabela existente `qualification_reviews` (`agent_qualified` x `human_qualified`) mais a ação do humano sobre o rascunho (`igual`/`editou`/`ignorou`/`diferente`). **Sem** tela de correção de perfil campo a campo nesta entrega; "concordância por campo" fica como evolução quando houver esse canal.

## Deixado ao construtor

Formato exato do JSON das seções, nomes de tabelas/colunas novas, texto dos prompts, pesos da rubrica, layout do editor na tela `/agente`, organização dos arquivos, escolha do juiz do eval (modelo e prompt), limiares dos guarda-corpos (tamanho máximo, regex de valores), política de baixa confiança da extração.
