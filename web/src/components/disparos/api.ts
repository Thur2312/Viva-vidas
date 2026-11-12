"use client";
// Cliente da área de Disparos. Fala só com o BFF (/api/pilot/broadcasts/...); nenhum token passa por aqui.
// Helpers próprios: não toca em lib/hooks.ts nem em lib/types.ts (arquivos compartilhados).
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getJson, goLogin } from "@/lib/client";

export type BStatus = "draft" | "scheduled" | "running" | "paused" | "completed" | "cancelled" | "failed";
export type RStatus = "pending" | "queued" | "sent" | "delivered" | "read" | "replied" | "failed" | "skipped";
export type VarSource = "lead.name" | "lead.first_name" | "custom";
export type VarSpec = { source: VarSource; value?: string; fallback?: string };
export type AudienceFilter = { stages?: string[]; campaignIds?: string[]; scoreMin?: number; scoreMax?: number; optInOrigins?: string[] };

export type Safety = { enabled: boolean; chat: { configured: boolean; missing: string[] }; globalDailyCap: number; note: string };

export type Broadcast = {
  id: string; name: string; objective: string | null; status: BStatus; kind: "template" | "text_in_window";
  templateName: string | null; templateLanguage: string; templateCategory: "MARKETING" | "UTILITY" | null; textBody: string | null;
  variablesMap: Record<string, VarSpec>; audienceFilter: AudienceFilter; scheduledAt: string | null;
  window: { start: string; end: string; days: number[]; timezone: string };
  ratePerMinute: number; dailyCap: number; dryRun: boolean; expectedRecipients: number | null; pausedReason: string | null;
  createdAt: string; startedAt: string | null; finishedAt: string | null;
  counts: Partial<Record<RStatus, number>>; total: number; progress: number;
};
export type BroadcastList = { data: Broadcast[]; safety: Safety };

export type BroadcastDetail = {
  broadcast: Broadcast;
  funnel: { sent: number; delivered: number; read: number; replied: number; converted: number };
  kpis: { sent: number; delivered: number; read: number; replied: number; converted: number; failed: number; skipped: number; optOuts: number };
  errors: { code: string | null; n: number }[];
  skipReasons: { reason: string; label: string; n: number }[];
  safety: Safety; simulated: boolean;
};

export type Recipient = {
  id: number; leadId: string; firstName: string | null; phone: string | null; status: RStatus; skipReason: string | null; skipLabel: string | null;
  errorCode: string | null; attempts: number; sentAt: string | null; deliveredAt: string | null; readAt: string | null; repliedAt: string | null; convertedAt: string | null;
};
export type RecipientsPage = { data: Recipient[]; meta: { page: number; pageSize: number; totalItems: number; totalPages: number } };

export type TButton = { type: "QUICK_REPLY" | "URL" | "PHONE_NUMBER"; text: string; url?: string };
export type TemplateRow = {
  name: string; language: string; category: string | null; status: string; rejectedReason: string | null;
  bodyText: string | null; footerText: string | null; buttons: TButton[]; syncedAt: string;
};
export type DraftTemplate = { name: string; category: "MARKETING" | "UTILITY"; bodyText: string; bodyExamples: string[]; variables: string[]; buttons: TButton[]; state: string; rejectedReason: string | null };
export type TemplatesResp = {
  chat: { configured: boolean; missing: string[] }; syncedAt: string | null; syncError: string | null; data: TemplateRow[]; drafts: DraftTemplate[];
};

export type Preview = {
  category: "MARKETING" | "UTILITY"; eligible: number; skipped: number; total: number;
  reasons: { reason: string; label: string; n: number }[]; warnings: string[]; sample: string | null;
};

