# 06 - Contrato de Tratamento de Dados Pessoais (Controlador-Operador) - MODELO

> **MODELO que exige revisão de advogado antes de qualquer assinatura. [DECISÃO JURÍDICA]** Complementa o contrato principal de prestação de serviços (proposta HZ-2026-0003). Base: LGPD arts. 5, VI-VII, 33, 37, 39, 42 a 48.

**Partes**
- **CONTROLADORA:** **[DADO A PREENCHER: razão social da corretora, CNPJ, endereço, representante, SUSEP]**
- **OPERADORA:** **[DADO A PREENCHER: razão social da Horizon, CNPJ, endereço, representante]**

## 1. Objeto e duração
1.1 A Operadora trata dados pessoais por conta da Controladora para fornecer o Horizon Agente: ingestão e armazenamento de conversas de WhatsApp, funil de vendas, painel, atribuição de anúncios e rascunhos de resposta por IA em modo sombra.
1.2 Vigência igual à do contrato principal, mais o prazo da cláusula 12.

## 2. Descrição do tratamento (Anexo I)
| Item | Conteúdo |
|---|---|
| Natureza | Coleta, armazenamento, classificação, consulta, envio a suboperadores, eliminação |
| Finalidade | Atendimento comercial, qualificação, medição de funil e de anúncios, treinamento do agente conforme cláusula 4 |
| Categorias de dados | Identificação e contato; conteúdo de mensagens; origem de anúncio; dados de qualificação; eventualmente dados sensíveis de saúde citados espontaneamente pelo titular |
| Titulares | Leads e seus dependentes citados; colaboradores da Controladora; usuários do painel |
| Local | Brasil (Supabase sa-east-1) e provedores do item 8 |

## 3. Instruções da Controladora
3.1 A Operadora tratará dados **somente** conforme instruções documentadas da Controladora (este contrato, o contrato principal e solicitações por escrito).
3.2 Se considerar uma instrução ilegal, a Operadora avisará imediatamente e poderá suspender sua execução.
3.3 Papéis: a Controladora define as finalidades e quais leads entram; a Operadora não tratará dados para finalidade própria. **[DECISÃO JURÍDICA]** definir expressamente o tratamento da Conversions API e da Meta, se a Horizon administrar os anúncios (possível controladoria conjunta).

## 4. Aprendizado do agente
4.1 Exemplos e playbook derivados dos dados da Controladora são **isolados por cliente** e não serão usados para treinar modelos nem outros clientes da Operadora.
4.2 Exemplos só entram em uso após aprovação da Controladora e remoção de dados pessoais.
4.3 **Dados sensíveis de saúde**: a Operadora aplicará as regras de minimização do doc 01 (§4.5); o uso de dado de saúde para qualquer finalidade depende de base do art. 11 definida pela Controladora.

## 5. Confidencialidade
Pessoal da Operadora com acesso: compromisso escrito de sigilo, acesso por necessidade (menor privilégio), sem cópia fora do ambiente do projeto. Subsiste após o fim do contrato.

## 6. Segurança (art. 46)
A Operadora manterá as medidas do doc 11, no mínimo: controle de acesso com autenticação, segregação por RLS, comunicação cifrada, segredos fora do código, registro de auditoria, rotação de credenciais e backups. Mudanças que reduzam o nível de segurança exigem aviso prévio.

## 7. Assistência à Controladora
7.1 **Titulares (art. 18):** a Operadora encaminhará em até **[DADO A PREENCHER: sugestão 2 dias úteis]** qualquer pedido recebido e fornecerá meios técnicos (doc 08) para atendê-lo em até 15 dias.
7.2 **RIPD e ROPA:** fornecer informações técnicas.
7.3 **ANPD:** cooperar em fiscalizações.

## 8. Suboperadores (Anexo II)
A Controladora autoriza, de forma geral, os suboperadores abaixo; a Operadora avisará mudanças com **[DADO A PREENCHER: sugestão 30 dias]** de antecedência, podendo a Controladora se opor com motivo.

