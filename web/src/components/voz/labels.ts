import type { CallState, TranscriptState } from "./voz-api";

export const STATE_LABEL: Record<CallState, string> = {
  queued: "Na fila",
  ringing: "Tocando",
  in_progress: "Em andamento",
  completed: "Encerrada",
  busy: "Ocupado",
  no_answer: "Sem resposta",
  failed: "Falhou",
  canceled: "Cancelada",
};

export const STATE_TONE: Record<CallState, string> = {
  queued: "bg-ink/10 text-mute",
  ringing: "bg-brand/20 text-brand-ink",
  in_progress: "bg-brand/20 text-brand-ink",
  completed: "bg-ok/15 text-ok",
  busy: "bg-warn/15 text-warn",
  no_answer: "bg-warn/15 text-warn",
  failed: "bg-bad/15 text-bad",
  canceled: "bg-ink/10 text-mute",
};

export const TRANSCRIPT_LABEL: Record<TranscriptState, string> = {
  none: "Sem transcrição",
  pending: "Transcrevendo",
  done: "Disponível",
  failed: "Falhou",
  disabled: "Transcrição desligada",
};

export function duration(sec: number | null | undefined): string {
  if (sec === null || sec === undefined) return "—";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export const EVENT_LABEL: Record<string, string> = {
  queued: "Pedido de ligação registrado",
  ringing: "Telefone do operador tocando",
  in_progress: "Operador atendeu",
  completed: "Ligação encerrada",
  busy: "Linha ocupada",
  no_answer: "Ninguém atendeu",
  failed: "A ligação falhou",
  canceled: "Ligação cancelada",
};
