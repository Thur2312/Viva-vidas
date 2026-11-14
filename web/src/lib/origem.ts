import { toNum, type CampaignRow } from "./types";

// Lógica pura da tela Origem. Regra central: custo ZERO não é o mesmo que custo DESCONHECIDO.
// Sem investimento registrado, o custo não existe (null, mostrado como "—"), nunca "R$ 0,00".

export type Row = { id: string; nome: string; investido: number; leads: number; qualificados: number; reunioes: number; vendas: number; receita: number };

export const toRow = (c: CampaignRow): Row => ({
  id: c.campaign_id,
  nome: c.nome,
  investido: toNum(c.investido),
  leads: toNum(c.leads),
  qualificados: toNum(c.qualificados),
  reunioes: toNum(c.reunioes),
  vendas: toNum(c.vendas),
  receita: toNum(c.receita),
});

export function filtrar(rows: Row[], termo: string): Row[] {
  const t = termo.trim().toLowerCase();
  return t ? rows.filter((r) => r.nome.toLowerCase().includes(t)) : rows;
}

export const somar = (rows: Row[]): Row =>
  rows.reduce(
    (a, r) => ({ ...a, investido: a.investido + r.investido, leads: a.leads + r.leads, qualificados: a.qualificados + r.qualificados, reunioes: a.reunioes + r.reunioes, vendas: a.vendas + r.vendas, receita: a.receita + r.receita }),
    { id: "total", nome: "Total", investido: 0, leads: 0, qualificados: 0, reunioes: 0, vendas: 0, receita: 0 },
  );

export const semInvestimento = (r: Pick<Row, "investido">) => !(r.investido > 0);

/** Custo por unidade. null (traço) quando não há investimento registrado ou nada para dividir: zero NÃO é custo desconhecido. */
export function custo(investido: number, quantidade: number): number | null {
  if (!(investido > 0) || !(quantidade > 0)) return null;
  return investido / quantidade;
}

/** Retorno = receita ÷ investimento. null sem investimento ou sem receita. */
export const retorno = (r: Pick<Row, "investido" | "receita">): number | null => (r.investido > 0 && r.receita > 0 ? r.receita / r.investido : null);

/**
 * Base dos custos de um CONJUNTO de campanhas: soma só as que têm investimento registrado (investimento E resultados delas).
 * Sem isso, os qualificados de uma campanha sem custo registrado puxariam o custo do total para baixo.
 */
export function baseDeCusto(rows: Row[]): { base: Row; comInvestimento: number; total: number } {
  const com = rows.filter((r) => !semInvestimento(r));
  return { base: somar(com), comInvestimento: com.length, total: rows.length };
}

export type Manchete = { valor: number | null; motivo: "ok" | "sem-investimento" | "sem-qualificados" };

/** O número da página: custo por qualificado da base de custo. */
export function manchete(base: Row): Manchete {
  if (semInvestimento(base)) return { valor: null, motivo: "sem-investimento" };
  if (!(base.qualificados > 0)) return { valor: null, motivo: "sem-qualificados" };
  return { valor: base.investido / base.qualificados, motivo: "ok" };
}
