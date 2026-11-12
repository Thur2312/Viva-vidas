# 10 - Transferência internacional e suboperadores (LGPD arts. 33 a 36, 39)

Versão 0.2, verificado no código em 2026-11-12. Nada aqui é parecer jurídico nem declara conformidade.

## 1. Quadro de suboperadores

| Suboperador | Dados enviados | Local | Salvaguarda hoje | O que falta contratar/decidir |
|---|---|---|---|---|
| **Supabase** (Postgres, schema `horizon_agent`) | Todo o conteúdo do banco: leads, mensagens e rascunhos **cifrados na aplicação**, transcrições cifradas; telefone, nome, resumo e qualificação **em claro** | sa-east-1 (São Paulo) **[confirmar projeto de produção]** | RLS ligado sem políticas; acesso por conexão direta do backend; cifra de aplicação nos campos listados | DPA do Supabase; confirmar que a região é de fato Brasil e onde ficam backups e suporte |
| **Anthropic** (Claude) | Até 20 últimas mensagens, resumo, playbook, até 5 exemplos aprovados e não sensíveis, **todos pseudonimizados** (seção 2); `PILOT_MODEL` (padrão `claude-sonnet-5-5`) | EUA | Pseudonimização antes da chamada; chave em env; `tool_use` forçado; sem treino com dados via API comercial conforme termos do provedor **[confirmar no contrato vigente]**. **Provedor nunca exercitado contra a API real** (sem chave) | DPA e mecanismo do art. 33; política de retenção/ZDR **[DECISÃO JURÍDICA]** |
| **Meta Platforms** (WhatsApp Cloud API, Ads, webhooks de lead) | Mensagens, telefone, identificadores de anúncio; **hoje nenhum evento de conversão** (Conversions API não construída) | EUA/global | Verificação de assinatura de webhook (`WHATSAPP_META_WEBHOOK_SIGNATURE_DISABLED` não deve ser `true` em produção); tokens Meta cifrados com AES-256-GCM | Termos de dados do WhatsApp Business e da CAPI; avaliar controladoria conjunta. Meta é também controladora dos dados da própria conta |
| **Twilio** (telefonia e gravação de voz) | Telefone do lead e do operador, metadados da chamada, **áudio gravado** (armazenado no Twilio até a retenção), aviso de gravação em texto (`<Say>`) | EUA/global; **região de armazenamento das gravações a confirmar** | Webhooks assinados (HMAC-SHA1, comparação em tempo constante, sobre `VOICE_WEBHOOK_BASE_URL`); referência da gravação cifrada no banco; apagamento no provedor na retenção e na eliminação. **Adaptador nunca testado com Twilio real; sem credenciais configuradas** | DPA com Twilio e mecanismo do art. 33; Regulatory Bundle/número do Brasil (operacional); confirmar região e retenção do Twilio |
| **ElevenLabs** (STT Scribe e TTS) | **STT:** o áudio da gravação é baixado de forma transitória e enviado para transcrição (voz = dado pessoal, potencialmente saúde). **TTS:** chave e adaptador existem, mas **o fluxo atual de ligação não usa TTS** (o aviso é `<Say>` do Twilio) | EUA/global **[confirmar]** | Chave só em env (`ELEVENLABS_API_KEY`; `STT_API_KEY` cai para ela); transcrição cifrada no banco. **Não testado, sem chave configurada** | DPA e art. 33; confirmar se o provedor retém áudio; decidir se o STT será ElevenLabs ou provedor compatível com OpenAI |
| **Provedor de STT alternativo** (`STT_PROVIDER=openai`, `STT_BASE_URL`, padrão `https://api.openai.com/v1`, modelo `whisper-1`) | Mesmo áudio da gravação | EUA/global **[confirmar]** | Idem | DPA e art. 33 se for escolhido; `STT_PROVIDER` vazio = transcrição desativada |
| **Hospedagem da API/painel** (ex.: Vercel, servidor) | Tráfego da aplicação; logs | **[DADO A PREENCHER]** | - | DPA e local |
| **Pipedrive** (planejado) | Nome, telefone, estágio, resumo | **[DADO A PREENCHER]** | - | DPA, cláusulas, minimizar o que sincroniza (nunca saúde) |
| **Google Calendar** (planejado) | Nome, horário da reunião | EUA/global | - | DPA (Workspace) |
| **Redis, RabbitMQ** (`.env.example`) | Filas do tracking, possivelmente identificadores | **[DADO A PREENCHER]** | - | Confirmar se são terceiros |

