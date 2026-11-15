import { TOM, type Estado } from "@/lib/agente-estados";

// Chip de estado do painel (Ligado, Desligado, Falta configurar, Sem leitura...). Um só, usado por todas as telas,
// para o mesmo estado nunca aparecer com cor ou palavra diferente. A cor sozinha não carrega o significado: o texto sempre vai junto.

export const CHIP = "inline-flex shrink-0 rounded-full border px-2.5 py-1 text-xs font-semibold";

/** `estado` null = ainda lendo. */
export function Selo({ estado }: { estado: Estado | null }) {
  if (!estado) return <span className={`${CHIP} ${TOM.mute}`} aria-busy="true">Lendo…</span>;
  return <span className={`${CHIP} ${TOM[estado.tom]}`}>{estado.rotulo}</span>;
}
