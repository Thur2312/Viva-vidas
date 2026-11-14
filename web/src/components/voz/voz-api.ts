"use client";
// Cliente da área de Voz. Fala só com o BFF (/api/pilot/voice/...); nenhum token passa por aqui.
// Helpers próprios (não toca em lib/hooks.ts, que é compartilhado).
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ActionError, ApiError, getJson, sendJson, type ActionMessages } from "@/lib/client";
import { DEMO } from "@/lib/flags";

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

// ───── Demonstração (sem API): a ligação percorre os estados para dar para ver cada animação. Não é dado real. ─────
const demoStatus: VoiceStatus = {
  telephony: { provider: "demo", configured: true, ready: true, missing: [] },
  tts: { provider: "demo", configured: false, ready: false, missing: [] },
  stt: { provider: "demo", configured: true, ready: true, missing: [] },
  recording: { announcementConfigured: true, retentionDays: 30 },
  dnc: { enabled: false, configured: false },
  callWindow: { days: [1, 2, 3, 4, 5], start: "09:00", end: "18:00", tz: "America/Sao_Paulo" },
  webhookUrl: null,
  canPlaceCalls: true,
};
const demoRow = (id: string, name: string, phone: string, status: CallState, agoMin: number, dur: number | null): CallRow => {
  const at = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
  return {
    id, lead_id: `lead-${id}`, lead_name: name, phone_masked: phone, direction: "outbound", status, failure_reason: null,
    requested_at: at(agoMin), started_at: at(agoMin), answered_at: status === "completed" || status === "in_progress" ? at(agoMin) : null,
    ended_at: status === "completed" ? at(agoMin - 4) : null, duration_sec: dur, has_recording: status === "completed", recording_consent: true,
    transcript_status: status === "completed" ? "done" : "none", retention_until: null, cost_cents: null,
  };
};
function demoCalls(): CallsPage {
  // Ciclo de 7 s por etapa: na fila, tocando, em andamento (x3), encerrada.
  const phase = Math.floor(Date.now() / 7000) % 6;
  const live: CallState = phase === 0 ? "queued" : phase === 1 ? "ringing" : phase <= 4 ? "in_progress" : "completed";
  const data = [
    { ...demoRow("d0", "Roberto F.", "(83) 9••••-9014", live, live === "in_progress" ? 0.6 : 0.1, live === "completed" ? 212 : null) },
    demoRow("d1", "Júlio R.", "(81) 9••••-7731", "completed", 95, 318),
    demoRow("d2", "Débora M.", "(84) 9••••-3308", "no_answer", 240, null),
    demoRow("d3", "Felipe A.", "(83) 9••••-2275", "completed", 1500, 141),
  ];
  return { data, meta: { page: 1, pageSize: 15, totalItems: data.length, totalPages: 1 } };
}

export function useVoiceStatus() {
  return useQuery({
    queryKey: ["voz", "status"],
    queryFn: ({ signal }) => (DEMO ? Promise.resolve(demoStatus) : getJson<VoiceStatus>("/api/pilot/voice/status", signal)),
    staleTime: 30_000,
  });
}

export function useCalls(f: { page: number; status: string }) {
  return useQuery({
    queryKey: ["voz", "calls", f.page, f.status],
    queryFn: ({ signal }) => (DEMO ? Promise.resolve(demoCalls()) : getJson<CallsPage>(`/api/pilot/voice/calls?${qs({ page: f.page, pageSize: VOZ_PAGE_SIZE, status: f.status })}`, signal)),
    placeholderData: keepPreviousData,
    staleTime: 15_000,
    // Enquanto houver ligação ativa, a lista se atualiza sozinha (4 s); sem ligação ativa, não consulta à toa.
    refetchInterval: (q) => (q.state.data?.data.some((c) => c.status === "queued" || c.status === "ringing" || c.status === "in_progress") ? 4000 : false),
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

const CALL_MESSAGES: ActionMessages = {
  network: "Sem conexão com o servidor. Nada foi ligado.",
  fallback: "Não foi possível ligar agora.",
  byStatus: { 401: "Sessão expirada." },
  byCode: BLOCK_MESSAGES, // aqui a tradução é por CÓDIGO de bloqueio (DNC, janela de horário, ligação em andamento...)
};

export async function placeCall(leadId: string): Promise<PlaceResult> {
  if (DEMO) return { ok: true, id: `demo-${leadId}` }; // demonstração: nada é ligado
  try {
    const j = await sendJson<{ id?: unknown }>("POST", "/api/pilot/voice/calls", { leadId }, CALL_MESSAGES, { loginNext: "/voz" });
    return typeof j?.id === "string" ? { ok: true, id: j.id } : { ok: false, status: 200, code: "invalid", message: "Resposta inesperada do servidor." };
  } catch (e) {
    if (e instanceof ActionError) return { ok: false, status: e.status, code: e.code, message: e.userMessage };
    return { ok: false, status: 0, code: "unknown", message: CALL_MESSAGES.fallback };
  }
}

// No modo demonstração não há papel real: libera a tela inteira para dar para ver (o pedido de ligação abaixo é simulado).
export const isManager = (role: string | undefined) => DEMO || role === "manager" || role === "owner";
export { ApiError };
