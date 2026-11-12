# Google Agenda (agendamento pelo painel)

Estado: **código pronto, desligado** (`CALENDAR_PROVIDER` vazio) e **nunca testado contra o Google real**. Ao ligar pela primeira vez com a conta do Alberto, confira um agendamento de ponta a ponta e apague o evento de teste.

## O que faz

- Lê os horários **ocupados** da agenda (`freeBusy`) e oferece os livres, segundo as regras abaixo.
- Cria o evento na agenda ao agendar um lead pelo painel (lead → "Agendar reunião") e registra `reuniao_marcada` no funil, que por sua vez entra na fila do Pipedrive.
- Não lê título, descrição nem convidados dos eventos existentes: só "ocupado / livre".
- O evento criado leva o **primeiro nome** no título e **nome completo + telefone** na descrição (agenda do próprio Alberto, controlador dos dados). Não leva conteúdo de conversa.
- Se o registro no funil falhar depois de criar o evento, o evento é apagado (sem reunião fantasma).
- Exclusão ou anonimização do lead (LGPD) apaga da agenda os eventos criados para ele; se não conseguir, o pedido do titular fica em andamento.

## Regras (padrão e como mudar)

Padrão: segunda a sexta, 09:00 às 18:00, reuniões de 30 min, 2 h de antecedência mínima, até 14 dias à frente, fuso `America/Sao_Paulo`.

Para mudar, defina `CALENDAR_RULES` no `.env` da API com um JSON parcial:

```json
{"days":[1,2,3,4,5],"start":"09:00","end":"18:00","durationMin":45,"minNoticeMin":120,"horizonDays":14,"timezone":"America/Sao_Paulo"}
```

`days`: 0 = domingo ... 6 = sábado. Valor inválido derruba a configuração inteira para o padrão (nunca fica meio-válida). **Confirmar as regras reais com o Alberto** (almoço? dias? duração?): hoje são suposições.

## Como conectar a conta do Alberto (uma vez)

1. No [Google Cloud Console](https://console.cloud.google.com/), crie um projeto e ative a **Google Calendar API**.
2. Em "Tela de consentimento OAuth", configure o app (uso interno se ele tiver Google Workspace; senão "externo" em modo de teste, com a conta dele como usuário de teste).
3. Em "Credenciais", crie um **ID do cliente OAuth** (tipo "App da Web") e anote `client_id` e `client_secret`.
4. Gere o **refresh token** com a conta do Alberto pelo [OAuth Playground](https://developers.google.com/oauthplayground): use as credenciais próprias (engrenagem), escopos `https://www.googleapis.com/auth/calendar.events` e `https://www.googleapis.com/auth/calendar.freebusy`, autorize e troque o código por tokens. Guarde o `refresh_token`.
5. No `.env` da API (nunca no código nem no Git):

```
CALENDAR_PROVIDER=google
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REFRESH_TOKEN=...
GOOGLE_CALENDAR_ID=alberto@dominio.com   # ou primary
```

Observações:
- App externo em **modo de teste** faz o refresh token expirar em 7 dias. Para produção, publique o app ou use Workspace interno.
- O refresh token dá acesso à agenda: trate como senha. Se vazar, revogue em <https://myaccount.google.com/permissions> e gere outro.

## Operação

- Painel: **Integrações** mostra se está ligado, o que falta e os próximos horários livres.
- API: `GET /pilot/calendar/status`, `GET /pilot/calendar/slots?limit=`, `POST /pilot/calendar/book` (`{ leadId, start }`, manager ou owner).
- Duas pessoas agendando ao mesmo tempo: uma trava consultiva serializa; a segunda recebe 409 se o horário já foi.
- Agenda fora do ar: 502 "Agenda indisponível" (nunca "tudo livre"). Credencial ausente: 503.

## Pendente

- Reagendar e cancelar reunião (hoje só criar; um lead tem no máximo uma reunião marcada).
- O agente de IA marcar sozinho (hoje só pelo painel, por um humano).
- Confirmar a região de armazenamento e o DPA do Google (doc 10 da LGPD).
