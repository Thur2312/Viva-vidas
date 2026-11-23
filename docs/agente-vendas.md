# Agente de vendas (Fase 1: cérebro em modo sombra + playbook)

Design de origem: `docs/superpowers/specs/2026-11-22-agente-vendas-chat-design.md`. Este documento descreve o que o código faz hoje.

## Estado (leia primeiro)

**Existe:** o cérebro de vendas (`api/src/modules/pilot/brain/`) rodando em **modo sombra**. Ele gera um rascunho por mensagem do lead e o grava em `agent_drafts`. **Nada é enviado ao lead** e `conversations.mode` não é alterado. Um humano continua respondendo; o sistema compara a resposta humana com o rascunho. Também existem o editor de playbook em `/agente` no painel e o `npm run eval`.

**NÃO foi testado:**

- Nunca rodou contra uma chave real da Anthropic ou do Gemini (só contra um LLM scriptado nos testes).
- O SQL novo nunca rodou contra um Postgres real: migration 011, o `UPDATE` jsonb do perfil, a consulta da sequência de `nao_entendeu`, o `ON CONFLICT` do rascunho e a transação de ativação do playbook.
- O editor foi conferido visualmente só em modo demonstração, com Chrome headless.
- `npm run eval -- --live` nunca foi executado.

**Fora desta entrega:** Fase 2 (envio autônomo, follow-up, agenda, CRM) e Fase 3 (voz). O chat hoje é Baileys (não oficial); a parte autônoma deve esperar o número oficial (ver `docs/whatsapp-oficial.md`).

## Fluxo do cérebro por mensagem

`SalesBrain.decide` (`brain/brain.ts`) roda a cada mensagem do lead:

| # | Etapa | O que faz | Chamada ao LLM |
|---|---|---|---|
| 1 | Extração | Lê a última mensagem e devolve valores dos campos do playbook, objeção, pergunta sobre fato, pedido de humano e "não entendi". Só chaves declaradas e não sensíveis; valor curto (texto até 80 caracteres, número ou booleano); confiança abaixo de `BRAIN_MIN_CONFIDENCE` é ignorada. Pulada se a mensagem é sensível ou não há playbook completo | 1 |
| 2 | Política | `decideAction` (`brain/policy.ts`): código puro, sem LLM. Escolhe a ação: `perguntar_campo`, `tratar_objecao`, `responder_duvida`, `propor_horario`, `repassar_humano` ou `aguardar` | 0 |
| 3 | Redação | Escreve o texto da ação escolhida, com playbook, perfil e até 5 exemplos de respostas humanas aprovadas | 1 |
| 4 | Guarda-corpos | `checkDraft` (`brain/guardrails.ts`): regras em código sobre o texto | 0 |
| 5 | Verificador | Segundo LLM revisa o rascunho, só se o texto é "arriscado" (cita valor, percentual, prazo ou cobertura) e passou na etapa 4 | 0 ou 1 |
| 6 | Regeneração | Se houver violação ou o verificador reprovar, regenera **uma única vez** (compartilhada entre as etapas 4 e 5), repetindo 4 e 5 | +1 (+1 se houver verificação) |
| 7 | Passagem | Se a segunda tentativa também falha: `repassar_humano` com motivo `guardacorpo` | - |

Chamadas por mensagem: tipicamente **2** (extração + redação); no máximo **5** (extração, redação, verificador, redação de novo, verificador de novo). Passagens decididas pela política custam 0 ou 1.

Ação `aguardar`: sem rascunho. Ocorre se a conversa não termina numa mensagem do lead ou se o lead é desqualificado pelos critérios.

### Motivos de passagem (`HandoffReason`)

| Motivo | Significa |
|---|---|
| `playbook_incompleto` | Não há playbook ativo e completo. O agente só produz um rascunho de passagem |
| `pediu_humano` | O lead pediu para falar com uma pessoa |
| `saude` | A última mensagem do lead foi marcada como sensível (dado de saúde); nenhum LLM é chamado |
| `nao_entendeu` | Duas mensagens seguidas que o agente não entendeu (a atual mais a sequência gravada nos rascunhos anteriores) |
| `sem_base` | Objeção ou pergunta sem correspondência no playbook (objeção ou fato desconhecido) |
| `guardacorpo` | Guarda-corpos ou verificador reprovaram também a regeneração |

## Playbook