| Suboperador | Função | Local | Status |
|---|---|---|---|
| Supabase | Banco de dados Postgres (schema `horizon_agent`) | sa-east-1 (Brasil) **[confirmar projeto de produção]** | Em uso |
| Anthropic | Modelo de linguagem (rascunhos) | EUA | Em uso (condicionado à chave) |
| Meta Platforms (WhatsApp Cloud API, Ads) | Canal e anúncios | EUA/global | Em uso/planejado |
| Twilio | Telefonia e gravação de ligações (voz) | EUA/global **[confirmar região da gravação]** | Implementado, sem credenciais e não testado; só entra em uso se a Controladora ativar voz |
| ElevenLabs ou provedor de STT compatível | Transcrição de gravações (e, no futuro, voz sintética) | EUA/global **[confirmar]** | Implementado, sem chave e não testado; só entra em uso se a Controladora ativar transcrição |
| Provedor de hospedagem da API e do painel (ex.: Vercel, servidor próprio) | Execução | **[DADO A PREENCHER]** | A definir |
| Pipedrive | CRM | **[DADO A PREENCHER]** | Planejado |
| Google (Calendar) | Agenda | EUA/global | Planejado |
| Redis, RabbitMQ (se em nuvem de terceiros) | Filas/cache | **[DADO A PREENCHER]** | A confirmar |

A Operadora firmará com cada um contrato com obrigações equivalentes.

## 9. Transferência internacional (art. 33)
9.1 A Controladora autoriza as transferências do item 8 desde que fundadas em mecanismo do art. 33 (ex.: cláusulas-padrão aprovadas pela ANPD, Res. CD/ANPD nº 19/2024) ou outro mecanismo aceito. **[DECISÃO JURÍDICA]**
9.2 A Operadora manterá cópia das cláusulas e informará a Controladora sobre o mecanismo usado por cada suboperador.

## 10. Incidentes (art. 48)
10.1 A Operadora comunicará a Controladora **sem demora injustificada e em até [DADO A PREENCHER: sugestão 24 horas]** após ter ciência de incidente que possa acarretar risco ou dano relevante.
10.2 Conteúdo: natureza, dados e titulares afetados (estimativa), medidas, riscos, contato. Plano em doc 09.
10.3 A decisão de comunicar ANPD e titulares é da Controladora; o prazo regulatório (3 dias úteis, Res. CD/ANPD nº 15/2024) **[DECISÃO JURÍDICA: confirmar]** corre desde a ciência da Controladora, por isso o prazo acima é curto.

## 11. Auditoria
A Controladora pode, com aviso de **[DADO A PREENCHER: sugestão 15 dias]**, solicitar evidências (relatórios, logs de acesso, certificados dos suboperadores) ou auditar, no máximo uma vez por ano, salvo incidente. Custos conforme contrato principal.

## 12. Devolução e eliminação
No fim do contrato, em até **[DADO A PREENCHER: sugestão 30 dias]**, a Operadora entrega exportação estruturada (CSV/JSON) e elimina os dados, inclusive nos suboperadores, salvo obrigação legal de guarda. Backups expiram em até **[DADO A PREENCHER: sugestão 35 dias]**. Emite declaração de eliminação.

## 13. Responsabilidade
Art. 42: o operador responde solidariamente quando descumprir a legislação ou as instruções lícitas do controlador. Limitação ou divisão de responsabilidade, seguro e indenização: **[DECISÃO JURÍDICA]**.

## 14. Disposições gerais
Foro e lei: **[DADO A PREENCHER]**. Alterações por escrito. Prevalece este contrato sobre o principal em matéria de dados pessoais.

| | Controladora | Operadora |
|---|---|---|
| Nome / cargo | **[DADO A PREENCHER]** | **[DADO A PREENCHER]** |
| Data / local | | |
| Assinatura | | |
