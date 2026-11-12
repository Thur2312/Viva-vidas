"use client";

import Link from "next/link";
import { CalendarCheck, CircleDollarSign, Handshake, UserCheck } from "lucide-react";
import { EmptyState, QueryBlock, Skeleton } from "@/components/Block";
import { RangePicker } from "@/components/RangePicker";
import { KpiCard, PageHeader, Panel } from "@/components/ui";
import { useOverview, useReadiness } from "@/lib/hooks";
import { useRangeState } from "@/lib/range";
import { money, num, pct, perUnit, ratio } from "@/lib/format";
import { STAGES, STAGE_META, toNum, type Overview, type Readiness as ReadinessT, type Stage } from "@/lib/types";

const actorTone: Record<string, string> = { agent: "bg-ok", human: "bg-brand", system: "bg-mute" };
const actorLabel: Record<string, string> = { agent: "Agente", human: "Equipe", system: "Sistema" };

function pilotDay(): { day: number; total: number } | null {
  const start = process.env.NEXT_PUBLIC_PILOT_START;
  if (!start || !/^\d{4}-\d{2}-\d{2}$/.test(start)) return null;
  const total = 20;
  const d = Math.floor((Date.now() - new Date(`${start}T00:00:00`).getTime()) / 86_400_000) + 1;
  return { day: Math.min(Math.max(d, 0), total), total };
}

const funnelOf = (d: Overview) => Object.fromEntries(STAGES.map((s) => [s, toNum(d.funnel?.[s])])) as Record<Stage, number>;

function DailyBars({ series }: { series: Overview["series"] }) {
  const rows = series.map((d) => ({ dia: d.dia, c: toNum(d.contatos), q: toNum(d.qualificados) }));
  const max = Math.max(1, ...rows.map((r) => r.c));
  return (
    <figure>
      <div className="flex h-44 items-end gap-1.5 sm:gap-2" role="img" aria-label={`Contatos e qualificados por dia: ${rows.map((r) => `${r.dia}, ${r.c} contatos, ${r.q} qualificados`).join("; ")}`}>
        {rows.map((d) => (
          <div key={d.dia} className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1" title={`${d.dia}: ${d.c} contatos, ${d.q} qualificados`}>
            <div className="relative flex w-full flex-1 items-end">
              <div className="w-full rounded-t bg-deep/15 dark:bg-white/20" style={{ height: `${(d.c / max) * 100}%` }}>
                <div className="w-full rounded-t bg-brand" style={{ height: `${d.c ? (d.q / d.c) * 100 : 0}%` }} />
              </div>
            </div>
            <span className="max-w-full truncate text-[10px] text-mute sm:text-xs">{d.dia.slice(0, 5)}</span>
          </div>
        ))}
      </div>
      <figcaption className="mt-3 flex gap-4 text-xs text-mute">
        <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-sm bg-deep/15 dark:bg-white/20" /> Contatos</span>
        <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-sm bg-brand" /> Qualificados</span>
      </figcaption>
    </figure>
  );
}

