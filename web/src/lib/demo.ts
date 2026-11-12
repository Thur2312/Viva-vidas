// Adaptador de DEMONSTRAÇÃO: só é chamado quando NEXT_PUBLIC_DEMO=true. Converte lib/data.ts para o formato do contrato.
import type { CampaignRow, LeadDetail, LeadsPage, Me, Overview, Readiness } from "./types";

const data = () => import("./data");
const stageOf = (e: string) => (e === "novo" ? "contatado" : e);

export const demoMe: Me = { id: "demo", name: "Alberto Apolinário", email: "demo@exemplo.local", role: "demo" };

export async function demoOverview(): Promise<Overview> {
  const d = await data();
  const f = d.funil;
  return {
    funnel: { contatado: f.novo, respondeu: f.respondeu, qualificado: f.qualificado, reuniao: f.reuniao, compareceu: f.compareceu, venda: f.venda },
    series: d.serie14d,
    investido: d.campanhas.reduce((s, c) => s + c.investido, 0),
    receita: d.campanhas.reduce((s, c) => s + c.receita, 0),
    activity: d.atividade.map((a) => ({ hora: a.hora, type: a.texto, actor: a.tipo === "humano" ? "human" : "agent", name: null, lead_id: null })),
  };
}

export async function demoLeads(p: { stage: string; search: string; page: number; pageSize: number }): Promise<LeadsPage> {
  const d = await data();
  const q = p.search.toLowerCase();
  const all = d.leads.filter((l) => stageOf(l.etapa) === p.stage && (!q || l.nome.toLowerCase().includes(q)));
  const slice = all.slice((p.page - 1) * p.pageSize, p.page * p.pageSize);
  return {
    data: slice.map((l) => ({
      id: l.id, name: l.nome, phone: l.telefone, stage: stageOf(l.etapa), score: l.score, source: l.origem,
      opt_out: false, created_at: new Date().toISOString(), last_message: l.resumo, last_at: null,
    })),
    meta: { page: p.page, pageSize: p.pageSize, totalItems: all.length, totalPages: Math.max(1, Math.ceil(all.length / p.pageSize)) },
  };
}

export async function demoLead(id: string): Promise<LeadDetail> {
  const d = await data();
  const l = d.leads.find((x) => x.id === id);
  return { lead: l ? { id: l.id, name: l.nome, phone: l.telefone, stage: stageOf(l.etapa), score: l.score, source: l.origem, opt_out: false } : { id }, events: [], messages: [], drafts: [] };
}

export async function demoCampaigns(): Promise<CampaignRow[]> {
  const d = await data();
  return d.campanhas.map((c, i) => ({ campaign_id: String(i + 1), nome: c.nome, investido: c.investido, leads: c.leads, qualificados: c.qualificados, reunioes: c.reunioes, vendas: c.vendas, receita: c.receita }));
}

export async function demoReadiness(): Promise<Readiness> {
  return { shadow: { enabled: false, mode: null }, stages: [] };
}
