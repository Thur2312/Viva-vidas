"use client";

import { Loader2, MessageSquareDashed, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { EmptyState, ErrorState, Skeleton } from "../Block";
import { usePrivacy } from "../Providers";
import { useConversations } from "@/lib/hooks";
import { relTime } from "@/lib/format";
import { STAGES, STAGE_META, type ConversationRow } from "@/lib/types";
import { AUTHOR, MODE_LABEL, PrivacyToggle } from "./common";

function useDebounced<T>(v: T, ms: number) {
  const [d, setD] = useState(v);
  useEffect(() => {
    const t = setTimeout(() => setD(v), ms);
    return () => clearTimeout(t);
  }, [v, ms]);
  return d;
}

const select = "min-h-[44px] min-w-0 flex-1 rounded-lg border border-line bg-card px-2 text-sm";

function Row({ c, active, hide, onOpen }: { c: ConversationRow; active: boolean; hide: boolean; onOpen: (id: string) => void }) {
  const name = c.lead_name || "Sem nome";
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(c.id)}
        aria-current={active ? "true" : undefined}
        className={`flex min-h-[44px] w-full gap-3 border-b border-line px-4 py-3 text-left transition-colors hover:bg-ink/[0.04] ${active ? "bg-brand/10 shadow-[inset_3px_0_0_rgb(var(--brand))]" : ""}`}
      >
        <span aria-hidden="true" className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-deep text-sm font-bold text-white dark:bg-[#1d4380]">
          {name.trim()[0]?.toUpperCase() ?? "?"}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-2">
            <span className={`truncate text-sm ${c.unread_for_human ? "font-bold" : "font-semibold"} ${hide ? "sensitive" : ""}`}>{name}</span>
            <span className="shrink-0 text-xs text-mute">{relTime(c.last_at)}</span>
          </span>
          <span className={`tabular block text-xs text-mute ${hide ? "sensitive" : ""}`}>{c.phone ?? ""}</span>
          <span className={`mt-0.5 block truncate text-sm ${c.unread_for_human ? "text-ink" : "text-mute"} ${hide ? "sensitive" : ""}`}>
            {c.last_message_preview ? (
              <><span className="font-medium">{c.last_author ? `${AUTHOR[c.last_author]}: ` : ""}</span>{c.last_message_preview}</>
            ) : (
              "Sem mensagens"
            )}
          </span>
          <span className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] font-semibold">
            <span className="rounded-full bg-ink/[0.07] px-2 py-0.5 text-mute">{STAGE_META[c.stage as keyof typeof STAGE_META]?.nome ?? c.stage}</span>
            <span className="rounded-full bg-ink/[0.07] px-2 py-0.5 text-mute">{MODE_LABEL[c.mode] ?? c.mode}</span>
            {c.unread_for_human && <span className="rounded-full bg-brand/25 px-2 py-0.5 text-brand-ink">Aguardando resposta</span>}
            {c.has_pending_draft && <span className="rounded-full border border-dashed border-brand/70 px-2 py-0.5 text-brand-ink">Rascunho do agente</span>}
          </span>
        </span>
      </button>
    </li>
  );
}

