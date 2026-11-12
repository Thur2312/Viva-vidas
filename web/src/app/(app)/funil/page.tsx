"use client";

import { Eye, EyeOff, Search } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState, ErrorState, Skeleton } from "@/components/Block";
import { LeadDrawer } from "@/components/LeadDrawer";
import { usePrivacy } from "@/components/Providers";
import { RangePicker } from "@/components/RangePicker";
import { PageHeader, ScoreDot } from "@/components/ui";
import { useCampaigns, useOverview, useStageLeads } from "@/lib/hooks";
import { useRangeState } from "@/lib/range";
import { num, pct, ratio, relTime } from "@/lib/format";
import { STAGES, STAGE_META, toNum, type LeadRow, type Stage } from "@/lib/types";

function useDebounced<T>(v: T, ms: number) {
  const [d, setD] = useState(v);
  useEffect(() => {
    const t = setTimeout(() => setD(v), ms);
    return () => clearTimeout(t);
  }, [v, ms]);
  return d;
}

function LeadCard({ l, hide, onOpen }: { l: LeadRow; hide: boolean; onOpen: (id: string) => void }) {
  return (
    <li>
      <button type="button" onClick={() => onOpen(l.id)} aria-haspopup="dialog" className="block min-h-[44px] w-full rounded-xl border border-line bg-card p-4 text-left transition-shadow hover:shadow-md">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate font-semibold leading-tight">{l.name || "Sem nome"}</p>
            <p className="tabular text-xs text-mute">{l.phone ?? ""}</p>
          </div>
          {l.score !== null && l.score !== undefined && <ScoreDot score={toNum(l.score)} />}
        </div>
        {l.last_message && <p className={`mt-2 line-clamp-2 text-sm ${hide ? "sensitive" : ""}`}>{l.last_message}</p>}
        {l.opt_out && <p className="mt-2 inline-block rounded-full bg-bad/15 px-2 py-0.5 text-xs font-semibold text-bad">Não contatar</p>}
        <div className="mt-3 flex items-center justify-between gap-2 text-xs text-mute">
          <span className="truncate rounded-full bg-deep/[0.06] px-2 py-0.5 dark:bg-white/10" title={l.source ?? undefined}>{l.source ?? "Origem não informada"}</span>
          <span className="shrink-0">{relTime(l.last_at ?? l.created_at)}</span>
        </div>
      </button>
    </li>
  );
}

function StageColumn({
  stage, total, prevTotal, search, campaignId, hide, onOpen, visibleMobile,
}: { stage: Stage; total: number | null; prevTotal: number | null; search: string; campaignId: string; hide: boolean; onOpen: (id: string) => void; visibleMobile: boolean }) {
  const q = useStageLeads({ stage, search, campaignId });
  const rows = useMemo(() => q.data?.pages.flatMap((p) => p.data) ?? [], [q.data]);
  const totalItems = q.data?.pages[0]?.meta.totalItems;
  const last = stage === "venda";

  return (
    <section id={`col-${stage}`} aria-labelledby={`h-${stage}`} className={`w-full shrink-0 md:w-72 ${visibleMobile ? "" : "hidden md:block"}`}>
      <div className={`mb-3 rounded-xl px-4 py-3 ${last ? "bg-brand text-deep" : "bg-deep text-white dark:bg-[#12306a]"}`}>
        <div className="flex items-baseline justify-between gap-2">
          <h2 id={`h-${stage}`} className="text-sm font-semibold">{STAGE_META[stage].nome}</h2>
          <span className="tabular font-display text-2xl font-semibold" aria-label={total === null ? "total indisponível" : `${total} no período`}>{total === null ? "—" : num(total)}</span>
        </div>
        <p className={`text-xs ${last ? "text-deep/80" : "text-white/75"}`}>
          {prevTotal === null || total === null
            ? STAGE_META[stage].dica
            : prevTotal === 0 ? "Sem base na etapa anterior" : `${pct(ratio(total, prevTotal))} da etapa anterior`}
        </p>
      </div>

      <div aria-busy={q.isFetching} className={q.isFetching && !q.isPending ? "opacity-60 transition-opacity" : ""}>
        {q.isPending && <div className="space-y-3"><Skeleton className="h-24" /><Skeleton className="h-24" /></div>}
        {q.isError && rows.length === 0 && <ErrorState error={q.error} onRetry={() => q.refetch()} compact />}
        {!q.isPending && !q.isError && rows.length === 0 && (
          <p className="rounded-xl border border-dashed border-line p-4 text-sm text-mute">
            {search || campaignId ? "Nenhum lead com esses filtros." : "Nenhum lead nesta etapa."}
          </p>
        )}
        {rows.length > 0 && (
          <ul className="space-y-3" aria-label={`Leads em ${STAGE_META[stage].nome}`}>
            {rows.map((l) => <LeadCard key={l.id} l={l} hide={hide} onOpen={onOpen} />)}
          </ul>
        )}
        {q.hasNextPage && (
          <button type="button" disabled={q.isFetchingNextPage} onClick={() => q.fetchNextPage()} className="mt-3 min-h-[44px] w-full rounded-full border border-line bg-card px-4 text-sm font-semibold hover:bg-ink/5 disabled:opacity-60">
            {q.isFetchingNextPage ? "Carregando…" : `Carregar mais${totalItems ? ` (${rows.length} de ${num(totalItems)})` : ""}`}
          </button>
        )}
        {q.isFetchNextPageError && <p role="alert" className="mt-2 text-xs text-bad">Não foi possível carregar mais. Tente de novo.</p>}
      </div>
    </section>
  );
}

