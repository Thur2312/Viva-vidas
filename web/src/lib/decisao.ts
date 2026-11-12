// Contas da reunião de decisão do dia 20. Funções puras: recebem números e devolvem números.
// As constantes de referência vêm do resumo da proposta HZ-2026-0003 (valores informados, não medidos pelo sistema).

/** Comissão variável da proposta: 30% do que for vendido pela automação. */
export const COMISSAO = 0.3;
/** Setup: R$ 5.000 em duas parcelas de R$ 2.500. */
export const SETUP = 5000;
/** Meta de vendas novas por mês nos próximos 2 meses, segundo o Alberto. */
export const META_MENSAL = 20_000;
/** Custo aproximado de cada janela de conversa do WhatsApp (estimado: confirmar na fatura da Meta). */
export const CUSTO_JANELA_PADRAO = 0.36;

/** Funil da base atual dele, antes do agente: ~70 mil contatos → 6 a 7,5 mil conversas → 600 a 700 qualificados → ~7 vendas (R$ 14 mil). */
export const REFERENCIA = {
  contatos: 70_000,
  conversas: 6_750,
  qualificados: 650,
  vendas: 7,
  receita: 14_000,
};

export type Funil = { contatos: number; respondeu: number; qualificados: number; vendas: number };

const div = (a: number, b: number) => (b > 0 ? a / b : null);

export function taxas(f: Funil) {
  return {
    resposta: div(f.respondeu, f.contatos),
    qualificacao: div(f.qualificados, f.respondeu),
    fechamento: div(f.vendas, f.qualificados),
    contatoVenda: div(f.vendas, f.contatos),
  };
}

export const taxasReferencia = () =>
  taxas({ contatos: REFERENCIA.contatos, respondeu: REFERENCIA.conversas, qualificados: REFERENCIA.qualificados, vendas: REFERENCIA.vendas });

/** Custo medido: anúncios + janelas de conversa (estimadas). Tokens de IA e voz ainda não são registrados. */
export function custoPorQualificado(investido: number, janelas: number, custoJanela: number, qualificados: number) {
  const mensagens = janelas * custoJanela;
  const total = investido + mensagens;
  return { mensagens, total, porQualificado: div(total, qualificados) };
}

/** Quanto precisa vender no mês para a meta, dado o ticket médio e a taxa contato→venda observados. */
export function caminhoParaMeta(meta: number, ticket: number | null, contatoVenda: number | null) {
  if (!ticket || ticket <= 0) return { vendas: null, contatos: null };
  const vendas = Math.ceil(meta / ticket);
  return { vendas, contatos: contatoVenda && contatoVenda > 0 ? Math.ceil(vendas / contatoVenda) : null };
}

export const comissao = (receita: number) => receita * COMISSAO;