## 2. O que o código faz antes de chamar o LLM
Leitura de `api/src/modules/pilot/shadow.service.ts` e `api/src/modules/pilot/compliance/redaction.ts`:

**Aplicado:**
- Antes da chamada, cada texto (histórico, resumo da conversa, qualificação inteira, e os campos `situation`/`lead_message`/`human_reply` dos exemplos) passa por `pseudonymize`/`pseudonymizeDeep`: nome do lead e suas partes (3+ letras) viram `[LEAD]`; telefone do lead (qualquer formatação) vira `[TELEFONE]`; e-mail vira `[EMAIL]`; cartão (com Luhn) `[CARTAO]`; CNPJ e CPF (com dígito verificador quando sem pontuação) `[CNPJ]`/`[CPF]`; RG `[RG]`; telefones em geral `[TELEFONE]`; autoapresentação ("meu nome é Fulano") `[NOME]`. O campo `lead.name` enviado é só o marcador `[LEAD]`.
- Se o lead tem `opt_out` ou `anonymized_at`, a rotina **retorna `opt_out` e não chama o provedor**.
- Exemplos: só `approved AND NOT contains_sensitive`.
- O rascunho volta com `[LEAD]` e o primeiro nome é restaurado **localmente** (não vai ao provedor).
- O erro do provedor não é repetido nos logs (pode ecoar a conversa).

**Não aplicado (lacunas honestas):**
- **Termos de saúde não são mascarados** e mensagens com `contains_sensitive = true` **continuam no histórico enviado** ao LLM (a marcação só exclui *exemplos*). Decidir: pular a mensagem, escalar ao humano, ou aceitar com base legal do art. 11 **[DECISÃO JURÍDICA]**.
- A pseudonimização é por regras: nomes de terceiros (dependentes, cônjuge), endereço, CEP, datas de nascimento e identificadores indiretos **não** são capturados.
- O playbook e os exemplos aprovados não passam por redação no envio (os exemplos foram redigidos ao serem gravados).
- Não se registra em `audit_log` cada chamada ao LLM.

## 3. Mecanismos do art. 33
Opções, a decidir pelo advogado **[DECISÃO JURÍDICA]**: cláusulas contratuais padrão da ANPD (Res. CD/ANPD nº 19/2024), país com nível adequado reconhecido, consentimento específico e destacado (frágil neste caso), outras hipóteses do art. 33. Para provedores com termos padrão (Anthropic, Meta, Twilio, ElevenLabs, Google, Pipedrive), verificar se incorporam as cláusulas-padrão da ANPD ou se é preciso aditivo. Voz (gravação e transcrição) tende a ser a transferência mais sensível por poder conter saúde e voz identificável.

## 4. Pendências de contratação
1. DPA e mecanismo de transferência com Anthropic.
2. DPA e mecanismo com Twilio (inclui gravações) e com ElevenLabs/provedor de STT **antes de ligar a voz**.
3. Confirmar termos Meta para WhatsApp Business e CAPI.
4. DPA e local da hospedagem.
5. Pipedrive e Google antes de ligar.
6. Contrato Controlador-Operador (doc 06) com lista atualizada.
7. Informar o titular no aviso de privacidade (doc 03) e, em voz, no aviso de gravação (doc 12).
