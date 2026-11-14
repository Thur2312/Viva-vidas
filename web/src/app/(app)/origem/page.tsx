"use client";

import { Columns3 } from "lucide-react";
import { useMemo, useState } from "react";
import { EmptyState, QueryBlock, Skeleton } from "@/components/Block";
import { Folio, Manchete, Marginalia, type MarginItem } from "@/components/folha";
import { RangePicker } from "@/components/RangePicker";
import { PageHeader } from "@/components/ui";
import { useCampaigns } from "@/lib/hooks";
import { money, num, pct } from "@/lib/format";
import { baseDeCusto, custo, filtrar, manchete, retorno, semInvestimento, somar, toRow, type Row } from "@/lib/origem";
import { isValidRange, resolvePreset, type Range } from "@/lib/range";

// Tela Origem no desenho "Prontuário": manchete (custo por qualificado), tabela densa e marginália, sem cartões.
// Regra de dado: custo ZERO não é custo DESCONHECIDO. Sem investimento registrado, o custo aparece como "—" (lib/origem.ts).

type Fmt = "money" | "int" | "pct" | "x";
// `custo: true` = coluna que depende de investimento: na linha de total usa só as campanhas com investimento registrado.
type Col = { id: string; label: string; fmt: Fmt; get: (r: Row) => number | null; strong?: boolean; custo?: boolean };

const COLS: Col[] = [
  { id: "investido", label: "Investido", fmt: "money", get: (r) => r.investido },
  { id: "leads", label: "Leads", fmt: "int", get: (r) => r.leads },
  { id: "qualificados", label: "Qualif.", fmt: "int", get: (r) => r.qualificados },
  { id: "reunioes", label: "Reuniões", fmt: "int", get: (r) => r.reunioes },
  { id: "vendas", label: "Vendas", fmt: "int", get: (r) => r.vendas },
  { id: "receita", label: "Receita", fmt: "money", get: (r) => r.receita },
  { id: "taxaQualif", label: "% qualificados", fmt: "pct", get: (r) => (r.leads ? r.qualificados / r.leads : null) },
  { id: "cpl", label: "CPL", fmt: "money", get: (r) => custo(r.investido, r.leads), custo: true },
  { id: "cpq", label: "Custo/qualif.", fmt: "money", get: (r) => custo(r.investido, r.qualificados), strong: true, custo: true },
  { id: "cpr", label: "Custo/reunião", fmt: "money", get: (r) => custo(r.investido, r.reunioes), strong: true, custo: true },
  { id: "cpv", label: "Custo/venda", fmt: "money", get: (r) => custo(r.investido, r.vendas), custo: true },
  { id: "retorno", label: "Retorno", fmt: "x", get: (r) => retorno(r), custo: true },
];
const DEFAULT_COLS = ["investido", "leads", "qualificados", "taxaQualif", "reunioes", "vendas", "cpl", "cpq", "cpr", "retorno"];

function fmt(v: number | null, f: Fmt) {
  if (v === null) return "—";
  if (f === "money") return money(v);
  if (f === "pct") return pct(v);
  if (f === "x") return `${v.toFixed(1).replace(".", ",")}x`;
  return num(v);
}

/** Traço visível, mas lido por leitores de tela como "sem dado". */
function Celula({ v, f }: { v: number | null; f: Fmt }) {
  if (v === null) return <><span aria-hidden="true">—</span><span className="sr-only">sem dado</span></>;
  return <>{fmt(v, f)}</>;
}

type Filters = { range: Range; q: string };

