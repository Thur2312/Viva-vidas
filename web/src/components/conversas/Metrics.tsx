"use client";

import { Clock, MessagesSquare, Reply, Sparkles } from "lucide-react";
import { EmptyState, QueryBlock, Skeleton } from "../Block";
import { KpiCard, Panel } from "../ui";
import { useConversationStats } from "@/lib/hooks";
import { num, pct } from "@/lib/format";
import { STAGE_META, type ConversationStats } from "@/lib/types";
import type { Range } from "@/lib/range";
import { duration } from "./common";

const SERIES = [
  { key: "leads_in", label: "Cliente", cls: "text-deep dark:text-[#6f9be0]", dot: "bg-deep dark:bg-[#6f9be0]" },
  { key: "humano_out", label: "Equipe", cls: "text-brand", dot: "bg-brand" },
  { key: "agente_out", label: "Agente", cls: "text-ok", dot: "bg-ok" },
] as const;

const shortDay = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

/** Barras empilhadas por dia (SVG puro): cliente, equipe e agente. */
function DailyChart({ rows }: { rows: ConversationStats["mensagens"] }) {
  const W = 640, H = 190, padL = 30, padB = 22, padT = 8;
  const totals = rows.map((r) => r.leads_in + r.humano_out + r.agente_out);
  const max = Math.max(1, ...totals);
  const slot = (W - padL) / Math.max(1, rows.length);
  const bw = Math.min(28, slot * 0.7);
  const ch = H - padB - padT;
  const every = Math.max(1, Math.ceil(rows.length / 8));
  const summary = rows.map((r) => `${shortDay(r.dia)}: ${r.leads_in} do cliente, ${r.humano_out} da equipe, ${r.agente_out} do agente`).join("; ");
  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`Mensagens por dia. ${summary}`}>
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={padL} x2={W} y1={padT + ch * (1 - f)} y2={padT + ch * (1 - f)} className="stroke-line" strokeDasharray={f === 0 ? undefined : "3 4"} />
            <text x={padL - 6} y={padT + ch * (1 - f) + 4} textAnchor="end" className="fill-mute text-[10px]">{Math.round(max * f)}</text>
          </g>
        ))}
        {rows.map((r, i) => {
          const x = padL + slot * i + (slot - bw) / 2;
          let y = padT + ch;
          return (
            <g key={r.dia}>
              <title>{`${shortDay(r.dia)}: ${r.leads_in} cliente, ${r.humano_out} equipe, ${r.agente_out} agente`}</title>
              {SERIES.map((s) => {
                const v = r[s.key];
                if (!v) return null;
                const h = (v / max) * ch;
                y -= h;
                return <rect key={s.key} x={x} y={y} width={bw} height={Math.max(1.5, h)} rx={2} className={`${s.cls} fill-current`} />;
              })}
              {i % every === 0 && <text x={x + bw / 2} y={H - 6} textAnchor="middle" className="fill-mute text-[10px]">{shortDay(r.dia)}</text>}
            </g>
          );
        })}
      </svg>
      <figcaption className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-mute">
        {SERIES.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1.5"><span className={`h-2.5 w-2.5 rounded-sm ${s.dot}`} aria-hidden="true" />{s.label}</span>
        ))}
      </figcaption>
    </figure>
  );
}

