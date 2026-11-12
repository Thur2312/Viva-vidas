"use client";

import { Columns3 } from "lucide-react";
import { useMemo, useState } from "react";
import { EmptyState, QueryBlock, Skeleton } from "@/components/Block";
import { RangePicker } from "@/components/RangePicker";
import { PageHeader, Panel } from "@/components/ui";
import { useCampaigns } from "@/lib/hooks";
import { isValidRange, resolvePreset, type Range } from "@/lib/range";
import { money, num, pct, perUnit, ratio } from "@/lib/format";
import { toNum, type CampaignRow } from "@/lib/types";

type Row = { id: string; nome: string; investido: number; leads: number; qualificados: number; reunioes: number; vendas: number; receita: number };
type Fmt = "money" | "int" | "pct" | "x";
type Col = { id: string; label: string; fmt: Fmt; get: (r: Row) => number | null; strong?: boolean };

const COLS: Col[] = [
  { id: "investido", label: "Investido", fmt: "money", get: (r) => r.investido },
  { id: "leads", label: "Leads", fmt: "int", get: (r) => r.leads },
  { id: "qualificados", label: "Qualif.", fmt: "int", get: (r) => r.qualificados },
  { id: "reunioes", label: "Reuniões", fmt: "int", get: (r) => r.reunioes },
  { id: "vendas", label: "Vendas", fmt: "int", get: (r) => r.vendas },
  { id: "receita", label: "Receita", fmt: "money", get: (r) => r.receita },
  { id: "taxaQualif", label: "% qualificados", fmt: "pct", get: (r) => (r.leads ? r.qualificados / r.leads : null) },
  { id: "cpl", label: "CPL", fmt: "money", get: (r) => perUnit(r.investido, r.leads) },
  { id: "cpq", label: "Custo/qualif.", fmt: "money", get: (r) => perUnit(r.investido, r.qualificados), strong: true },
  { id: "cpr", label: "Custo/reunião", fmt: "money", get: (r) => perUnit(r.investido, r.reunioes), strong: true },
  { id: "cpv", label: "Custo/venda", fmt: "money", get: (r) => perUnit(r.investido, r.vendas) },
  { id: "retorno", label: "Retorno", fmt: "x", get: (r) => (r.investido > 0 && r.receita > 0 ? r.receita / r.investido : null) },
];
const DEFAULT_COLS = ["investido", "leads", "qualificados", "reunioes", "vendas", "cpl", "cpq", "cpr", "retorno"];

function fmt(v: number | null, f: Fmt) {
  if (v === null) return "—";
  if (f === "money") return money(v);
  if (f === "pct") return pct(v);
  if (f === "x") return `${v.toFixed(1).replace(".", ",")}x`;
  return num(v);
}

const toRow = (c: CampaignRow): Row => ({
  id: c.campaign_id, nome: c.nome, investido: toNum(c.investido), leads: toNum(c.leads), qualificados: toNum(c.qualificados),
  reunioes: toNum(c.reunioes), vendas: toNum(c.vendas), receita: toNum(c.receita),
});

type Filters = { range: Range; q: string };