const th = "py-2 font-mono text-[11px] font-medium uppercase tracking-wider";

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

      <form className="mb-10 border-y border-line py-4" onSubmit={(e) => { e.preventDefault(); if (valid && dirty) setApplied(draft); }}>
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

      <QueryBlock q={q} skeleton={<Skeleton className="h-72" />} isEmpty={(d) => d.length === 0} empty={<EmptyState title="Nenhuma campanha com leads">Não há campanhas com dados neste período.</EmptyState>}>
        {(data) => {
          const rows = filtrar(data.map(toRow), applied.q);
          if (rows.length === 0) return <EmptyState title="Nada com esse filtro">Nenhuma campanha contém “{applied.q}”.</EmptyState>;

          const total = somar(rows);
          const { base, comInvestimento } = baseDeCusto(rows); // custos do total: só campanhas com investimento registrado
          const m = manchete(base);
          const algumaSem = comInvestimento < rows.length;

          const caption =
            m.motivo === "ok" ? `${money(base.investido)} investidos em ${comInvestimento === 1 ? "1 campanha" : `${comInvestimento} campanhas`} com investimento registrado; ${num(base.qualificados)} leads qualificados nelas.`
            : m.motivo === "sem-qualificados" ? `${money(base.investido)} investidos e nenhum lead qualificado ainda.`
            : "Nenhuma campanha tem investimento registrado neste período, então o custo é desconhecido (não é zero).";

          const resumo: MarginItem[] = [
            { label: "Investido", value: total.investido > 0 ? money(total.investido) : "—", sub: total.investido > 0 ? undefined : "sem investimento registrado" },
            { label: "Leads", value: num(total.leads) },
            { label: "% qualificados", value: total.leads ? pct(total.qualificados / total.leads) : "—", sub: `${num(total.qualificados)} de ${num(total.leads)} leads` },
            { label: "Reuniões", value: num(total.reunioes) },
            { label: "Vendas", value: num(total.vendas) },
            { label: "Receita", value: money(total.receita) },
            { label: "Retorno", value: fmt(retorno(base), "x"), sub: "receita ÷ investimento, só das campanhas com investimento" },
            { label: "Meta Ads", value: "sem leitura", sub: "Este painel não lê o estado da conexão com o Meta nem os eventos enviados a ele. O investimento exibido é o registrado no backend do piloto e pode estar incompleto." },
          ];

          return (
            <div className="grid gap-x-14 gap-y-12 xl:grid-cols-[minmax(0,1fr)_340px]">
              <div className="min-w-0 space-y-12">
                <Manchete label="Custo por qualificado" caption={caption}>{m.valor === null ? "—" : money(m.valor)}</Manchete>

                <Folio
                  n="01"
                  title="Desempenho por campanha"
                  hint="Custo por lead, por qualificado, por reunião e por venda. O custo só aparece quando a campanha tem investimento registrado."
                  action={
                    <div className="relative">
                      <button type="button" aria-expanded={picker} onClick={() => setPicker((p) => !p)} className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-line bg-card px-4 text-sm font-medium hover:bg-ink/5">
                        <Columns3 size={16} aria-hidden="true" /> Colunas
                      </button>
                      {picker && (
                        <fieldset className="absolute right-0 z-20 mt-2 w-60 rounded-lg border border-line bg-card p-3 shadow-lg" onKeyDown={(e) => e.key === "Escape" && setPicker(false)}>
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
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[640px] text-left text-sm">
                      <caption className="sr-only">Desempenho por campanha de {applied.range.from} a {applied.range.to}</caption>
                      <thead>
                        <tr className="border-b border-line text-mute">
                          <th scope="col" className={`${th} pr-4`}>Campanha</th>
                          {shown.map((c) => <th key={c.id} scope="col" className={`${th} px-3 text-right`}>{c.label}</th>)}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-line">
                        {rows.map((r) => (
                          <tr key={r.id}>
                            <th scope="row" className="py-2.5 pr-4 font-semibold">{r.nome}</th>
                            {shown.map((c) => <td key={c.id} className={`tabular px-3 py-2.5 text-right font-mono ${c.strong ? "font-semibold" : ""}`}><Celula v={c.get(r)} f={c.fmt} /></td>)}
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="border-t border-line font-semibold">
                          <th scope="row" className="py-3 pr-4">Total</th>
                          {shown.map((c) => <td key={c.id} className="tabular px-3 py-3 text-right font-mono"><Celula v={c.get(c.custo ? base : total)} f={c.fmt} /></td>)}
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                  {(algumaSem || comInvestimento === 0) && (
                    <p className="mt-3 text-xs text-mute">
                      {comInvestimento === 0
                        ? "“—” nos custos: nenhuma campanha tem investimento registrado neste período."
                        : `“—” nos custos: a campanha não tem investimento registrado. O custo da linha Total considera só as ${comInvestimento} de ${rows.length} campanhas com investimento.`}
                    </p>
                  )}
                </Folio>
              </div>

              <aside className="min-w-0" aria-label="Totais do período">
                <h2 className="mb-3 font-display text-xl leading-tight">Totais</h2>
                <Marginalia items={resumo} />
              </aside>
            </div>
          );
        }}
      </QueryBlock>
    </>
  );
}
