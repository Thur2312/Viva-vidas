import { brand } from "@/lib/brand";

// Símbolo: três camadas de cobertura empilhadas, a de cima em destaque. Desenhado em SVG, sem imagem.
export function Mark({ size = 32, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" className={className} aria-hidden="true" fill="none" strokeLinejoin="round">
      <path d="M20 22 35 29 20 36 5 29Z" stroke="currentColor" strokeWidth="2.2" opacity="0.45" />
      <path d="M20 15 35 22 20 29 5 22Z" stroke="currentColor" strokeWidth="2.2" opacity="0.75" />
      <path d="M20 8 35 15 20 22 5 15Z" stroke="rgb(var(--brand))" strokeWidth="2.6" fill="rgb(var(--brand) / 0.14)" />
    </svg>
  );
}

export function Wordmark({ light = false, compact = false }: { light?: boolean; compact?: boolean }) {
  return (
    <span className={`flex items-center gap-2.5 ${light ? "text-osso" : "text-ink"}`}>
      <Mark />
      <span className="leading-none">
        <span className="block font-display text-[19px]">{brand.name}</span>
        {!compact && <span className="mt-0.5 block text-[11px] font-medium tracking-wide opacity-70">{brand.tagline}</span>}
      </span>
    </span>
  );
}

/** Fita de batimento (ECG). Decorativa: o movimento é só CSS e para com prefers-reduced-motion. */
export function Ecg({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 600 40" preserveAspectRatio="none" className={className} aria-hidden="true" fill="none">
      <path d="M0 22H120l10-4 8 4h24l8-16 10 34 10-30 8 12h40l8-5 8 5h120l10-4 8 4h24l8-16 10 34 10-30 8 12H600" stroke="rgb(var(--line))" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path className="ecg-run" d="M0 22H120l10-4 8 4h24l8-16 10 34 10-30 8 12h40l8-5 8 5h120l10-4 8 4h24l8-16 10 34 10-30 8 12H600" stroke="rgb(var(--sinal))" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
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
