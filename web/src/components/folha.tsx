import { useId, type ReactNode } from "react";

// Gramática do painel "Prontuário": seção numerada (folha), manchete numérica e marginália.
// Sem cartões: as seções se separam por filetes, e só o dado em si ganha superfície.

/** Folha numerada: "01 · Funil". O filete no topo organiza a página como um prontuário. */
export function Folio({ n, title, hint, action, children, className = "" }: { n: string; title: string; hint?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className={`border-t border-line pt-5 ${className}`}>
      <header className="mb-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <h2 id={id} className="font-display text-2xl leading-tight">
            <span className="mr-3 font-mono text-xs uppercase tracking-[0.18em] text-brand-ink">{n}</span>
            {title}
          </h2>
          {hint && <p className="mt-1 max-w-xl text-sm text-mute">{hint}</p>}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

/** O número que a página inteira existe para mostrar. Grande, em mono, com uma frase em serifa embaixo. */
export function Manchete({ label, children, caption, tone = "ink" }: { label: string; children: ReactNode; caption: ReactNode; tone?: "ink" | "brand" }) {
  return (
    <div className="rise">
      <p className="font-mono text-xs uppercase tracking-[0.18em] text-mute">{label}</p>
      <p className={`tabular mt-2 font-mono font-medium leading-none tracking-tight text-[clamp(3.5rem,9vw,6.5rem)] ${tone === "brand" ? "text-brand-ink" : "text-ink"}`}>{children}</p>
      <p className="mt-4 max-w-xl font-display text-xl leading-snug text-ink/90 sm:text-2xl">{caption}</p>
    </div>
  );
}

export type MarginItem = { label: string; value: ReactNode; sub?: string; tip?: string; tone?: "ok" | "warn" | "bad" };
const toneCls = { ok: "text-ok", warn: "text-warn", bad: "text-bad" } as const;

/** Marginália: métricas secundárias em lista densa (rótulo à esquerda, valor mono à direita, nota embaixo). */
export function Marginalia({ items, className = "" }: { items: MarginItem[]; className?: string }) {
  return (
    <dl className={`divide-y divide-line border-y border-line ${className}`}>
      {items.map((it) => (
        <div key={it.label} className="grid grid-cols-[1fr_auto] items-baseline gap-x-4 py-3" title={it.tip}>
          <dt className="text-sm text-mute">{it.label}</dt>
          <dd className={`tabular font-mono text-xl font-medium ${it.tone ? toneCls[it.tone] : ""}`}>{it.value}</dd>
          {it.sub && <dd className="col-span-2 mt-0.5 text-xs text-mute">{it.sub}</dd>}
        </div>
      ))}
    </dl>
  );
}