São **10 seções** (nomes como aparecem no editor, chave entre parênteses): Oferta (`oferta`), Campos de qualificação (`campos`), Critérios (`criterios`), Objeções (`objecoes`), Fatos aprovados (`fatos`), Tom de voz (`tom`), Regras proibidas (`regrasProibidas`, opcional), Passagem para uma pessoa (`passagemHumano`), Agenda (`agenda`), Cadência (`cadencia`).

### Como o dono preenche e ativa (`/agente`)

1. Abrir a página `/agente`, criar uma nova versão (rascunho) e preencher as seções. O editor mostra as pendências ao vivo.
2. **Salvar**: grava o rascunho (`PUT /pilot/playbook/:version`). O agente continua usando o playbook ativo.
3. **Ativar** (`POST /pilot/playbook/:version/activate`): o servidor revalida e só ativa se estiver **completo**. A versão ativa anterior vira `arquivado`.
4. Só rascunho pode ser editado ou ativado. Para mudar o playbook ativo, cria-se uma nova versão a partir dele.

Só o papel `owner` cria, edita e ativa (checado no servidor); `viewer` apenas lê. Estados da versão: `rascunho`, `ativo`, `arquivado`.

Completude (`brain/playbook.validate.ts`), em resumo: oferta (descrição e público); ao menos um campo, com ao menos um obrigatório e não sensível; critério "qualificado" definido, usando só campos existentes; ao menos uma objeção com gatilho e resposta; ao menos um fato; formalidade do tom; ao menos uma regra de passagem; tipos e duração de reunião; número de tentativas. Campo sensível nunca pode ser obrigatório e o agente não pergunta por ele.

**Sem playbook ativo e completo** o cérebro não chama o LLM de redação: o rascunho é só o texto de passagem, com motivo `playbook_incompleto`.

### Convenções que o dono deve seguir

- **Preços e prazos em formato reconhecível, na seção Fatos.** Escreva "R$ 350 por mês" e "30 dias". O guarda-corpo só deixa o agente dizer números que estejam nos fatos aprovados, e reconhece apenas formatos de dinheiro, percentual e prazo. Um preço escrito de outro jeito (por exemplo só "trezentos e cinquenta") não aprova o número, e o agente será barrado se o citar.
- **Não colocar dado pessoal de clientes no playbook.** O texto do playbook vai ao provedor de LLM **sem redação** (ver `docs/lgpd/10-transferencia-internacional-e-subprocessadores.md`).
- Valores de perfil em texto livre também entram nos prompts; não use campos para guardar texto longo do lead.

## Guarda-corpos (camada 1, em código)

`checkDraft` devolve as violações abaixo. Qualquer uma força regeneração (e, na segunda vez, passagem `guardacorpo`):

| Violação | Pega |
|---|---|
| `valor_nao_aprovado` | valor em reais que não consta nos fatos |
| `percentual_nao_aprovado` | percentual fora dos fatos |
| `prazo_nao_aprovado` | prazo (dias, horas, meses...) fora dos fatos |
| `cobertura_nao_aprovada` | frases como "cobre tudo", "sem carência", "cobertura total" que não estão nos fatos |
| `urgencia_falsa` | "última chance", "só hoje", "não perca" e parecidos |
| `pergunta_saude` | pergunta sobre doença, remédio, gestação, cirurgia e termos parecidos |
| `varias_perguntas` | mais de um `?` |
| `tamanho` | mais de 600 caracteres |

Camada 2: o **verificador LLM** revisa o texto arriscado (valor, percentual, prazo, cobertura).

**Limites honestos:**

- Paráfrases passam ("sem nenhuma espera" em vez de "sem carência").
- Pergunta de saúde indireta, sem `?` e sem verbo interrogativo ("me diga se há doença"), não é pega pela camada 1; fica para o verificador, que só roda em texto arriscado e pode não rodar.
- Frases de agendamento como "às 15h" casam com o padrão de prazo (`15h`) e podem dar falso positivo se o horário não estiver nos fatos.
- A lista `nuncaDizer` das objeções só é aplicada por prompt e verificador, não por regra em código.

## Dado sensível (LGPD art. 11)