export function ConversationList({ activeId, onOpen }: { activeId: string | null; onOpen: (id: string) => void }) {
  const { hide } = usePrivacy();
  const [search, setSearch] = useState("");
  const [mode, setMode] = useState("");
  const [stage, setStage] = useState("");
  const [status, setStatus] = useState("");
  const dSearch = useDebounced(search.trim(), 350);
  const q = useConversations({ search: dSearch || undefined, mode: mode || undefined, stage: stage || undefined, status: status || undefined });
  const rows = useMemo(() => q.data?.pages.flatMap((p) => p.data) ?? [], [q.data]);
  const total = q.data?.pages[0]?.meta.totalItems ?? 0;
  const sentinel = useRef<HTMLLIElement>(null);

  // Carrega a próxima página ao chegar no fim da lista (o botão abaixo segue como alternativa por teclado).
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !q.hasNextPage) return;
    const io = new IntersectionObserver((e) => {
      if (e[0]?.isIntersecting && !q.isFetchingNextPage) void q.fetchNextPage();
    });
    io.observe(el);
    return () => io.disconnect();
  }, [q.hasNextPage, q.isFetchingNextPage, q.fetchNextPage, rows.length]);

  const filtered = !!(dSearch || mode || stage || status);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="space-y-2 border-b border-line p-3">
        <div className="flex items-center gap-1">
          <div className="relative flex-1">
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-mute" aria-hidden="true" />
            <label htmlFor="conv-busca" className="sr-only">Buscar por nome ou telefone</label>
            <input id="conv-busca" type="search" value={search} onChange={(e) => setSearch(e.target.value)} maxLength={80} placeholder="Buscar por nome ou telefone" className="min-h-[44px] w-full rounded-lg border border-line bg-card pl-9 pr-3 text-sm" />
          </div>
          <PrivacyToggle />
        </div>
        <div className="flex gap-2">
          <label className="sr-only" htmlFor="conv-status">Situação</label>
          <select id="conv-status" value={status} onChange={(e) => setStatus(e.target.value)} className={select}>
            <option value="">Todas</option>
            <option value="aguardando">Aguardando resposta</option>
            <option value="respondida">Respondidas</option>
            <option value="rascunho">Com rascunho do agente</option>
          </select>
          <label className="sr-only" htmlFor="conv-modo">Modo do agente</label>
          <select id="conv-modo" value={mode} onChange={(e) => setMode(e.target.value)} className={select}>
            <option value="">Todos os modos</option>
            <option value="shadow">Sombra</option>
            <option value="assisted">Assistido</option>
            <option value="auto">Automático</option>
          </select>
        </div>
        <label className="sr-only" htmlFor="conv-etapa">Etapa do funil</label>
        <select id="conv-etapa" value={stage} onChange={(e) => setStage(e.target.value)} className={`${select} w-full`}>
          <option value="">Todas as etapas</option>
          {STAGES.map((s) => <option key={s} value={s}>{STAGE_META[s].nome}</option>)}
          <option value="perdido">Perdido</option>
        </select>
        <p role="status" className="text-xs text-mute">{q.isSuccess ? `${total.toLocaleString("pt-BR")} ${total === 1 ? "conversa" : "conversas"}` : " "}</p>
      </div>

      <div className={`min-h-0 flex-1 overflow-y-auto transition-opacity ${q.isFetching && !q.isPending && !q.isFetchingNextPage ? "opacity-60" : ""}`} aria-busy={q.isFetching}>
        {q.isPending && <div className="space-y-2 p-3">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-20" />)}</div>}
        {q.isError && rows.length === 0 && <div className="p-3"><ErrorState error={q.error} onRetry={() => q.refetch()} compact /></div>}
        {q.isSuccess && rows.length === 0 && (
          <div className="p-4">
            <EmptyState title={filtered ? "Nenhuma conversa com esses filtros" : "Nenhuma conversa ainda"}>
              {filtered ? "Ajuste a busca ou os filtros." : "Quando um cliente escrever, a conversa aparece aqui."}
            </EmptyState>
          </div>
        )}
        {rows.length > 0 && (
          <ul aria-label="Conversas">
            {rows.map((c) => <Row key={c.id} c={c} active={c.id === activeId} hide={hide} onOpen={onOpen} />)}
            <li ref={sentinel} className="p-3 text-center">
              {q.hasNextPage ? (
                <button type="button" onClick={() => void q.fetchNextPage()} disabled={q.isFetchingNextPage} className="inline-flex min-h-[44px] items-center gap-2 rounded-full border border-line bg-card px-4 text-sm font-semibold hover:bg-ink/5">
                  {q.isFetchingNextPage && <Loader2 size={15} className="animate-spin" aria-hidden="true" />}
                  Carregar mais
                </button>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-xs text-mute"><MessageSquareDashed size={14} aria-hidden="true" /> Fim da lista</span>
              )}
            </li>
          </ul>
        )}
      </div>
    </div>
  );
}
