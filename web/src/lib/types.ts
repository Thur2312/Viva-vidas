// Tipos do contrato do backend (/pilot/*). Campos numéricos podem chegar como string (pg numeric): use toNum.

export const STAGES = ["contatado", "respondeu", "qualificado", "reuniao", "compareceu", "venda"] as const;
export type Stage = (typeof STAGES)[number];

export const STAGE_META: Record<Stage, { nome: string; dica: string }> = {
  contatado: { nome: "Contatado", dica: "Recebeu a primeira mensagem" },
  respondeu: { nome: "Respondeu", dica: "Entrou em conversa com o agente" },
  qualificado: { nome: "Qualificado", dica: "Tem perfil para redução do plano" },
  reuniao: { nome: "Reunião marcada", dica: "Agendado na agenda do Alberto" },
  compareceu: { nome: "Compareceu", dica: "Participou da reunião" },
  venda: { nome: "Venda", dica: "Fechou pelo agente" },
};

export const toNum = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export type Overview = {
  periodo?: { from?: string; to?: string } | string;
  funnel: Record<Stage, number | string>;
  series: { dia: string; contatos: number | string; qualificados: number | string }[];
  investido: number | string;
  receita: number | string;
  activity: { hora: string; type: string; actor: string; name?: string | null; lead_id?: string | null }[];
};

export type LeadRow = {
  id: string;
  name: string | null;
  phone: string | null;
  stage: string;
  score: number | string | null;
  source: string | null;
  opt_out: boolean | null;
  created_at: string;
  last_message: string | null;
  last_at: string | null;
};

export type LeadsPage = {
  data: LeadRow[];
  meta: { page: number; pageSize: number; totalItems: number; totalPages: number };
};

export type LeadDetail = {
  lead: Record<string, unknown>;
  events: Record<string, unknown>[];
  messages: Record<string, unknown>[];
  drafts: Record<string, unknown>[];
};

export type CampaignRow = {
  campaign_id: string;
  nome: string;
  investido: number | string;
  leads: number | string;
  qualificados: number | string;
  reunioes: number | string;
  vendas: number | string;
  receita: number | string;
};

export type ReadinessByAction = {
  action: string;
  drafts: number | string;
  compared: number | string;
  usable_rate: number | string | null;
  guard_failures: number | string;
};

export type Readiness = {
  shadow: { enabled: boolean; mode?: string | null; provider?: string | null };
  /** Por ação do cérebro de vendas (migration 011). Pode faltar ou vir vazio. */
  byAction?: ReadinessByAction[];
  stages: {
    stage: string;
    drafts: number | string;
    compared: number | string;
    avg_similarity: number | string | null;
    usable_rate: number | string | null;
  }[];
};

export type Me = { id: string; name: string; email: string; role: string };

// ───── Conversas (/pilot/conversations) ─────
export type ConversationRow = {
  id: string;
  lead_id: string;
  lead_name: string | null;
  phone: string | null; // sempre mascarado pelo servidor
  stage: string;
  mode: "shadow" | "assisted" | "auto" | string;
  last_message_preview: string | null;
  last_author: "lead" | "humano" | "agente" | null;
  last_at: string | null;
  unread_for_human?: boolean;
  messages_count: number;
  has_pending_draft: boolean;
};

export type ConversationsPage = {
  data: ConversationRow[];
  meta: { page: number; pageSize: number; totalItems: number; totalPages: number };
};

export type DraftInfo = {
  id: number;
  draft_body: string;
  similarity: number | null;
  human_action: "igual" | "editou" | "diferente" | "ignorou" | null;
  stage_guess: string | null;
  next_action_guess: string | null;
};

export type ThreadMessage = {
  id: number;
  direction: "in" | "out";
  author: "lead" | "humano" | "agente";
  body: string;
  created_at: string;
  draft?: DraftInfo;
};

export type ThreadPage = { data: ThreadMessage[]; hasMore: boolean };

export type ConversationStats = {
  periodo: { from: string; to: string; timezone?: string };
  mensagens: { dia: string; leads_in: number; humano_out: number; agente_out: number }[];
  conversas_ativas: number;
  conversas_novas: number;
  taxa_resposta_lead: number | null;
  taxa_resposta_equipe?: number | null;
  tempo_primeira_resposta_humano_seg: { p50: number | null; p90: number | null; media: number | null; amostra?: number };
  tempo_resposta_humano_seg: { p50: number | null; p90: number | null; amostra?: number };
  rascunhos: { total: number; comparados: number; igual: number; editou: number; diferente: number; ignorou: number; usable_rate: number | null };
  handoffs?: number;
  por_etapa: { stage: string; conversas: number }[];
  horarios_pico: { hora: number; mensagens: number }[];
};

// ───── Playbook de vendas (/pilot/playbook) ─────
// Espelho do tipo da API (api/src/modules/pilot/brain/types.ts). Copiado, não importado.
export type PredicateOp = "eq" | "gt" | "gte" | "lt" | "lte" | "presente" | "ausente";
export type PredicateLeaf = { campo: string; op: PredicateOp; valor?: string | number | boolean };
export type PredicateGroup = { all?: Predicate[]; any?: Predicate[] };
export type Predicate = PredicateGroup | PredicateLeaf;

export type ProfileField = {
  chave: string;
  pergunta: string;
  porque: string;
  obrigatorio: boolean;
  ordem: number;
  sensivel: boolean;
  valores?: string[];
};

export type Objection = { id: string; gatilho: string; resposta: string; nuncaDizer: string[] };
export type ApprovedFact = { id: string; texto: string };

export type PlaybookData = {
  oferta: { descricao: string; publico: string };
  campos: ProfileField[];
  criterios: { qualificado?: Predicate; desqualificado?: Predicate };
  objecoes: Objection[];
  fatos: ApprovedFact[];
  tom: { formalidade: string; tamanho: string; emoji: string; frases: string[] };
  regrasProibidas: string[];
  passagemHumano: { quando: string[] };
  agenda: { tiposReuniao: string[]; duracaoMin: number; janelas: string; prometer: string };
  cadencia: { maxTentativas: number; mensagem: string };
  /** Instruções e exemplos rotulados "EXEMPLO (não ativo)"; nunca conteúdo usável. */
  exemplos?: Record<string, string>;
};

export type PlaybookStatus = "rascunho" | "ativo" | "arquivado";
export type PlaybookVersionRow = { version: number; status: PlaybookStatus; source: string | null; created_at: string };
export type PlaybookOverview = {
  active: { version: number; data: PlaybookData; status: PlaybookStatus } | null;
  versions: PlaybookVersionRow[];
  template: PlaybookData;
};
export type PlaybookVersion = PlaybookVersionRow & { data: PlaybookData | null; notes: string | null };