- A mensagem marcada como sensível (`messages.contains_sensitive`, lista de termos de saúde) é trocada por `[mensagem omitida: conteúdo sensível]` **antes de qualquer chamada ao LLM**.
- Se a **última** mensagem do lead é sensível, o turno é repassado a um humano (`saude`) **sem chamar o LLM**.
- **Mudou:** a conversa **não** fica mais bloqueada para sempre (antes havia o `sensitive_human_only` permanente). O tratamento é por turno: depois de uma mensagem não sensível, o agente volta a gerar rascunho, vendo o placeholder no lugar da mensagem sensível.
- A lista de termos pode ter falso negativo: mensagem de saúde não marcada segue para o provedor.
- O perfil guarda só valores curtos e estruturados, com `msgId` como evidência, nunca o texto da conversa. `leads.qualification` (onde fica o perfil) **não é cifrado**.
- **Esta regra precisa de validação do jurídico do cliente antes de qualquer envio autônomo.**

## Operação e deploy

### Migration 011 (`api/db/migrations/011_sales_brain.sql`)

**Aplique antes de, ou junto com, o deploy desta branch.** Sem ela quebram: a execução do modo sombra (colunas novas de `agent_drafts` e `ON CONFLICT (trigger_message_id)`), os endpoints do playbook (`status`, `data`), e a lista de conversas do painel (selo de rascunho). A ingestão de mensagens e a prontidão foram desenhadas para continuar funcionando; a visão `byAction` da prontidão também precisa da 011.

Antes de aplicar:

- Conte rascunhos duplicados por mensagem gatilho. A 011 **apaga** duplicados de `agent_drafts` por `trigger_message_id`, mantendo o de menor `id`, antes de criar o índice único.
- Valide o SQL primeiro em staging. Ele é aditivo e idempotente, mas nunca rodou contra Postgres real.

### Variáveis (`api/.env.example`; só nomes, sem valores)

| Variável | Padrão | Uso |
|---|---|---|
| `LLM_PROVIDER` | `gemini` se houver chave do Gemini | `gemini` ou `anthropic`; sem chave do provedor escolhido o LLM fica desativado |
| `PILOT_MODEL` | `gemini-2.5-flash` / `claude-sonnet-5-5` conforme o provedor | Modelo |
| `GEMINI_API_KEY` | - | Chave do Gemini |
| `ANTHROPIC_API_KEY` | - | Chave da Anthropic |
| `ANTHROPIC_BASE_URL` | URL oficial da Anthropic | Só https, ou http em loopback; qualquer outro valor é **ignorado em silêncio** e volta à URL oficial |
| `LLM_TIMEOUT_MS` | `20000` | Timeout por chamada; 1 retry em 429/5xx |
| `BRAIN_MIN_CONFIDENCE` | `0.6` | Confiança mínima para gravar um valor no perfil |
| `EVAL_MAX_TOKENS` | `200000` | Teto de tokens do `eval --live` |

### Custo

Pelo menos 2 chamadas de LLM por mensagem do lead, até 5. Cada rascunho grava `input_tokens`, `output_tokens` e `calls` em `agent_drafts`. Lacuna conhecida: os tokens de "thinking" do Gemini não entram em `output_tokens`. Nenhuma infraestrutura nova (nenhum serviço Railway ou outro).

## Eval

```
cd api
npm run eval              # offline
npm run eval -- --live    # modelo real
```

- **Offline:** grátis, determinístico, sem chave nem rede. Roda o cérebro real com um LLM scriptado sobre os cenários de `brain/eval/scenarios.ts`. Saída 0 se todos passam, 1 se algum falha. É regressão da lógica do pipeline: passar **não** mede a qualidade do modelo.
- **`--live`:** chama o provedor real e **CUSTA DINHEIRO**. Exige chave. Para ao passar de `EVAL_MAX_TOKENS` tokens. Saídas: 2 sem chave, 3 quando o teto estoura, 1 se algum cenário falha, 0 se tudo passa. Grava `api/eval-results/` (ignorado pelo git; só índices, ações, motivos e contagens, sem texto de lead). Não rodar em CI.

## Pendências conhecidas

- A comparação da resposta humana usa o rascunho não vazio mais recente ainda não comparado; pode parear com uma mensagem mais antiga do lead.
- O resultado `ignorou` nunca é atribuído.
- `POST /pilot/shadow/run` não confere o tenant.
- A visão `byAction` da prontidão depende da migration 011.
- `ANTHROPIC_BASE_URL` inválida cai silenciosamente na URL oficial.
- O resumo da conversa nunca é escrito (vai como `null` de propósito).
- `nuncaDizer` das objeções só vale por prompt e verificador.
- O motivo do verificador (truncado) entra no prompt da regeneração.
- Valores de perfil em texto livre são renderizados nos prompts.
- Falta a tela de configuração do aviso de gravação da voz (Fase 3, fora desta entrega).
