"use client";

import { useEffect, useState } from "react";
import { CallDrawer } from "./CallDrawer";
import { duration } from "./labels";
import { MicWave, WaveBars } from "./MicWave";
import type { CallRow, CallState } from "./voz-api";

export const ACTIVE_STATES: CallState[] = ["queued", "ringing", "in_progress"];
export const isActive = (c: Pick<CallRow, "status">) => ACTIVE_STATES.includes(c.status);

const TITLE: Record<string, string> = {
  queued: "Preparando a ligação",
  ringing: "Tocando no seu telefone",
  in_progress: "Em ligação",
};
const HINT: Record<string, string> = {
  queued: "O pedido foi registrado e está na fila da operadora.",
  ringing: "Atenda: em seguida o lead é chamado e ouve o aviso de gravação.",
  in_progress: "A animação indica o estado da ligação, não o nível do áudio.",
};

function useElapsed(since: string | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return since ? Math.max(0, Math.floor((now - new Date(since).getTime()) / 1000)) : null;
}

/** Faixa no topo da Voz enquanto há uma ligação ativa: microfone animado por estado e cronômetro. */
export function LiveCall({ call, canSeeTranscript }: { call: CallRow; canSeeTranscript: boolean }) {
  const [open, setOpen] = useState(false);
  const live = call.status === "in_progress";
  const elapsed = useElapsed(live ? call.answered_at ?? call.started_at ?? call.requested_at : null);

  return (
    <section aria-label="Ligação em andamento" className="flex flex-wrap items-center gap-x-5 gap-y-3 rounded-sm border border-line bg-card p-4">
      <MicWave state={call.status} />
      {live && <WaveBars active className="hidden sm:inline-flex" />}
      <div className="min-w-[12rem] flex-1">
        {/* Região viva: anuncia só a mudança de estado (o cronômetro fica fora dela, para não falar a cada segundo). */}
        <p role="status" className="font-display text-lg leading-tight">{TITLE[call.status]}</p>
        <p className="mt-0.5 truncate text-sm text-mute">
          {call.lead_name || "Lead sem nome"} <span className="tabular">· {call.phone_masked ?? ""}</span>
        </p>
        <p className="mt-1 text-xs text-mute">{HINT[call.status]}</p>
      </div>
      {live && elapsed !== null && (
        <p className="tabular text-2xl font-semibold" aria-label={`Duração: ${duration(elapsed)}`}>{duration(elapsed)}</p>
      )}
      <button type="button" onClick={() => setOpen(true)} aria-haspopup="dialog" className="inline-flex min-h-[44px] items-center rounded-full border border-line bg-card px-4 text-sm font-semibold hover:bg-ink/5">
        Detalhes
      </button>
      {open && <CallDrawer id={call.id} canSeeTranscript={canSeeTranscript} onClose={() => setOpen(false)} />}
    </section>
  );
}
