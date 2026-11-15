"use client";
// Cliente da área de Disparos. Fala só com o BFF (/api/pilot/broadcasts/...); nenhum token passa por aqui.
// Helpers próprios: não toca em lib/hooks.ts nem em lib/types.ts (arquivos compartilhados).
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ActionError, getJson, sendJson, type ActionMessages } from "@/lib/client";
import * as demo from "@/lib/demo-disparos";
import { DEMO } from "@/lib/flags";

// Mantido aqui para os componentes que importam ActionError de "./api" (o tipo vive em lib/client.ts).
export { ActionError };

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

const FALLBACK: Record<number, string> = {
  400: "Algum campo não é válido. Confira os dados e tente de novo.",
  401: "Sua sessão expirou. Entre de novo.",
  403: "Seu perfil não pode fazer isto, ou o envio real está desligado no servidor.",
  404: "Não encontrado.",
  409: "O estado mudou ou algo impede esta ação. Atualize e confira.",
  429: "Muitas ações em pouco tempo. Aguarde um instante.",
  503: "O chat ainda não está configurado. Nada foi enviado.",
};

const MESSAGES: ActionMessages = { network: "Sem conexão com o servidor. Nada foi feito.", fallback: "Não foi possível concluir a ação.", byStatus: FALLBACK };

/** Chamada de escrita ao BFF (lib/client.ts: sendJson). Mostra a mensagem do servidor (pt-BR) quando existe; nunca inventa sucesso. */
export function act<T = unknown>(method: "POST" | "PATCH", path: string, body?: unknown): Promise<T> {
  // Demonstração: nada é enviado nem alterado, e a tela diz isso (não finge sucesso).
  if (DEMO) return Promise.reject(new ActionError(0, "demo", "Modo demonstração: nada foi enviado nem alterado."));
  return sendJson<T>(method, path ? `${B}/${path}` : B, body, MESSAGES);
}

export function useBroadcasts() {
  return useQuery({ queryKey: ["disparos", "list"], queryFn: ({ signal }) => (DEMO ? demo.demoBroadcastList() : getJson<BroadcastList>(B, signal)), refetchInterval: 15_000 });
}

export function useBroadcast(id: string) {
  return useQuery({ queryKey: ["disparos", "one", id], queryFn: ({ signal }) => (DEMO ? demo.demoBroadcastDetail(id) : getJson<BroadcastDetail>(`${B}/${id}`, signal)), refetchInterval: 10_000 });
}

export function useRecipients(id: string, status: string, page: number) {
  return useQuery({
    queryKey: ["disparos", "recipients", id, status, page],
    queryFn: ({ signal }) => (DEMO ? demo.demoRecipients(id, status, page) : getJson<RecipientsPage>(`${B}/${id}/recipients?${qs({ status, page })}`, signal)),
    placeholderData: keepPreviousData,
  });
}

export function useTemplates() {
  return useQuery({ queryKey: ["disparos", "templates"], queryFn: ({ signal }) => (DEMO ? demo.demoTemplates() : getJson<TemplatesResp>(`${B}/templates?refresh=1`, signal)), staleTime: 30_000 });
}

/** Templates JÁ sincronizados (sem `refresh`): leitura leve para telas de status. A tela de Templates usa useTemplates, que sincroniza com a Meta. */
export function useTemplatesCache() {
  return useQuery({ queryKey: ["disparos", "templates", "cache"], queryFn: ({ signal }) => (DEMO ? demo.demoTemplates() : getJson<TemplatesResp>(`${B}/templates`, signal)), staleTime: 30_000 });
}

export function useNumberHealth() {
  return useQuery({ queryKey: ["disparos", "health"], queryFn: ({ signal }) => (DEMO ? demo.demoHealth() : getJson<HealthResp>(`${B}/number-health`, signal)), refetchInterval: 60_000 });
}

/** Mutação simples com invalidação do cache de disparos. */
export function useAct<V>(fn: (v: V) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSettled: () => qc.invalidateQueries({ queryKey: ["disparos"] }) });
}

// Em demonstração não há papel real: libera a tela inteira para dar para ver (as ações continuam simuladas, ver `act`).
export const isManager = (role?: string) => DEMO || role === "manager" || role === "owner";
export const isOwner = (role?: string) => DEMO || role === "owner";