function FunilInner() {
  const router = useRouter();
  const params = useSearchParams();
  const leadId = params.get("leadId");
  const [range, setRange] = useRangeState("30d");
  const ov = useOverview(range);
  const campaigns = useCampaigns(range);
  const { hide, setHide } = usePrivacy();
  const [searchInput, setSearchInput] = useState("");
  const search = useDebounced(searchInput.trim(), 400);
  const [campaign, setCampaign] = useState("");
  const [mobile, setMobile] = useState<Stage>("contatado");

  const open = useCallback((id: string) => router.replace(`/funil?leadId=${encodeURIComponent(id)}`, { scroll: false }), [router]);
  const close = useCallback(() => router.replace("/funil", { scroll: false }), [router]);

  const totals = ov.data ? (Object.fromEntries(STAGES.map((s) => [s, toNum(ov.data.funnel?.[s])])) as Record<Stage, number>) : null;

  return (
    <>
      <PageHeader eyebrow="Funil" title="Leads por etapa">
        Os números no topo de cada coluna são do período escolhido, com a conversão sobre a etapa anterior. Os cartões são os leads mais recentes de cada etapa.
      </PageHeader>

      <div className="mb-4"><RangePicker value={range} onChange={setRange} /></div>

      <div className="mb-5 flex flex-wrap items-end gap-3">
        <div className="min-w-[220px] flex-1 sm:max-w-sm">
          <label htmlFor="busca" className="mb-1 block text-xs font-medium text-mute">Buscar lead</label>
          <div className="relative">
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-mute" aria-hidden="true" />
            <input id="busca" type="search" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} placeholder="Nome ou telefone" autoComplete="off" className="min-h-[44px] w-full rounded-lg border border-line bg-card pl-9 pr-3 text-sm" />
          </div>
        </div>
        <div>
          <label htmlFor="camp" className="mb-1 block text-xs font-medium text-mute">Campanha</label>
          <select id="camp" value={campaign} onChange={(e) => setCampaign(e.target.value)} className="min-h-[44px] rounded-lg border border-line bg-card px-3 text-sm">
            <option value="">Todas</option>
            {campaigns.data?.map((c) => <option key={c.campaign_id} value={c.campaign_id}>{c.nome}</option>)}
          </select>
        </div>
        <button type="button" aria-pressed={hide} onClick={() => setHide(!hide)} className="inline-flex min-h-[44px] items-center gap-2 rounded-full border border-line bg-card px-4 text-sm font-medium hover:bg-ink/5">
          {hide ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
          Ocultar dados sensíveis: {hide ? "ligado" : "desligado"}
        </button>
      </div>

      {ov.isError && !ov.data && <div className="mb-5"><ErrorState error={ov.error} onRetry={() => ov.refetch()} /></div>}
      {totals && totals.contatado === 0 && (
        <div className="mb-5"><EmptyState title="Nenhum lead ainda">Não há leads neste período. Os cartões abaixo mostram os mais recentes de cada etapa, se houver.</EmptyState></div>
      )}

      {/* Seletor de etapa no celular */}
      <div role="tablist" aria-label="Etapas do funil" className="-mx-1 mb-4 flex gap-2 overflow-x-auto px-1 pb-1 md:hidden">
        {STAGES.map((s) => (
          <button key={s} role="tab" type="button" aria-selected={mobile === s} aria-controls={`col-${s}`} onClick={() => setMobile(s)} className={`inline-flex min-h-[44px] shrink-0 items-center gap-2 rounded-full border px-4 text-sm font-medium ${mobile === s ? "border-deep bg-deep text-white dark:border-brand dark:bg-brand dark:text-deep" : "border-line bg-card"}`}>
            {STAGE_META[s].nome}
            <span className="tabular text-xs opacity-80">{totals ? num(totals[s]) : "—"}</span>
          </button>
        ))}
      </div>

      <div className="-mx-4 overflow-x-auto px-4 pb-4 sm:-mx-8 sm:px-8 lg:-mx-10 lg:px-10">
        <div className="flex gap-4 md:min-w-max">
          {STAGES.map((s, i) => (
            <StageColumn
              key={s}
              stage={s}
              total={totals ? totals[s] : null}
              prevTotal={totals && i > 0 ? totals[STAGES[i - 1]] : null}
              search={search}
              campaignId={campaign}
              hide={hide}
              onOpen={open}
              visibleMobile={mobile === s}
            />
          ))}
        </div>
      </div>

      {leadId && <LeadDrawer leadId={leadId} onClose={close} />}
    </>
  );
}

export default function Funil() {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <FunilInner />
    </Suspense>
  );
}
