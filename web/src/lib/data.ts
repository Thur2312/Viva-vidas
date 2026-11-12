// Dados de DEMONSTRAÇÃO para o piloto do Alberto Apolinário (proposta HZ-2026-0003).
// SÓ é usado com NEXT_PUBLIC_DEMO=true (padrão: desligado). Em produção o painel lê do backend via BFF.


export { DEMO } from "./flags";

export const cliente = {
  nome: "Alberto Apolinário",
  empresa: "Corretora de planos de saúde",
  piloto: "Piloto de 20 dias",
  diaAtual: 9,
  diasTotal: 20,
};

export type Etapa = "novo" | "respondeu" | "qualificado" | "reuniao" | "compareceu" | "venda";

export const etapas: { id: Etapa; nome: string; dica: string }[] = [
  { id: "novo", nome: "Contatado", dica: "Recebeu a primeira mensagem" },
  { id: "respondeu", nome: "Respondeu", dica: "Entrou em conversa com o agente" },
  { id: "qualificado", nome: "Qualificado", dica: "Tem perfil para redução do plano" },
  { id: "reuniao", nome: "Reunião marcada", dica: "Agendado na agenda do Alberto" },
  { id: "compareceu", nome: "Compareceu", dica: "Participou da reunião" },
  { id: "venda", nome: "Venda", dica: "Fechou pelo agente" },
];

export const funil: Record<Etapa, number> = {
  novo: 420,
  respondeu: 168,
  qualificado: 61,
  reuniao: 24,
  compareceu: 15,
  venda: 4,
};

export const serie14d = [
  { dia: "28/10", contatos: 22, qualificados: 2 },
  { dia: "29/10", contatos: 31, qualificados: 3 },
  { dia: "30/10", contatos: 28, qualificados: 4 },
  { dia: "31/10", contatos: 12, qualificados: 1 },
  { dia: "01/11", contatos: 8, qualificados: 1 },
  { dia: "02/11", contatos: 35, qualificados: 5 },
  { dia: "03/11", contatos: 38, qualificados: 6 },
  { dia: "04/11", contatos: 41, qualificados: 5 },
  { dia: "05/11", contatos: 36, qualificados: 7 },
  { dia: "06/11", contatos: 39, qualificados: 6 },
  { dia: "07/11", contatos: 29, qualificados: 5 },
  { dia: "08/11", contatos: 14, qualificados: 3 },
  { dia: "09/11", contatos: 43, qualificados: 8 },
  { dia: "10/11", contatos: 44, qualificados: 5 },
];

export type Lead = {
  id: string;
  nome: string;
  telefone: string;
  etapa: Etapa;
  score: number;
  origem: string;
  resumo: string;
  ultima: string;
};

export const leads: Lead[] = [
  { id: "1", nome: "Marcos T.", telefone: "(83) 9•••• 4412", etapa: "venda", score: 94, origem: "CTWA | Redução de plano PME", resumo: "Empresa com 12 vidas, plano subiu 28%. Fechou proposta.", ultima: "há 2 h" },
  { id: "2", nome: "Patrícia L.", telefone: "(83) 9•••• 1087", etapa: "compareceu", score: 88, origem: "CTWA | Redução de plano PME", resumo: "Compareceu à reunião, aguardando documentos.", ultima: "há 5 h" },
  { id: "3", nome: "Júlio R.", telefone: "(81) 9•••• 7731", etapa: "reuniao", score: 82, origem: "Formulário | Plano nacional", resumo: "Reunião amanhã às 10h. Quer comparar 3 operadoras.", ultima: "há 1 h" },
  { id: "4", nome: "Ana C.", telefone: "(83) 9•••• 5520", etapa: "reuniao", score: 79, origem: "CTWA | Adesão profissionais", resumo: "Advogada autônoma, plano por adesão. Reunião quinta 15h.", ultima: "há 3 h" },
  { id: "5", nome: "Roberto F.", telefone: "(83) 9•••• 9014", etapa: "qualificado", score: 71, origem: "CTWA | Redução de plano PME", resumo: "Pediu horário para a semana que vem.", ultima: "há 40 min" },
  { id: "6", nome: "Débora M.", telefone: "(84) 9•••• 3308", etapa: "qualificado", score: 66, origem: "CTWA | Adesão profissionais", resumo: "Mensalidade atual R$ 1.900, família de 4.", ultima: "há 1 h" },
  { id: "7", nome: "Felipe A.", telefone: "(83) 9•••• 2275", etapa: "respondeu", score: 48, origem: "CTWA | Redução de plano PME", resumo: "Perguntou valores, ainda sem dados do plano atual.", ultima: "há 20 min" },
  { id: "8", nome: "Cláudia S.", telefone: "(81) 9•••• 6641", etapa: "respondeu", score: 41, origem: "Formulário | Plano nacional", resumo: "Respondeu apenas ao primeiro contato.", ultima: "há 2 h" },
  { id: "9", nome: "Henrique P.", telefone: "(83) 9•••• 8809", etapa: "novo", score: 20, origem: "CTWA | Adesão profissionais", resumo: "Aguardando resposta.", ultima: "há 8 min" },
  { id: "10", nome: "Isabel V.", telefone: "(83) 9•••• 1930", etapa: "novo", score: 18, origem: "CTWA | Redução de plano PME", resumo: "Aguardando resposta.", ultima: "há 14 min" },
];

