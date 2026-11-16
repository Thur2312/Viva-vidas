# 05 - Textos de opt-in, opt-out e consentimento

Todos os textos são modelos para revisão jurídica. Distinguir:
- **LGPD**: consentimento livre, informado, específico, destacado e comprovável (arts. 7, I; 8; 11, I).
- **Regra de plataforma (WhatsApp Business / Meta)**: opt-in para mensagens ativas, templates aprovados, botão de saída em marketing, qualidade do número. Não é LGPD, mas descumprir derruba o número (`docs/whatsapp-oficial.md`).

## 1. Versionamento (`text_version`)
- Cada texto tem um identificador: `<ponto>-v<N>` (ex.: `ctwa-v1`, `form-v1`, `mkt-v1`, `aprendizado-v1`).
- Guardar, para cada lead e cada consentimento: `text_version`, texto exato (ou hash), data/hora, canal, identificador do anúncio/formulário e prova (id da mensagem). O banco agora tem a tabela `consents` (`purpose`, `legal_basis`, `text_version`, `source`, `granted_at`, `revoked_at`, `revoke_reason`; um consentimento ativo por lead e finalidade) além de `leads.opt_in_origin` (texto livre). **Continua faltando** guardar o **texto exato ou hash** e a prova (id da mensagem/anúncio): o registro guarda só a versão e a origem, então a tabela de versões de texto (`ctwa-v1`, `mkt-v1`...) precisa ser mantida fora do banco e imutável. Atenção: a ingestão cria automaticamente `atendimento` e `qualificacao` (base `procedimentos_preliminares`) para todo lead novo; isso **não é prova de opt-in** para marketing nem substitui o texto de consentimento.
- Mudou uma palavra relevante: nova versão. Consentimento antigo continua válido só para a finalidade do texto antigo.
- Nunca apagar versões antigas; marcar vigência.

## 2. Ponto de entrada: anúncio click-to-WhatsApp (CTWA)
Texto abaixo da chamada do anúncio ou na tela de boas-vindas do chat:

> `ctwa-v1`: Ao tocar em "Enviar mensagem", você inicia uma conversa com a **[DADO A PREENCHER: nome da corretora]** para falar sobre planos de saúde. Usaremos seu número e o que você escrever para responder, com apoio de inteligência artificial e equipe humana. Saiba mais: **[DADO A PREENCHER: URL do aviso de privacidade]**.

Observação: o clique no anúncio e o envio da primeira mensagem pelo lead caracterizam **iniciativa do titular** (base art. 7, V). Isso **não** equivale a consentimento para marketing posterior.

## 3. Ponto de entrada: formulário (lead form)
Caixa de seleção **desmarcada por padrão**:

> `form-v1` [ ] Quero receber contato da **[DADO A PREENCHER: corretora]** por WhatsApp sobre planos de saúde. Li o aviso de privacidade (**[URL]**).

Caixa separada, opcional (marketing):

> `mkt-v1` [ ] Aceito receber novidades e ofertas por WhatsApp. Posso sair quando quiser enviando PARAR.

Caixa separada, opcional (aprendizado do agente), apenas se a decisão jurídica for usar consentimento para essa finalidade:

> `aprendizado-v1` [ ] Autorizo que trechos da minha conversa, sem meu nome e telefone, sejam usados para treinar o assistente de atendimento. Posso retirar a autorização a qualquer momento.

Não condicionar o atendimento ao aceite de `mkt` ou `aprendizado` (consentimento livre).

## 4. Primeira mensagem do WhatsApp (resposta dentro da janela de 24h)
> Olá, {{nome}}! Aqui é a equipe da **[corretora]**. Para te atender melhor, parte da conversa é lida por um assistente de IA, sempre acompanhado por um corretor. Contamos só o necessário para a cotação: não precisa me contar sobre doenças ou medicamentos. Política de privacidade: **[URL]**. Para parar de receber mensagens, responda PARAR.

Nota técnica: quando o agente ainda estiver em modo sombra e a resposta for humana, o aviso de IA continua devido porque a conversa é processada por IA.

## 5. Templates de contato ativo (fora da janela de 24h)
Usar somente com opt-in registrado. Exemplo (categoria MARKETING, botões "Pode explicar" e "Parar mensagens"):
> `mkt-v1` Olá {{1}}, aqui é da **[corretora]**. Você pediu informações sobre planos de saúde e ficou uma dúvida em aberto. Quer retomar a conversa? [Sim, quero] [Parar mensagens]

Veja templates sugeridos em `docs/whatsapp-oficial.md`. **Evitar dado de saúde nas variáveis.**

## 6. Opt-out
| Item | Definição |
|---|---|
| Palavras de saída (normalizar sem acento, caixa baixa, ignorar pontuação) | `parar`, `pare`, `sair`, `cancelar`, `remover`, `nao quero`, `descadastrar`, `stop` |
| Ação do sistema | Evento `opt_out` (`POST /pilot/events`) marca `leads.opt_out = true`, revoga todos os consentimentos e audita; depois disso `can_contact` nega (painel, voz, disparos, mensagens do agente), o shadow **pula** o lead e o aprendizado é negado. **Detecção automática existe só na ponte do chat** (`horizon-chat-api`, `PilotBridge.ts`) e só se a ponte estiver ligada: reconhece **mensagem inteira** igual a `parar`, `sair`, `cancelar`, `nao quero` ou `descadastrar` (sem acento/pontuação). **[Lacuna]**: `pare`, `remover`, `stop` e frases ("pare de me mandar mensagem") **não** são reconhecidas; o botão "Parar mensagens" sugerido abaixo também **não** é (texto diferente de `parar`): usar "PARAR" ou "SAIR" como texto do botão, ou tratar manualmente. |
| Mensagem de confirmação | `Pronto, não enviaremos mais mensagens. Se mudar de ideia, é só nos chamar. Para pedir acesso ou exclusão dos seus dados: **[e-mail do encarregado]**.` |
| Prazo | Imediato; confirmar em até 24h |

## 7. Retirada separada
Quem sair de marketing pode continuar em atendimento (se pediu cotação). Ofereça: "PARAR MARKETING" e "PARAR TUDO".

## 8. Base fria
Listas compradas ou subidas sem opt-in (ex.: ~70 mil contatos) **não devem** receber contato ativo: sem base legal sólida e risco de banimento.
