import { Mic } from "lucide-react";
import type { CallState } from "./voz-api";

// Indicadores de ESTADO da ligação (não medem áudio: a chamada acontece pelo telefone, o navegador não recebe a voz).
// Só movimento CSS; com prefers-reduced-motion tudo fica parado (veja globals.css).

/** Microfone com halo por estado: na fila respira, tocando emite ondas, em andamento fica firme; encerrada, parado. */
export function MicWave({ state, size = 56 }: { state: CallState; size?: number }) {
  const mode = state === "in_progress" ? "mic-live" : state === "ringing" ? "mic-ring" : state === "queued" ? "mic-wait" : "";
  return (
    <span aria-hidden="true" className={`mic ${mode} relative inline-flex shrink-0 items-center justify-center`} style={{ width: size, height: size }}>
      <span className="mic-halo absolute inset-0 rounded-full" />
      <span className="mic-halo mic-halo-2 absolute inset-0 rounded-full" />
      <span className={`relative flex h-full w-full items-center justify-center rounded-full ${mode ? "bg-brand text-on-brand" : "bg-ink/10 text-mute"}`}>
        <Mic size={Math.round(size * 0.45)} />
      </span>
    </span>
  );
}

const BARS = [0.55, 0.9, 0.7, 1, 0.6, 0.85, 0.5];

/** Barras de "voz": ativas só durante a ligação em andamento; paradas (em alturas variadas) nos demais estados. */
export function WaveBars({ active, height = 36, className = "" }: { active: boolean; height?: number; className?: string }) {
  return (
    <span aria-hidden="true" className={`wave ${active ? "wave-live" : ""} inline-flex items-center gap-[3px] ${className}`} style={{ height }}>
      {BARS.map((h, i) => (
        <i key={i} className={`wave-bar block w-[3px] rounded-full ${active ? "bg-brand" : "bg-ink/20"}`} style={{ height: `${h * 100}%` }} />
      ))}
    </span>
  );
}
