import { brand } from "@/lib/brand";

// Símbolo: funil de três anéis que se estreitam; o de baixo em destaque (quem chegou ao fim). Desenhado em SVG, sem imagem.
export function Mark({ size = 32, className = "", onDark = false }: { size?: number; className?: string; onDark?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" className={className} aria-hidden="true" fill="none">
      <ellipse cx="20" cy="10" rx="15" ry="5" stroke="currentColor" strokeWidth="2.2" opacity="0.5" />
      <ellipse cx="20" cy="21" rx="10" ry="3.6" stroke="currentColor" strokeWidth="2.2" opacity="0.8" />
      <ellipse cx="20" cy="31" rx="5" ry="2.2" stroke={onDark ? "rgb(var(--cena-conversa))" : "rgb(var(--brand))"} strokeWidth="2.6" fill={onDark ? "rgb(var(--cena-conversa) / 0.25)" : "rgb(var(--brand) / 0.2)"} />
    </svg>
  );
}

export function Wordmark({ light = false, compact = false }: { light?: boolean; compact?: boolean }) {
  return (
    <span className={`flex items-center gap-2.5 ${light ? "text-white" : "text-ink"}`}>
      <Mark onDark={light} />
      <span className="leading-none">
        <span className="block font-display text-[19px]">{brand.name}</span>
        {!compact && <span className="mt-0.5 block text-[11px] font-medium tracking-wide opacity-70">{brand.tagline}</span>}
      </span>
    </span>
  );
}

export function DemoBadge() {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-warn/40 bg-warn/10 px-3 py-1 text-xs font-semibold text-warn">
      <span className="h-1.5 w-1.5 rounded-full bg-warn" aria-hidden="true" />
      Dados de demonstração
    </span>
  );
}