export type Quality = "GREEN" | "YELLOW" | "RED" | "UNKNOWN";
export type HealthResp = {
  chat: { configured: boolean; missing: string[] };
  latest: { checkedAt: string; qualityRating: Quality; limitTier: string; dailyLimit: number | null; status: string | null; accountReviewStatus: string | null } | null;
  history: { checkedAt: string; qualityRating: Quality; limitTier: string; dailyLimit: number | null; status: string | null }[];
  verdict: { state: "ok" | "warn" | "block"; reasons: string[]; labels: string[]; rateFactor: number; dailyLimit: number | null };
  lastError: string | null; autoPaused: { id: string; name: string }[]; pollEveryMinutes: number;
};

const B = "/api/pilot/broadcasts";
const qs = (o: Record<string, string | number | undefined>) =>
  new URLSearchParams(Object.entries(o).filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => [k, String(v)])).toString();

export class ActionError extends Error {
  constructor(public status: number, public code: string, public userMessage: string) {
    super(code);
  }
}

const FALLBACK: Record<number, string> = {
  400: "Algum campo não é válido. Confira os dados e tente de novo.",
  401: "Sua sessão expirou. Entre de novo.",
  403: "Seu perfil não pode fazer isto, ou o envio real está desligado no servidor.",
  404: "Não encontrado.",
  409: "O estado mudou ou algo impede esta ação. Atualize e confira.",
  429: "Muitas ações em pouco tempo. Aguarde um instante.",
  503: "O chat ainda não está configurado. Nada foi enviado.",
};

/** Chamada de escrita ao BFF. Mostra a mensagem do servidor (pt-BR) quando existe; nunca inventa sucesso. */
export async function act<T = unknown>(method: "POST" | "PATCH", path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path ? `${B}/${path}` : B, {
      method, credentials: "same-origin", headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body ?? {}),
    });
  } catch {
    throw new ActionError(0, "network", "Sem conexão com o servidor. Nada foi feito.");
  }
  if (res.status === 401) goLogin();
  if (!res.ok) {
    let code = `http_${res.status}`;
    let msg = "";
    try {
      const j = await res.json();
      if (typeof j?.error === "string") code = j.error;
      if (typeof j?.message === "string") msg = j.message;
      else if (Array.isArray(j?.message)) msg = j.message.join(" ");
    } catch { /* corpo vazio */ }
    throw new ActionError(res.status, code, msg || FALLBACK[res.status] || "Não foi possível concluir a ação.");
  }
  return (await res.json().catch(() => ({}))) as T;
}

export function useBroadcasts() {
  return useQuery({ queryKey: ["disparos", "list"], queryFn: ({ signal }) => getJson<BroadcastList>(B, signal), refetchInterval: 15_000 });
}

export function useBroadcast(id: string) {
  return useQuery({ queryKey: ["disparos", "one", id], queryFn: ({ signal }) => getJson<BroadcastDetail>(`${B}/${id}`, signal), refetchInterval: 10_000 });
}

export function useRecipients(id: string, status: string, page: number) {
  return useQuery({
    queryKey: ["disparos", "recipients", id, status, page],
    queryFn: ({ signal }) => getJson<RecipientsPage>(`${B}/${id}/recipients?${qs({ status, page })}`, signal),
    placeholderData: keepPreviousData,
  });
}

export function useTemplates() {
  return useQuery({ queryKey: ["disparos", "templates"], queryFn: ({ signal }) => getJson<TemplatesResp>(`${B}/templates?refresh=1`, signal), staleTime: 30_000 });
}

export function useNumberHealth() {
  return useQuery({ queryKey: ["disparos", "health"], queryFn: ({ signal }) => getJson<HealthResp>(`${B}/number-health`, signal), refetchInterval: 60_000 });
}

/** Mutação simples com invalidação do cache de disparos. */
export function useAct<V>(fn: (v: V) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSettled: () => qc.invalidateQueries({ queryKey: ["disparos"] }) });
}

export const isManager = (role?: string) => role === "manager" || role === "owner";
export const isOwner = (role?: string) => role === "owner";
