# 04 - Aviso e política para colaboradores da corretora

> Modelo para revisão jurídica trabalhista e de proteção de dados. A corretora (empregadora) é a controladora e deve emitir o aviso. Versão: `colab-v0.1`.

## 1. O que acontece
Os atendimentos que você faz com leads no WhatsApp da corretora passam a ser lidos por um sistema (Horizon Agente). Ele:
1. Guarda as mensagens da conversa (suas e do lead) no banco do sistema.
2. Gera, em paralelo, um **rascunho** de resposta que **nunca é enviado** na fase atual (modo sombra).
3. Compara o rascunho com o que você realmente escreveu e calcula um índice de semelhança.
4. Seleciona trechos que podem virar **exemplos** de boa conversa, retirando dados pessoais do lead. Exemplos só são usados depois de aprovados por pessoa autorizada.
5. Envia trechos da conversa a um provedor de IA no exterior para gerar os rascunhos.

## 2. Para que serve (finalidade)
- Padronizar e melhorar o atendimento.
- Medir se o agente de IA já consegue ajudar com segurança.
- Construir material de treinamento.

## 3. Para que NÃO serve
- **Não será usado para avaliar seu desempenho individual, aplicar advertência, definir bônus ou desligar**, a menos que haja acordo separado, escrito, com base jurídica e aviso específico.
- Não é monitoramento de conversas pessoais: apenas o número comercial da corretora é lido. Não use o aparelho/número comercial para assuntos pessoais.
- Os índices de semelhança são medidos por **rascunho**, não por pessoa; o sistema não guarda identificação individual do colaborador nas tabelas de comparação (verificado na migração `001_horizon_agent.sql`). **[DADO A PREENCHER: confirmar com a Horizon se a integração com o chat passa a identificar o colaborador]**

## 4. Base legal
Legítimo interesse da corretora (art. 7, IX), com teste de balanceamento documentado, e execução do contrato de trabalho quanto ao uso das ferramentas da empresa (art. 7, V). Este tratamento não depende de consentimento do colaborador, pois o consentimento do empregado é frágil pela desigualdade da relação.

## 5. Seus direitos
Acesso a como suas mensagens foram usadas, correção, informação sobre compartilhamento, oposição quando houver motivo legítimo (art. 18, §2) e revisão se alguma decisão automatizada o afetar (art. 20). Contato: **[DADO A PREENCHER: encarregado/RH]**.

## 6. Como se opor
Escreva ao encarregado informando o motivo. A corretora responderá em até 15 dias. Enquanto isso, você pode pedir que suas conversas não sejam escolhidas como exemplos de treinamento.

## 7. Regras de uso
1. Não peça nem registre dado de saúde do lead sem necessidade. Se o lead contar, não repita; avise o responsável.
2. Não passe senhas, chaves ou links do painel.
3. Respeite pedido de **PARAR** e registre como opt-out.
4. Não copie conversas para fora do sistema.
5. Avise o encarregado imediatamente em caso de suspeita de vazamento (doc 09).

## 8. Registro de ciência
| Colaborador | Data | Assinatura |
|---|---|---|
| **[DADO A PREENCHER]** | | |