export type Campanha = {
  nome: string;
  tipo: "Click-to-WhatsApp" | "Formulário";
  investido: number;
  leads: number;
  qualificados: number;
  reunioes: number;
  vendas: number;
  receita: number;
};

export const campanhas: Campanha[] = [
  { nome: "CTWA | Redução de plano PME", tipo: "Click-to-WhatsApp", investido: 1480, leads: 214, qualificados: 38, reunioes: 15, vendas: 3, receita: 7400 },
  { nome: "CTWA | Adesão profissionais", tipo: "Click-to-WhatsApp", investido: 960, leads: 133, qualificados: 17, reunioes: 6, vendas: 1, receita: 2100 },
  { nome: "Formulário | Plano nacional", tipo: "Formulário", investido: 720, leads: 73, qualificados: 6, reunioes: 3, vendas: 0, receita: 0 },
];

export const atividade = [
  { hora: "10:42", texto: "Qualificou Roberto F. (score 71) e propôs horários", tipo: "ok" },
  { hora: "10:31", texto: "Reunião confirmada com Júlio R. para amanhã às 10h", tipo: "ok" },
  { hora: "10:12", texto: "Repassou Patrícia L. ao Alberto: pediu proposta com valores", tipo: "humano" },
  { hora: "09:58", texto: "Lead Henrique P. sem resposta, follow-up agendado para 14h", tipo: "info" },
  { hora: "09:40", texto: "Atualizou 6 negócios no Pipedrive", tipo: "info" },
  { hora: "09:15", texto: "Dúvida sobre carência fora do roteiro, marcada para revisão", tipo: "alerta" },
] as const;

export const playbook = {
  versao: "v3",
  atualizado: "08/11/2026",
  estado: "Piloto em andamento",
  ferramentas: [
    { nome: "WhatsApp (API oficial)", estado: "pendente", detalhe: "Aguardando número para liberar a API" },
    { nome: "Pipedrive", estado: "pendente", detalhe: "Aguardando token do Alberto" },
    { nome: "Google Agenda", estado: "pendente", detalhe: "Aguardando autorização da conta" },
    { nome: "Meta Ads", estado: "pendente", detalhe: "Aguardando acesso à conta de anúncios" },
  ],
  templates: [
    { nome: "confirmacao_reuniao", categoria: "Utilidade", estado: "Rascunho" },
    { nome: "lembrete_reuniao", categoria: "Utilidade", estado: "Rascunho" },
    { nome: "remarcar_reuniao", categoria: "Utilidade", estado: "Rascunho" },
    { nome: "retomada_contato", categoria: "Marketing", estado: "Rascunho" },
    { nome: "abertura_contato_optin", categoria: "Marketing", estado: "Rascunho" },
  ],
  ajustes: [
    "Perguntar o valor atual do plano antes de falar em redução.",
    "Responder dúvidas de carência com texto aprovado e repassar ao Alberto.",
    "Não insistir após duas mensagens sem resposta.",
  ],
};
