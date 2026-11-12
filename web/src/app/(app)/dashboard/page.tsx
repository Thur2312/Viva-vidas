"use client";

import Link from "next/link";
import { EmptyState, QueryBlock, Skeleton } from "@/components/Block";
import { CountUp } from "@/components/CountUp";
import { Folio, Manchete, Marginalia } from "@/components/folha";
import { PulseFunnel } from "@/components/PulseFunnel";
import { RangePicker } from "@/components/RangePicker";
import { PageHeader } from "@/components/ui";
import { useOverview, useReadiness } from "@/lib/hooks";
import { useRangeState } from "@/lib/range";
import { money, num, pct, perUnit, ratio } from "@/lib/format";
import { STAGES, STAGE_META, toNum, type Overview, type Readiness as ReadinessT, type Stage } from "@/lib/types";

// Nomes curtos para telas estreitas (seis colunas em 390 px não comportam o nome inteiro).
const CURTO: Record<Stage, string> = { contatado: "Contato", respondeu: "Resposta", qualificado: "Qualif.", reuniao: "Reunião", compareceu: "Presença", venda: "Venda" };

const actorTone: Record<string, string> = { agent: "bg-ok", human: "bg-ink", system: "bg-mute" };
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
    <figure className="m-0">
      <div className="flex h-36 gap-1 sm:gap-1.5" role="img" aria-label={`Contatos e qualificados por dia: ${rows.map((r) => `${r.dia}, ${r.c} contatos, ${r.q} qualificados`).join("; ")}`}>
        {rows.map((d) => (
          <div key={d.dia} className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1" title={`${d.dia}: ${d.c} contatos, ${d.q} qualificados`}>
            <div className="relative flex w-full flex-1 items-end">
              <div className="w-full rounded-t-[2px] bg-ink/15" style={{ height: `${(d.c / max) * 100}%` }}>
                <div className="w-full rounded-t-[2px] bg-sinal" style={{ height: `${d.c ? (d.q / d.c) * 100 : 0}%` }} />
              </div>
            </div>
            <span className="tabular max-w-full truncate font-mono text-[10px] text-mute">{d.dia.slice(0, 5)}</span>
          </div>
        ))}
      </div>
      <figcaption className="mt-3 flex gap-5 text-xs text-mute">
        <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-[2px] bg-ink/15" /> Contatos</span>
        <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-[2px] bg-sinal" /> Qualificados</span>
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
                  <span className="tabular font-mono font-medium">{rate === null ? "sem dados" : `${pct(rate)} aproveitáveis`}</span>
                </div>
                <div className="h-1.5 bg-ink/10" role="progressbar" aria-label={`Rascunhos aproveitáveis em ${name}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={rate === null ? undefined : Math.round(rate * 100)}>
                  <div className="h-full bg-ok" style={{ width: `${(rate ?? 0) * 100}%` }} />
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

const countFmt = (n: number) => num(Math.round(n));

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
        <div className="rise mb-6 max-w-xl">
          <div className="mb-1.5 flex justify-between font-mono text-[11px] uppercase tracking-wider text-mute">
            <span>Início do piloto</span>
            <span>Decisão · dia {pd.total}</span>
          </div>
          <div className="h-1 bg-line" role="progressbar" aria-valuenow={pd.day} aria-valuemin={0} aria-valuemax={pd.total} aria-label="Progresso do piloto">
            <div className="h-full bg-sinal" style={{ width: `${(pd.day / pd.total) * 100}%` }} />
          </div>
        </div>
      )}

      <div className="mb-8"><RangePicker value={range} onChange={setRange} /></div>

      <div className="grid gap-x-14 gap-y-12 xl:grid-cols-[minmax(0,1fr)_340px]">
        {/* Coluna principal: a manchete e o funil */}
        <div className="min-w-0 space-y-12">
          <QueryBlock q={ov} skeleton={<Skeleton className="h-44" />}>
            {(d) => {
              const f = funnelOf(d);
              return (
                <Manchete
                  label="Reuniões marcadas pelo agente"
                  caption={<>{num(f.compareceu)} já compareceram. {pct(ratio(f.qualificado, f.respondeu))} de quem respondeu foi qualificado.</>}
                >
                  <CountUp value={f.reuniao} format={countFmt} />
                </Manchete>
              );
            }}
          </QueryBlock>

          <Folio n="01" title="Funil do piloto" hint="Quantos leads chegaram em cada etapa. A altura é proporcional ao total, a partir de zero.">
            <QueryBlock q={ov} skeleton={<Skeleton className="h-72" />} isEmpty={(d) => toNum(d.funnel?.contatado) === 0} empty={<EmptyState title="Nenhum lead ainda">Quando o agente começar a contatar pessoas, o funil aparece aqui. Tente também ampliar o período.</EmptyState>}>
              {(d) => {
                const f = funnelOf(d);
                return (
                  <>
                    <PulseFunnel rows={STAGES.map((s) => ({ key: s, nome: STAGE_META[s].nome, curto: CURTO[s], v: f[s] }))} />
                    <p className="mt-4 text-sm text-mute">De {num(f.contatado)} contatos, {pct(ratio(f.venda, f.contatado))} viraram venda.</p>
                  </>
                );
              }}
            </QueryBlock>
          </Folio>

          <Folio n="02" title="Contatos por dia" hint="A parte coral são os leads que chegaram a qualificados.">
            <QueryBlock q={ov} skeleton={<Skeleton className="h-44" />} isEmpty={(d) => !d.series?.length} empty={<EmptyState title="Nenhum lead ainda">Sem contatos no período selecionado.</EmptyState>}>
              {(d) => <DailyBars series={d.series} />}
            </QueryBlock>
          </Folio>
        </div>

        {/* Marginália: números de apoio, atividade e aprendizado */}
        <aside className="min-w-0 space-y-10" aria-label="Números de apoio">
          <QueryBlock q={ov} skeleton={<Skeleton className="h-64" />}>
            {(d) => {
              const f = funnelOf(d);
              const invest = toNum(d.investido);
              const receita = toNum(d.receita);
              const cpq = perUnit(invest, f.qualificado);
              return (
                <Marginalia
                  items={[
                    { label: "Leads qualificados", value: num(f.qualificado), sub: `${pct(ratio(f.qualificado, f.respondeu))} de quem respondeu`, tip: "Leads com perfil para a redução do plano, segundo o playbook." },
                    { label: "Custo por qualificado", value: cpq === null || invest === 0 ? "—" : money(cpq), sub: invest > 0 ? `Investido ${money(invest)}` : "Sem investimento registrado", tip: "Investimento em anúncios dividido pelos qualificados." },
                    { label: "Vendas pelo agente", value: num(f.venda), sub: `${money(receita)} vendidos`, tone: f.venda > 0 ? "ok" : undefined, tip: "Base dos 30% da proposta. A regra de atribuição será fechada em contrato." },
                    { label: "Responderam", value: num(f.respondeu), sub: `${pct(ratio(f.respondeu, f.contatado))} dos contatados` },
                  ]}
                />
              );
            }}
          </QueryBlock>

          <section aria-labelledby="atividade" className="border-t border-line pt-5">
            <h2 id="atividade" className="mb-3 font-display text-xl">Atividade do agente</h2>
            <QueryBlock q={ov} skeleton={<Skeleton className="h-64" />} isEmpty={(d) => !d.activity?.length} empty={<EmptyState title="Sem atividade no período" />}>
              {(d) => (
                <ul className="space-y-3">
                  {d.activity.map((a, i) => (
                    <li key={`${a.hora}-${i}`} className="grid grid-cols-[40px_10px_1fr] items-start gap-2 text-sm">
                      <span className="tabular pt-px font-mono text-xs text-mute">{a.hora}</span>
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
          </section>

          <section aria-labelledby="sombra" className="border-t border-line pt-5">
            <h2 id="sombra" className="mb-1 font-display text-xl">Aprendizado em modo sombra</h2>
            <p className="mb-3 text-sm text-mute">Quanto dos rascunhos a equipe aproveitaria como estão.</p>
            <QueryBlock q={rd} skeleton={<Skeleton className="h-40" />}>{(r) => <ReadinessView r={r} />}</QueryBlock>
          </section>
        </aside>
      </div>
    </>
  );
}
