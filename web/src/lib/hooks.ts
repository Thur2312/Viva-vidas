"use client";
import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { ApiError, getJson } from "./client";
import { DEMO } from "./flags";
import * as demo from "./demo";
import type { Range } from "./range";
import { postMessage, SendError } from "./conversas-api";
import type { CampaignRow, ConversationStats, ConversationsPage, LeadDetail, LeadsPage, Me, Overview, Readiness, ThreadMessage, ThreadPage } from "./types";
// Chamadas do playbook (com o modo demonstração embutido) vivem junto do editor.
import { activatePlaybook, fetchPlaybook, fetchPlaybookVersion, savePlaybook, type SaveInput } from "@/components/agente/playbook-api";

const qs = (o: Record<string, string | number | undefined>) =>
  new URLSearchParams(Object.entries(o).filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => [k, String(v)])).toString();

export const PAGE_SIZE = 20;

export function useMe() {
  return useQuery({
    queryKey: ["me"],
    queryFn: ({ signal }) => (DEMO ? Promise.resolve(demo.demoMe) : getJson<Me>("/api/auth/me", signal)),
    staleTime: 15 * 60_000,
  });
}

export function useOverview(r: Range) {
  return useQuery({
    queryKey: ["overview", r.from, r.to],
    queryFn: ({ signal }) => (DEMO ? demo.demoOverview() : getJson<Overview>(`/api/pilot/overview?${qs({ from: r.from, to: r.to })}`, signal)),
    placeholderData: keepPreviousData,
  });
}

export function useCampaigns(r: Range) {
  return useQuery({
    queryKey: ["campaigns", r.from, r.to],
    queryFn: ({ signal }) => (DEMO ? demo.demoCampaigns() : getJson<CampaignRow[]>(`/api/pilot/campaigns?${qs({ from: r.from, to: r.to })}`, signal)),
    placeholderData: keepPreviousData,
  });
}

export function useReadiness() {
  return useQuery({
    queryKey: ["readiness"],
    queryFn: ({ signal }) => (DEMO ? demo.demoReadiness() : getJson<Readiness>("/api/pilot/readiness", signal)),
  });
}

export function useStageLeads(f: { stage: string; search: string; campaignId: string }) {
  return useInfiniteQuery({
    queryKey: ["leads", f.stage, f.search, f.campaignId],
    initialPageParam: 1,
    queryFn: ({ pageParam, signal }) =>
      DEMO
        ? demo.demoLeads({ stage: f.stage, search: f.search, page: pageParam, pageSize: PAGE_SIZE })
        : getJson<LeadsPage>(`/api/pilot/leads?${qs({ stage: f.stage, search: f.search, campaignId: f.campaignId, page: pageParam, pageSize: PAGE_SIZE })}`, signal),
    getNextPageParam: (last) => (last.meta.page < last.meta.totalPages ? last.meta.page + 1 : undefined),
    placeholderData: keepPreviousData,
  });
}

export function useLead(id: string | null) {
  return useQuery({
    queryKey: ["lead", id],
    enabled: !!id,
    queryFn: ({ signal }) => (DEMO ? demo.demoLead(id!) : getJson<LeadDetail>(`/api/pilot/leads/${encodeURIComponent(id!)}`, signal)),
  });
}

/** 1 nova tentativa, nunca em erro de sessão ou de cliente (4xx). */
export const shouldRetry = (count: number, err: unknown) => count < 1 && !(err instanceof ApiError && err.status >= 400 && err.status < 500);

// ───── Conversas ─────
export const CONV_PAGE_SIZE = 20;
export const THREAD_POLL_MS = 15_000;
const EMPTY_STATS: ConversationStats = {
  periodo: { from: "", to: "" }, mensagens: [], conversas_ativas: 0, conversas_novas: 0, taxa_resposta_lead: null,
  tempo_primeira_resposta_humano_seg: { p50: null, p90: null, media: null }, tempo_resposta_humano_seg: { p50: null, p90: null },
  rascunhos: { total: 0, comparados: 0, igual: 0, editou: 0, diferente: 0, ignorou: 0, usable_rate: null }, por_etapa: [], horarios_pico: [],
};

export function useConversationStats(r: Range) {
  return useQuery({
    queryKey: ["conv-stats", r.from, r.to],
    queryFn: ({ signal }) => (DEMO ? Promise.resolve(EMPTY_STATS) : getJson<ConversationStats>(`/api/pilot/conversations/stats?${qs({ from: r.from, to: r.to })}`, signal)),
    placeholderData: keepPreviousData,
  });
}

export type ConvFilters = { search?: string; mode?: string; status?: string; stage?: string; leadId?: string };

export function useConversations(f: ConvFilters, opts: { enabled?: boolean; poll?: boolean } = {}) {
  return useInfiniteQuery({
    queryKey: ["conversations", f.search ?? "", f.mode ?? "", f.status ?? "", f.stage ?? "", f.leadId ?? ""],
    enabled: opts.enabled ?? true,
    initialPageParam: 1,
    queryFn: ({ pageParam, signal }) =>
      DEMO
        ? Promise.resolve<ConversationsPage>({ data: [], meta: { page: 1, pageSize: CONV_PAGE_SIZE, totalItems: 0, totalPages: 0 } })
        : getJson<ConversationsPage>(`/api/pilot/conversations?${qs({ ...f, page: pageParam, pageSize: CONV_PAGE_SIZE })}`, signal),
    getNextPageParam: (last) => (last.meta.page < last.meta.totalPages ? last.meta.page + 1 : undefined),
    placeholderData: keepPreviousData,
    staleTime: 10_000,
    // Pausa sozinho com a aba oculta (refetchIntervalInBackground = false por padrão).
    refetchInterval: opts.poll === false ? false : 30_000,
  });
}