export default function Origem() {
  // Rascunho x aplicado: nada muda na tela (nem dispara consulta) até clicar em "Aplicar".
  const [applied, setApplied] = useState<Filters>(() => ({ range: resolvePreset("30d"), q: "" }));
  const [draft, setDraft] = useState<Filters>(applied);
  const [cols, setCols] = useState<string[]>(DEFAULT_COLS);
  const [picker, setPicker] = useState(false);
  const q = useCampaigns(applied.range);

  const valid = isValidRange(draft.range);
  const dirty = draft.q !== applied.q || draft.range.from !== applied.range.from || draft.range.to !== applied.range.to || draft.range.preset !== applied.range.preset;
  const shown = useMemo(() => COLS.filter((c) => cols.includes(c.id)), [cols]);

  return (
    <>
      <PageHeader eyebrow="Origem e anúncios" title="Quanto custa cada etapa, por campanha">
        Cada lead guarda o anúncio de onde veio. Aqui você vê qual campanha traz gente que vira reunião e venda, e não só conversa.
      </PageHeader>

      <form
        className="mb-6 rounded-xl border border-line bg-card p-4"
        onSubmit={(e) => { e.preventDefault(); if (valid && dirty) setApplied(draft); }}
      >
        <div className="flex flex-wrap items-end gap-x-6 gap-y-4">
          <RangePicker value={draft.range} onChange={(range) => setDraft((d) => ({ ...d, range }))} deferCustom={false} />
          <div className="min-w-[200px]">
            <label htmlFor="q" className="mb-1 block text-xs font-medium text-mute">Campanha contém</label>
            <input id="q" value={draft.q} onChange={(e) => setDraft((d) => ({ ...d, q: e.target.value }))} placeholder="Ex.: PME" className="min-h-[44px] w-full rounded-lg border border-line bg-card px-3 text-sm" />
          </div>
          <button type="submit" disabled={!valid || !dirty} className="min-h-[44px] rounded-full bg-brand px-6 text-sm font-bold text-on-brand disabled:cursor-not-allowed disabled:opacity-50">
            Aplicar
          </button>
        </div>
      </form>

      <Panel
        title="Desempenho por campanha"
        hint="Custo por lead, por qualificado, por reunião e por venda."
        action={
          <div className="relative">
            <button type="button" aria-expanded={picker} onClick={() => setPicker((p) => !p)} className="inline-flex min-h-[44px] items-center gap-2 rounded-full border border-line bg-card px-4 text-sm font-medium hover:bg-ink/5">
              <Columns3 size={16} aria-hidden="true" /> Colunas
            </button>
            {picker && (
              <fieldset className="absolute right-0 z-20 mt-2 w-60 rounded-xl border border-line bg-card p-3 shadow-lg" onKeyDown={(e) => e.key === "Escape" && setPicker(false)}>
                <legend className="sr-only">Colunas visíveis</legend>
                {COLS.map((c) => (
                  <label key={c.id} className="flex min-h-[44px] cursor-pointer items-center gap-3 rounded-md px-2 text-sm hover:bg-ink/5">
                    <input type="checkbox" className="h-4 w-4 accent-brand" checked={cols.includes(c.id)} onChange={(e) => setCols((cur) => (e.target.checked ? [...cur, c.id] : cur.filter((x) => x !== c.id)))} />
                    {c.label}
                  </label>
                ))}
                <button type="button" onClick={() => setCols(DEFAULT_COLS)} className="mt-1 min-h-[44px] w-full rounded-md text-sm font-semibold underline underline-offset-2">Restaurar padrão</button>
              </fieldset>
            )}
          </div>
        }
      >
        <QueryBlock q={q} skeleton={<Skeleton className="h-56" />} isEmpty={(d) => d.length === 0} empty={<EmptyState title="Nenhuma campanha com leads">Não há campanhas com dados neste período.</EmptyState>}>
          {(data) => {
            const term = applied.q.trim().toLowerCase();
            const rows = data.map(toRow).filter((r) => !term || r.nome.toLowerCase().includes(term));
            if (rows.length === 0) return <EmptyState title="Nada com esse filtro">Nenhuma campanha contém “{applied.q}”.</EmptyState>;
            const total: Row = rows.reduce((a, r) => ({ ...a, investido: a.investido + r.investido, leads: a.leads + r.leads, qualificados: a.qualificados + r.qualificados, reunioes: a.reunioes + r.reunioes, vendas: a.vendas + r.vendas, receita: a.receita + r.receita }), { id: "total", nome: "Total", investido: 0, leads: 0, qualificados: 0, reunioes: 0, vendas: 0, receita: 0 });
            return (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-left text-sm">
                  <caption className="sr-only">Desempenho por campanha de {applied.range.from} a {applied.range.to}</caption>
                  <thead>
                    <tr className="border-b border-line text-xs uppercase tracking-wider text-mute">
                      <th scope="col" className="py-3 pr-4 font-semibold">Campanha</th>
                      {shown.map((c) => <th key={c.id} scope="col" className="px-3 py-3 text-right font-semibold">{c.label}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id} className="border-b border-line/70">
                        <th scope="row" className="py-3.5 pr-4 font-semibold">{r.nome}</th>
                        {shown.map((c) => <td key={c.id} className={`tabular px-3 text-right ${c.strong ? "font-semibold" : ""}`}>{fmt(c.get(r), c.fmt)}</td>)}
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="font-semibold">
                      <th scope="row" className="py-3.5 pr-4">Total</th>
                      {shown.map((c) => <td key={c.id} className="tabular px-3 text-right">{fmt(c.get(total), c.fmt)}</td>)}
                    </tr>
                  </tfoot>
                </table>
              </div>
            );
          }}
        </QueryBlock>
      </Panel>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Panel title="Qualidade do lead por campanha" hint="Percentual de leads que chegaram a qualificado.">
          <QueryBlock q={q} skeleton={<Skeleton className="h-32" />} isEmpty={(d) => d.length === 0} empty={<p className="text-sm text-mute">Sem dados no período.</p>}>
            {(data) => (
              <ul className="space-y-4">
                {data.map(toRow).map((r) => {
                  const rate = ratio(r.qualificados, r.leads);
                  return (
                    <li key={r.id}>
                      <div className="mb-1 flex justify-between gap-3 text-sm">
                        <span className="font-medium">{r.nome}</span>
                        <span className="tabular font-semibold">{pct(rate)}</span>
                      </div>
                      <div className="h-2.5 rounded-full bg-deep/[0.08] dark:bg-white/15">
                        <div className="h-full rounded-full bg-brand" style={{ width: `${Math.min(100, rate * 100)}%` }} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </QueryBlock>
        </Panel>

        <Panel title="Meta Ads e retorno de eventos" hint="Estado das conexões com o Meta.">
          <ul className="space-y-3 text-sm">
            <li className="flex items-start justify-between gap-4 border-b border-line/70 pb-3">
              <div><p className="font-semibold">Conexão com o Meta Ads</p><p className="text-mute">Importação automática de investimento e anúncios.</p></div>
              <span className="shrink-0 rounded-full bg-warn/10 px-2.5 py-1 text-xs font-semibold text-warn">Pendente</span>
            </li>
            <li className="flex items-start justify-between gap-4">
              <div><p className="font-semibold">API de Conversões</p><p className="text-mute">Envio de lead qualificado, reunião e venda ao Meta para otimizar anúncios.</p></div>
              <span className="shrink-0 rounded-full bg-warn/10 px-2.5 py-1 text-xs font-semibold text-warn">Pendente</span>
            </li>
          </ul>
          <p className="mt-4 rounded-lg bg-ink/[0.06] p-3 text-sm text-mute">
            Nenhum evento está sendo enviado ao Meta ainda. O investimento exibido é o que consta no backend do piloto; sem a conexão com o Meta Ads, pode estar incompleto e os custos por etapa só valem quando houver investimento registrado.
          </p>
        </Panel>
      </div>
    </>
  );
}
