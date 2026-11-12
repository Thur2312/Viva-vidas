# WhatsApp Cloud API oficial — preparação e templates

## O que depende do cliente/Meta (começar hoje)
1. Meta Business Suite do Alberto (ou da Horizon): criar/confirmar o portfólio empresarial.
2. Iniciar a **verificação da empresa** (CNPJ, documentos). Demora dias; não bloqueia criar a conta, mas libera limites maiores.
3. Criar o app (tipo Business) e a WhatsApp Business Account (WABA).
4. Registrar um número dedicado (não pode estar ativo no app comum, salvo coexistência).
5. Gerar token permanente (usuário do sistema) e configurar o webhook com o `verify token`.
6. Aprovar o **nome de exibição**.

## Templates sugeridos (pt_BR) — submeter assim que a WABA existir
Evitar: promessa de desconto garantido, dado de saúde, urgência agressiva, links encurtados, variável no início/fim do texto.

| name | categoria | corpo | variáveis |
|---|---|---|---|
| `confirmacao_reuniao` | UTILITY | Olá {{1}}, sua reunião com {{2}} está confirmada para {{3}} às {{4}}. Responda *REMARCAR* se precisar de outro horário. | nome, consultor, data, hora |
| `lembrete_reuniao` | UTILITY | Olá {{1}}, lembrando da nossa conversa amanhã às {{2}}. Posso confirmar sua presença? | nome, hora |
| `remarcar_reuniao` | UTILITY | Olá {{1}}, vamos remarcar sua reunião? Me diga o melhor dia e horário e eu ajusto na agenda. | nome |
| `retomada_contato` | MARKETING | Olá {{1}}, aqui é da equipe de {{2}}. Você pediu informações sobre planos de saúde e ficou uma dúvida em aberto. Quer retomar a conversa? Botões: Sim, quero / Agora não | nome, corretora |
| `abertura_contato_optin` | MARKETING | Olá {{1}}, tudo bem? Vi que você demonstrou interesse em revisar o seu plano de saúde. Posso te explicar em poucos minutos como funciona a análise, sem compromisso? Botões: Pode explicar / Agora não | nome |

Todo template de marketing precisa de botão de saída ("Agora não" / "Parar mensagens").

## Regra que muda o piloto
A política do WhatsApp exige **opt-in** do contato para mensagens ativas. Disparar para base fria comprada/subida (a base de ~70 mil contatos citada na call) pode derrubar a qualidade do número e levar a bloqueio. O piloto deve usar contatos com consentimento (leads de anúncio, formulário, indicação) e registrar a origem do opt-in.

## Janela de atendimento
- Resposta do lead abre janela de 24h: mensagens livres.
- Fora dela: só template aprovado.
- Cobrança é por mensagem de template, por categoria (confirmar valores atuais no painel da Meta).

## Código
- `horizon-chat-api/src/services/WhatsAppOfficial/TemplateOfficialService.ts`: criar, listar, apagar e enviar template via Graph API.
- Falta: rotas HTTP, tela no painel, webhook `message_template_status_update` e subir `WHATSAPP_GRAPH_VERSION` (padrão atual `v20.0`).
