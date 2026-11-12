// Conteúdo de REFERÊNCIA do playbook do piloto (texto estático do projeto, ainda não sincronizado com o agente).
export const playbookRef = {
  ajustes: [
    "Perguntar o valor atual do plano antes de falar em redução.",
    "Responder dúvidas de carência com texto aprovado e repassar ao Alberto.",
    "Não insistir após duas mensagens sem resposta.",
  ],
  ferramentas: [
    { nome: "WhatsApp (API oficial)", detalhe: "Aguardando número para liberar a API" },
    { nome: "Pipedrive", detalhe: "Aguardando token do Alberto" },
    { nome: "Google Agenda", detalhe: "Aguardando autorização da conta" },
    { nome: "Meta Ads", detalhe: "Aguardando acesso à conta de anúncios" },
  ],
  templates: [
    { nome: "confirmacao_reuniao", categoria: "Utilidade" },
    { nome: "lembrete_reuniao", categoria: "Utilidade" },
    { nome: "remarcar_reuniao", categoria: "Utilidade" },
    { nome: "retomada_contato", categoria: "Marketing" },
    { nome: "abertura_contato_optin", categoria: "Marketing" },
  ],
};
