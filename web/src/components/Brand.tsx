// Marca da Horizon: arco de horizonte com sol, desenhado em SVG.
export function Mark({ size = 36, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" className={className} aria-hidden="true">
      <path d="M4 28a16 16 0 0 1 32 0" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      <path d="M11 28a9 9 0 0 1 18 0" fill="none" stroke="rgb(var(--brand))" strokeWidth="3" strokeLinecap="round" />
      <path d="M2 34h36" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function Wordmark({ light = false }: { light?: boolean }) {
  return (
    <span className={`flex items-center gap-2.5 ${light ? "text-white" : "text-deep"}`}>
      <Mark />
      <span className="leading-none">
        <span className="block text-[15px] font-bold tracking-[0.18em]">HORIZON</span>
        <span className="block text-[11px] font-medium tracking-wide opacity-70">Agente comercial</span>
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