export type PendingMessage = { tempId: string; body: string; created_at: string };

/**
 * Thread de uma conversa: última página com atualização a cada 15 s (pausa com a aba oculta),
 * mensagens mais antigas sob demanda e envio com atualização otimista (volta atrás com erro explicado).
 */
export function useThread(conversationId: string | null) {
  const client = useQueryClient();
  const [older, setOlder] = useState<{ id: string | null; msgs: ThreadMessage[]; hasMore: boolean | null }>({ id: null, msgs: [], hasMore: null });
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [olderError, setOlderError] = useState(false);
  const [pending, setPending] = useState<PendingMessage[]>([]);
  const [sendError, setSendError] = useState<SendError | null>(null);

  const q = useQuery({
    queryKey: ["thread", conversationId],
    enabled: !!conversationId,
    queryFn: ({ signal }) =>
      DEMO ? Promise.resolve<ThreadPage>({ data: [], hasMore: false }) : getJson<ThreadPage>(`/api/pilot/conversations/${encodeURIComponent(conversationId!)}/messages?limit=40`, signal),
    staleTime: 5_000,
    refetchInterval: THREAD_POLL_MS,
    refetchIntervalInBackground: false,
  });

  const mine = older.id === conversationId ? older : { id: conversationId, msgs: [] as ThreadMessage[], hasMore: null };
  const messages = useMemo(() => {
    const map = new Map<number, ThreadMessage>();
    for (const m of mine.msgs) map.set(m.id, m);
    for (const m of q.data?.data ?? []) map.set(m.id, m); // o mais recente vence (rascunho pode ter sido comparado)
    return Array.from(map.values()).sort((a, b) => +new Date(a.created_at) - +new Date(b.created_at) || a.id - b.id);
  }, [mine.msgs, q.data]);
  const hasMore = mine.hasMore ?? q.data?.hasMore ?? false;

  const loadOlder = useCallback(async () => {
    if (!conversationId || !messages.length || loadingOlder) return;
    setLoadingOlder(true);
    setOlderError(false);
    try {
      const page = await getJson<ThreadPage>(`/api/pilot/conversations/${encodeURIComponent(conversationId)}/messages?${qs({ before: messages[0].id, limit: 40 })}`);
      setOlder((o) => ({ id: conversationId, msgs: [...(o.id === conversationId ? o.msgs : []), ...page.data], hasMore: page.hasMore }));
    } catch {
      setOlderError(true);
    } finally {
      setLoadingOlder(false);
    }
  }, [conversationId, messages, loadingOlder]);

  const mutation = useMutation({
    mutationFn: ({ body }: { body: string; tempId: string }) => postMessage(conversationId!, body),
    onMutate: ({ body, tempId }) => {
      setSendError(null);
      setPending((p) => [...p, { tempId, body, created_at: new Date().toISOString() }]);
    },
    onSuccess: async (_r, { tempId }) => {
      await client.invalidateQueries({ queryKey: ["thread", conversationId] });
      setPending((p) => p.filter((x) => x.tempId !== tempId));
      client.invalidateQueries({ queryKey: ["conversations"] });
    },
    onError: (e, { tempId }) => {
      setPending((p) => p.filter((x) => x.tempId !== tempId)); // desfaz a mensagem otimista
      setSendError(e instanceof SendError ? e : new SendError(0, "unknown", "Não foi possível enviar a mensagem. Tente de novo."));
    },
  });

  return {
    query: q, messages, hasMore, loadOlder, loadingOlder, olderError, pending, sendError,
    clearSendError: () => setSendError(null),
    send: (body: string) => mutation.mutateAsync({ body, tempId: `p${Date.now()}${Math.random().toString(36).slice(2, 6)}` }).then(() => true, () => false),
    sending: mutation.isPending,
  };
}

// ───── Playbook de vendas ─────
/** Versões, a ativa e o modelo vazio (com as instruções "EXEMPLO (não ativo)"). Leitura: qualquer perfil. */
export function usePlaybook() {
  return useQuery({ queryKey: ["playbook"], queryFn: ({ signal }) => fetchPlaybook(signal), retry: (n: number, e: Error) => shouldRetry(n, e) });
}

export function usePlaybookVersion(version: number | null) {
  return useQuery({
    queryKey: ["playbook", "version", version],
    enabled: version !== null,
    queryFn: ({ signal }) => fetchPlaybookVersion(version!, signal),
    retry: (n: number, e: Error) => shouldRetry(n, e),
  });
}

/** Cria (sem `version`) ou atualiza um rascunho (com `version`). Só o dono; o servidor confere. */
export function useSavePlaybook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: SaveInput) => savePlaybook(v),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["playbook"] }),
  });
}

/** Ativa um rascunho. 422 traz a lista `missing` em ActionError.missing. */
export function useActivatePlaybook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (version: number) => activatePlaybook(version),
    onSettled: () => qc.invalidateQueries({ queryKey: ["playbook"] }),
  });
}