function ReadinessView({ r }: { r: ReadinessT }) {
  if (!r.shadow.enabled) {
    return <p className="rounded-lg bg-warn/10 p-3 text-sm text-warn">Aprendizado em modo sombra aguardando a chave do provedor de IA.</p>;
  }
  const stages = r.stages ?? [];
  return (
    <div>
      <p className="mb-3 text-sm text-mute">
        Modo sombra ativo{r.shadow.mode ? ` (${r.shadow.mode})` : ""}: o agente escreve rascunhos que não são enviados, e comparamos com a resposta humana.
      </p>
      {stages.length === 0 ? (
        <p className="text-sm text-mute">Ainda não há rascunhos comparados com respostas humanas.</p>
      ) : (
        <ul className="space-y-3">
          {stages.map((s) => {
            const rate = s.usable_rate === null ? null : Math.min(1, Math.max(0, toNum(s.usable_rate)));
            const name = STAGE_META[s.stage as Stage]?.nome ?? s.stage;
            return (
              <li key={s.stage}>
                <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
                  <span className="font-medium">{name}</span>
                  <span className="tabular font-semibold">{rate === null ? "sem dados" : `${pct(rate)} aproveitáveis`}</span>
                </div>
                <div className="h-2.5 rounded-full bg-deep/[0.08] dark:bg-white/15" role="progressbar" aria-label={`Rascunhos aproveitáveis em ${name}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={rate === null ? undefined : Math.round(rate * 100)}>
                  <div className="h-full rounded-full bg-brand" style={{ width: `${(rate ?? 0) * 100}%` }} />
                </div>
                <p className="mt-1 text-xs text-mute">
                  {num(toNum(s.compared))} comparados de {num(toNum(s.drafts))} rascunhos
                  {s.avg_similarity !== null && ` · similaridade média ${pct(toNum(s.avg_similarity))}`}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export default function Dashboard() {
  const [range, setRange] = useRangeState("30d");
  const ov = useOverview(range);
  const rd = useReadiness();
  const pd = pilotDay();

  return (
    <>
      <PageHeader eyebrow={`Piloto de 20 dias${pd ? ` · dia ${pd.day} de ${pd.total}` : ""}`} title="Como o agente tem trabalhado">
        Do primeiro contato à venda: o que o agente fez, o que virou reunião e quanto custou cada etapa.
      </PageHeader>

      {pd && (
        <div className="rise mb-6">
          <div className="mb-1.5 flex justify-between text-xs font-medium text-mute">
            <span>Início do piloto</span>
            <span>Reunião de decisão · dia {pd.total}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-line" role="progressbar" aria-valuenow={pd.day} aria-valuemin={0} aria-valuemax={pd.total} aria-label="Progresso do piloto">
            <div className="h-full rounded-full bg-brand" style={{ width: `${(pd.day / pd.total) * 100}%` }} />
          </div>
        </div>
      )}

      <div className="mb-6"><RangePicker value={range} onChange={setRange} /></div>

      <QueryBlock q={ov} skeleton={<div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-28" />)}</div>}>
        {(d) => {
          const f = funnelOf(d);
          const invest = toNum(d.investido);
          const receita = toNum(d.receita);
          const cpq = perUnit(invest, f.qualificado);
          return (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <KpiCard variant="primary" title="Reuniões marcadas" value={num(f.reuniao)} icon={<CalendarCheck size={18} />} sub={`${num(f.compareceu)} já compareceram`} tip="Leads que o agente qualificou e agendou na agenda do Alberto." />
              <KpiCard title="Leads qualificados" value={num(f.qualificado)} icon={<UserCheck size={18} />} sub={`${pct(ratio(f.qualificado, f.respondeu))} de quem respondeu`} tip="Leads com perfil para a redução do plano, segundo o playbook." />
              <KpiCard title="Custo por qualificado" value={cpq === null || invest === 0 ? "—" : money(cpq)} icon={<CircleDollarSign size={18} />} sub={invest > 0 ? `Investido ${money(invest)}` : "Sem investimento registrado"} tip="Investimento em anúncios dividido pelos leads qualificados. Aparece como traço quando não há investimento ou qualificados no período." />
              <KpiCard variant="success" title="Vendas pelo agente" value={num(f.venda)} icon={<Handshake size={18} />} sub={`${money(receita)} vendidos`} tip="Base dos 30% da proposta. A regra de atribuição ainda será fechada em contrato." />
            </div>
          );
        }}
      </QueryBlock>

      <div className="mt-6 grid gap-6 xl:grid-cols-5">
        <Panel className="rise xl:col-span-3" title="Funil do piloto" hint="Quantos leads chegaram em cada etapa e quanto passou para a próxima.">
          <QueryBlock q={ov} skeleton={<Skeleton className="h-72" />} isEmpty={(d) => toNum(d.funnel?.contatado) === 0} empty={<EmptyState title="Nenhum lead ainda">Quando o agente começar a contatar pessoas, o funil aparece aqui. Tente também ampliar o período.</EmptyState>}>
            {(d) => {
              const f = funnelOf(d);
              const max = Math.max(1, f.contatado);
              return (
                <>
                  <ol className="space-y-3">
                    {STAGES.map((s, i) => {
                      const v = f[s];
                      const prev = i === 0 ? null : f[STAGES[i - 1]];
                      return (
                        <li key={s} className="grid grid-cols-[110px_1fr] items-center gap-3 sm:grid-cols-[140px_1fr]">
                          <div>
                            <p className="text-sm font-semibold">{STAGE_META[s].nome}</p>
                            {prev !== null && <p className="text-xs text-mute">{prev === 0 ? "sem base" : `${pct(ratio(v, prev))} da etapa anterior`}</p>}
                          </div>
                          <div className="h-9 rounded-md bg-deep/[0.06] dark:bg-white/10">
                            <div className={`tabular flex h-full items-center rounded-md px-3 text-sm font-semibold ${s === "venda" ? "bg-brand text-deep" : "bg-deep text-white dark:bg-[#1d4380]"}`} style={{ width: `max(${(v / max) * 100}%, 3.5rem)` }}>
                              {num(v)}
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                  <p className="mt-4 text-sm text-mute">De {num(f.contatado)} contatos, {pct(ratio(f.venda, f.contatado))} viraram venda.</p>
                </>
              );
            }}
          </QueryBlock>
        </Panel>

        <Panel className="rise xl:col-span-2" title="Atividade do agente" hint="O que ele fez e o que foi para o Alberto.">
          <QueryBlock q={ov} skeleton={<Skeleton className="h-72" />} isEmpty={(d) => !d.activity?.length} empty={<EmptyState title="Sem atividade no período" />}>
            {(d) => (
              <ul className="space-y-3.5">
                {d.activity.map((a, i) => (
                  <li key={`${a.hora}-${i}`} className="grid grid-cols-[44px_12px_1fr] items-start gap-2 text-sm">
                    <span className="tabular pt-px text-xs font-medium text-mute">{a.hora}</span>
                    <span className={`mt-1.5 h-2 w-2 rounded-full ${actorTone[a.actor] ?? "bg-mute"}`} aria-hidden="true" />
                    <span>
                      <span className="sr-only">{actorLabel[a.actor] ?? a.actor}: </span>
                      <span className="capitalize">{a.type.replace(/_/g, " ")}</span>
                      {a.name && (a.lead_id ? <> · <Link href={`/funil?leadId=${encodeURIComponent(a.lead_id)}`} className="font-medium underline underline-offset-2">{a.name}</Link></> : <> · {a.name}</>)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </QueryBlock>
        </Panel>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-5">
        <Panel className="rise xl:col-span-3" title="Contatos por dia" hint="A parte laranja são os leads que chegaram a qualificados.">
          <QueryBlock q={ov} skeleton={<Skeleton className="h-52" />} isEmpty={(d) => !d.series?.length} empty={<EmptyState title="Nenhum lead ainda">Sem contatos no período selecionado.</EmptyState>}>
            {(d) => <DailyBars series={d.series} />}
          </QueryBlock>
        </Panel>

        <Panel className="rise xl:col-span-2" title="Aprendizado em modo sombra" hint="Quanto dos rascunhos do agente a equipe aproveitaria como estão.">
          <QueryBlock q={rd} skeleton={<Skeleton className="h-52" />}>{(r) => <ReadinessView r={r} />}</QueryBlock>
        </Panel>
      </div>
    </>
  );
}