function PeakHours({ rows }: { rows: ConversationStats["horarios_pico"] }) {
  const max = Math.max(1, ...rows.map((r) => r.mensagens));
  const peak = rows.reduce((a, b) => (b.mensagens > a.mensagens ? b : a), rows[0]);
  return (
    <figure>
      <div className="flex h-32 items-end gap-[3px]" role="img" aria-label={`Mensagens por hora do dia (horário de Brasília). ${rows.map((r) => `${r.hora}h: ${r.mensagens}`).join("; ")}`}>
        {rows.map((r) => (
          <div key={r.hora} title={`${r.hora}h: ${r.mensagens} mensagens`} className="flex h-full min-w-0 flex-1 items-end">
            <div className={`w-full rounded-t ${r.hora === peak?.hora && r.mensagens > 0 ? "bg-brand" : "bg-deep/70 dark:bg-[#6f9be0]/70"}`} style={{ height: `${Math.max(r.mensagens ? 4 : 1, (r.mensagens / max) * 100)}%` }} />
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-mute" aria-hidden="true"><span>0h</span><span>6h</span><span>12h</span><span>18h</span><span>23h</span></div>
      <figcaption className="mt-2 text-xs text-mute">{peak && peak.mensagens > 0 ? `Pico às ${peak.hora}h, com ${num(peak.mensagens)} mensagens. Horário de Brasília.` : "Horário de Brasília."}</figcaption>
    </figure>
  );
}

const DRAFT_PARTS = [
  { key: "igual", label: "Igual", cls: "bg-ok" },
  { key: "editou", label: "Editou", cls: "bg-brand" },
  { key: "diferente", label: "Diferente", cls: "bg-bad" },
  { key: "ignorou", label: "Ignorou", cls: "bg-mute" },
] as const;

function DraftAgreement({ d }: { d: ConversationStats["rascunhos"] }) {
  const n = d.comparados;
  return (
    <div>
      <div className="flex h-5 overflow-hidden rounded-full bg-deep/[0.08] dark:bg-white/15" role="img" aria-label={`Rascunhos comparados: ${DRAFT_PARTS.map((p) => `${d[p.key]} ${p.label.toLowerCase()}`).join(", ")}`}>
        {n > 0 && DRAFT_PARTS.map((p) => (d[p.key] ? <div key={p.key} className={p.cls} style={{ width: `${(d[p.key] / n) * 100}%` }} title={`${p.label}: ${d[p.key]}`} /> : null))}
      </div>
      <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
        {DRAFT_PARTS.map((p) => (
          <li key={p.key} className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5"><span className={`h-2.5 w-2.5 rounded-sm ${p.cls}`} aria-hidden="true" />{p.label}</span>
            <span className="tabular font-semibold">{num(d[p.key])}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-mute">{num(n)} comparados de {num(d.total)} rascunhos no período. Aproveitável = igual ou editado.</p>
    </div>
  );
}

export function ConversationMetrics({ range }: { range: Range }) {
  const q = useConversationStats(range);
  const sk = <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-28" />)}</div>;
  const empty = (d: ConversationStats) => d.mensagens.every((m) => m.leads_in + m.humano_out + m.agente_out === 0) && d.conversas_ativas === 0;
  return (
    <div className="space-y-6">
      <QueryBlock q={q} skeleton={sk}>
        {(d) => (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard variant="primary" title="Conversas ativas" value={num(d.conversas_ativas)} icon={<MessagesSquare size={18} />} sub={`${num(d.conversas_novas)} novas no período`} tip="Conversas com pelo menos uma mensagem no período." />
            <KpiCard title="Taxa de resposta" value={d.taxa_resposta_lead === null ? "—" : pct(d.taxa_resposta_lead)} icon={<Reply size={18} />} sub={d.taxa_resposta_equipe == null ? "Sem contatos no período" : `Equipe respondeu ${pct(d.taxa_resposta_equipe)} dos clientes`} tip="De quem a equipe ou o agente contatou no período, quantos responderam depois. Traço quando não houve contato." />
            <KpiCard title="1ª resposta da equipe" value={duration(d.tempo_primeira_resposta_humano_seg.p50)} icon={<Clock size={18} />} sub={`p90 ${duration(d.tempo_primeira_resposta_humano_seg.p90)}${d.tempo_primeira_resposta_humano_seg.amostra ? ` · ${d.tempo_primeira_resposta_humano_seg.amostra} conversas` : ""}`} tip="Mediana (p50) do tempo entre a primeira mensagem do cliente e a primeira resposta humana. O p90 mostra os casos mais lentos: 9 em cada 10 respostas saem antes disso." />
            <KpiCard variant="success" title="Rascunhos aproveitáveis" value={d.rascunhos.usable_rate === null ? "—" : pct(d.rascunhos.usable_rate)} icon={<Sparkles size={18} />} sub={`${num(d.rascunhos.comparados)} comparados com a equipe`} tip="Rascunhos do agente que a equipe enviou iguais ou com pequena edição, entre os já comparados com uma resposta humana." />
          </div>
        )}
      </QueryBlock>

      <div className="grid gap-6 xl:grid-cols-5">
        <Panel className="rise xl:col-span-3" title="Mensagens por dia" hint="Quem escreveu, dia a dia (horário de Brasília).">
          <QueryBlock q={q} skeleton={<Skeleton className="h-52" />} isEmpty={empty} empty={<EmptyState title="Sem mensagens no período">Nenhuma conversa aconteceu nestas datas. Tente ampliar o período.</EmptyState>}>
            {(d) => <DailyChart rows={d.mensagens} />}
          </QueryBlock>
        </Panel>
        <Panel className="rise xl:col-span-2" title="Horários de pico" hint="Em que hora do dia chegam e saem mais mensagens.">
          <QueryBlock q={q} skeleton={<Skeleton className="h-44" />} isEmpty={empty} empty={<EmptyState title="Sem mensagens no período" />}>
            {(d) => <PeakHours rows={d.horarios_pico} />}
          </QueryBlock>
        </Panel>
      </div>

      <div className="grid gap-6 xl:grid-cols-5">
        <Panel className="rise xl:col-span-2" title="Rascunhos do agente × equipe" hint="O que a equipe fez com cada rascunho.">
          <QueryBlock q={q} skeleton={<Skeleton className="h-40" />} isEmpty={(d) => d.rascunhos.total === 0} empty={<EmptyState title="Sem rascunhos no período">O agente ainda não escreveu rascunhos nestas datas.</EmptyState>}>
            {(d) => <DraftAgreement d={d.rascunhos} />}
          </QueryBlock>
        </Panel>
        <Panel className="rise xl:col-span-3" title="Tempo e etapas" hint="Resposta por turno e onde estão as conversas ativas.">
          <QueryBlock q={q} skeleton={<Skeleton className="h-40" />}>
            {(d) => (
              <div className="grid gap-6 sm:grid-cols-2">
                <dl className="space-y-2 text-sm">
                  <div className="flex justify-between gap-3"><dt className="text-mute">Resposta da equipe, mediana</dt><dd className="tabular font-semibold">{duration(d.tempo_resposta_humano_seg.p50)}</dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-mute">Resposta da equipe, p90</dt><dd className="tabular font-semibold">{duration(d.tempo_resposta_humano_seg.p90)}</dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-mute">1ª resposta, média</dt><dd className="tabular font-semibold">{duration(d.tempo_primeira_resposta_humano_seg.media)}</dd></div>
                  {d.handoffs !== undefined && <div className="flex justify-between gap-3"><dt className="text-mute">Repasses para humano</dt><dd className="tabular font-semibold">{num(d.handoffs)}</dd></div>}
                </dl>
                {d.por_etapa.length === 0 ? (
                  <p className="text-sm text-mute">Nenhuma conversa ativa no período.</p>
                ) : (
                  <ul className="space-y-1.5 text-sm">
                    {d.por_etapa.map((e) => (
                      <li key={e.stage} className="flex justify-between gap-3"><span>{STAGE_META[e.stage as keyof typeof STAGE_META]?.nome ?? e.stage}</span><span className="tabular font-semibold">{num(e.conversas)}</span></li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </QueryBlock>
        </Panel>
      </div>
    </div>
  );
}
