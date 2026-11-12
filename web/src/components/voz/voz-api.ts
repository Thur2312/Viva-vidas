"use client";
// Cliente da área de Voz. Fala só com o BFF (/api/pilot/voice/...); nenhum token passa por aqui.
// Helpers próprios (não toca em lib/hooks.ts, que é compartilhado).
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ApiError, getJson, goLogin } from "@/lib/client";

export type CallState = "queued" | "ringing" | "in_progress" | "completed" | "busy" | "no_answer" | "failed" | "canceled";
export type TranscriptState = "none" | "pending" | "done" | "failed" | "disabled";

export type ProviderStatus = { provider: string; configured: boolean; ready: boolean; missing: string[] };

export type VoiceStatus = {
  telephony: ProviderStatus;
  tts: ProviderStatus;
  stt: ProviderStatus;
  recording: { announcementConfigured: boolean; announcementVersion?: string | null; retentionDays?: number; retentionPendingClientConfirmation?: boolean };
  dnc: { enabled: boolean; configured: boolean; blocking?: boolean };
  callWindow: { days: number[]; start: string; end: string; tz: string; source?: string };
  webhookUrl: string | null;
  canPlaceCalls?: boolean;
};

export type CallRow = {
  id: string;
  lead_id: string;
  lead_name: string | null;
  phone_masked: string | null;
  direction: "outbound" | "inbound";
  status: CallState;
  failure_reason: string | null;
  requested_at: string;
  started_at: string | null;
  answered_at: string | null;
  ended_at: string | null;
  duration_sec: number | null;
  has_recording: boolean;
  recording_consent: boolean;
  transcript_status: TranscriptState;
  retention_until: string | null;
  cost_cents: number | null;
};

export type CallsPage = { data: CallRow[]; meta: { page: number; pageSize: number; totalItems: number; totalPages: number } };

export type CallEvent = { kind: string; status: string | null; at: string };
export type Segment = { start: number | null; end: number | null; speaker: string | null; text: string };
export type CallDetail = CallRow & {
  consent_basis?: string | null;
  announcement_version?: string | null;
  recording_announced_at?: string | null;
  recording_deleted_at?: string | null;
  events: CallEvent[];
  transcript: { segments: Segment[]; language: string | null } | null;
  transcript_restricted: boolean;
};

export const VOZ_PAGE_SIZE = 15;

const qs = (o: Record<string, string | number | undefined>) =>
  new URLSearchParams(Object.entries(o).filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => [k, String(v)])).toString();

export function useVoiceStatus() {
  return useQuery({
    queryKey: ["voz", "status"],
    queryFn: ({ signal }) => getJson<VoiceStatus>("/api/pilot/voice/status", signal),
    staleTime: 30_000,
  });
}

export function useCalls(f: { page: number; status: string }) {
  return useQuery({
    queryKey: ["voz", "calls", f.page, f.status],
    queryFn: ({ signal }) => getJson<CallsPage>(`/api/pilot/voice/calls?${qs({ page: f.page, pageSize: VOZ_PAGE_SIZE, status: f.status })}`, signal),
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });
}

export function useCall(id: string | null) {
  return useQuery({
    queryKey: ["voz", "call", id],
    enabled: !!id,
    queryFn: ({ signal }) => getJson<CallDetail>(`/api/pilot/voice/calls/${id}`, signal),
    staleTime: 10_000,
  });
}

/** Resultado do pedido de ligação, com o motivo em pt-BR devolvido pelo servidor quando há bloqueio. */
export type PlaceResult = { ok: true; id: string } | { ok: false; status: number; code: string; message: string };

const BLOCK_MESSAGES: Record<string, string> = {
  lead_nao_encontrado: "Lead não encontrado.",
  lead_anonimizado: "Lead anonimizado: não há como contatá-lo.",
  contato_bloqueado: "Contato bloqueado: o lead pediu para não ser contatado ou revogou autorização.",
  sem_consentimento_atendimento: "Sem consentimento ativo para atendimento. Registre o consentimento do lead antes de ligar.",
  aviso_gravacao_ausente: "O aviso de gravação não está configurado. Sem ele a ligação não é feita.",
  fora_da_janela: "Fora da janela de horário permitida para ligações.",
  dnc_sem_verificador: "A checagem de Não Perturbe está ligada, mas não há verificador configurado. Ligação recusada por segurança.",
  dnc_bloqueado: "Número presente na lista de Não Perturbe.",
  telefone_invalido: "O telefone do lead é inválido.",
  ligacao_em_andamento: "Já existe uma ligação em andamento para este lead.",
  upstream_503: "A telefonia ainda não está configurada. Veja o painel de status desta página.",
  upstream_502: "O servidor não conseguiu falar com a telefonia agora. Tente de novo em instantes.",
  upstream_403: "Seu perfil não permite ligar. Peça a um gestor.",
  forbidden_origin: "Pedido recusado por segurança. Recarregue a página.",
};

export async function placeCall(leadId: string): Promise<PlaceResult> {
  let res: Response;
  try {
    res = await fetch("/api/pilot/voice/calls", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ leadId }),
    });
  } catch {
    return { ok: false, status: 0, code: "network", message: "Sem conexão com o servidor. Nada foi ligado." };
  }
  const j = await res.json().catch(() => null);
  if (res.ok) return typeof j?.id === "string" ? { ok: true, id: j.id } : { ok: false, status: res.status, code: "invalid", message: "Resposta inesperada do servidor." };
  if (res.status === 401) {
    goLogin("/voz");
    return { ok: false, status: 401, code: "unauthenticated", message: "Sessão expirada." };
  }
  const code = typeof j?.error === "string" ? j.error : `http_${res.status}`;
  const message = BLOCK_MESSAGES[code] ?? (typeof j?.message === "string" ? j.message : "Não foi possível ligar agora.");
  return { ok: false, status: res.status, code, message };
}

export const isManager = (role: string | undefined) => role === "manager" || role === "owner";
export { ApiError };
