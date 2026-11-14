"use client";
// Cliente das integrações (CRM e agenda). Fala só com o BFF (/api/pilot/crm e /api/pilot/calendar); nenhum token passa por aqui.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getJson, sendJson, type ActionMessages } from "@/lib/client";
import { DEMO } from "@/lib/flags";

export type CrmStatus = {
  enabled: boolean;
  provider: string;
  configured: boolean;
  missing: string[];
  queue: { pending: number; processing: number; sent: number; skipped: number; dead: number };
};

export type CalendarRules = { timezone: string; days: number[]; start: string; end: string; durationMin: number; minNoticeMin: number; horizonDays: number };
export type CalendarStatus = { enabled: boolean; provider: string; configured: boolean; missing: string[]; rules: CalendarRules };
export type Slot = { start: string; end: string };
export type SlotsResp = { timezone: string; durationMin: number; slots: Slot[] };

const demoCrm: CrmStatus = { enabled: false, provider: "disabled", configured: false, missing: ["CRM_PROVIDER (use \"pipedrive\")"], queue: { pending: 0, processing: 0, sent: 0, skipped: 0, dead: 0 } };
const demoCal: CalendarStatus = { enabled: false, provider: "disabled", configured: false, missing: ["CALENDAR_PROVIDER (use \"google\")"], rules: { timezone: "America/Sao_Paulo", days: [1, 2, 3, 4, 5], start: "09:00", end: "18:00", durationMin: 30, minNoticeMin: 120, horizonDays: 14 } };

export const useCrmStatus = () =>
  useQuery({ queryKey: ["crm", "status"], queryFn: ({ signal }) => (DEMO ? Promise.resolve(demoCrm) : getJson<CrmStatus>("/api/pilot/crm/status", signal)), refetchInterval: 30_000 });

export const useCalendarStatus = () =>
  useQuery({ queryKey: ["calendar", "status"], queryFn: ({ signal }) => (DEMO ? Promise.resolve(demoCal) : getJson<CalendarStatus>("/api/pilot/calendar/status", signal)), staleTime: 60_000 });

export const useSlots = (enabled: boolean, limit = 30) =>
  useQuery({ queryKey: ["calendar", "slots", limit], enabled, queryFn: ({ signal }) => getJson<SlotsResp>(`/api/pilot/calendar/slots?limit=${limit}`, signal), staleTime: 30_000 });

const FALLBACK: Record<number, string> = {
  400: "Algum dado não é válido. Confira e tente de novo.",
  403: "Seu perfil não pode fazer isto.",
  404: "Não encontrado.",
  409: "O estado mudou (horário ocupado ou lead sem permissão de contato). Atualize e escolha de novo.",
  502: "A agenda não respondeu agora. Nada foi marcado.",
  503: "A integração ainda não está configurada. Nada foi feito.",
};

const MESSAGES: ActionMessages = { network: "Sem conexão com o servidor. Nada foi feito.", fallback: "Não foi possível concluir a ação.", byStatus: FALLBACK };

const post = <T>(path: string, body: unknown) => sendJson<T>("POST", `/api/pilot/${path}`, body, MESSAGES);

export function useRetryDead() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: () => post<{ requeued: number }>("crm/retry-dead", {}), onSuccess: () => qc.invalidateQueries({ queryKey: ["crm"] }) });
}

export function useBook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { leadId: string; start: string }) => post<{ start: string; end: string; eventId: string }>("calendar/book", v),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["calendar"] });
      qc.invalidateQueries({ queryKey: ["lead"] });
      qc.invalidateQueries({ queryKey: ["overview"] });
      qc.invalidateQueries({ queryKey: ["leads"] });
    },
  });
}

/** "qui., 12/11 · 12:00" no fuso da agenda (nao no do navegador): o horario marcado e o do Alberto. */
export const slotLabel = (iso: string, timeZone: string) =>
  new Intl.DateTimeFormat("pt-BR", { timeZone, weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(iso)).replace(", ", " · ");

export const slotDay = (iso: string, timeZone: string) =>
  new Intl.DateTimeFormat("pt-BR", { timeZone, weekday: "long", day: "2-digit", month: "long" }).format(new Date(iso));
export const slotHour = (iso: string, timeZone: string) =>
  new Intl.DateTimeFormat("pt-BR", { timeZone, hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
