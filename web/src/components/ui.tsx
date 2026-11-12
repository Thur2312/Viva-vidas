import { HelpCircle, Minus, TrendingDown, TrendingUp } from "lucide-react";
import { DemoBadge } from "./Brand";
import { DEMO } from "@/lib/flags";

export function PageHeader({ eyebrow, title, children }: { eyebrow: string; title: string; children?: React.ReactNode }) {
  return (
    <header className="rise mb-7 flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="mb-2 font-mono text-xs uppercase tracking-[0.18em] text-brand-ink">{eyebrow}</p>
        <h1 className="font-display text-[clamp(2rem,4.2vw,3.5rem)] leading-[1.05]">{title}</h1>
        {children && <p className="mt-2 max-w-2xl text-[15px] text-mute">{children}</p>}
      </div>
      {DEMO && <DemoBadge />}
    </header>
  );
}

// Equivalente ao ChartCard do HDM: título, subtítulo, ação opcional e conteúdo.
export function Panel({
  title, hint, action, children, className = "",
}: { title?: string; hint?: string; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-line bg-card p-5 ${className}`}>
      {(title || action) && (
        <div className="mb-4 flex flex-col justify-between gap-2 sm:flex-row sm:items-center sm:gap-4">
          <div className="min-w-0">
            {title && <h2 className="font-display text-base font-semibold">{title}</h2>}
            {hint && <p className="mt-0.5 text-sm text-mute">{hint}</p>}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

type Variant = "default" | "primary" | "success" | "warning";

const box: Record<Variant, string> = {
  default: "border-line bg-card",
  primary: "border-brand/40 bg-gradient-to-br from-brand/15 to-brand/[0.04]",
  success: "border-ok/30 bg-gradient-to-br from-ok/15 to-ok/[0.03]",
  warning: "border-warn/30 bg-gradient-to-br from-warn/15 to-warn/[0.03]",
};
const chip: Record<Variant, string> = {
  default: "bg-ink/[0.07] text-mute",
  primary: "bg-brand/20 text-brand-ink",
  success: "bg-ok/15 text-ok",
  warning: "bg-warn/15 text-warn",
};

// Equivalente ao KPICard do HDM: título, valor, tendência, ícone e dica.
export function KpiCard({
  title, value, sub, icon, trend, tip, variant = "default",
}: { title: string; value: string; sub?: string; icon?: React.ReactNode; trend?: number; tip?: string; variant?: Variant }) {
  const TrendIcon = trend === undefined ? null : trend > 0 ? TrendingUp : trend < 0 ? TrendingDown : Minus;
  const trendTone = trend === undefined ? "" : trend > 0 ? "text-ok" : trend < 0 ? "text-warn" : "text-mute";

  return (
    <div className={`rise rounded-xl border p-4 transition-shadow hover:shadow-md ${box[variant]}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p className="text-xs font-semibold uppercase tracking-wider text-mute">{title}</p>
            {tip && (
              <span className="group relative">
                <button type="button" aria-label={`Sobre ${title}: ${tip}`} className="-m-3 inline-flex h-11 w-11 items-center justify-center rounded-full text-mute">
                  <HelpCircle size={14} aria-hidden="true" />
                </button>
                <span role="tooltip" className="pointer-events-none absolute left-1/2 top-7 z-10 hidden w-56 -translate-x-1/2 rounded-md bg-deep p-2 text-xs font-normal normal-case tracking-normal text-white shadow-lg group-focus-within:block group-hover:block">
                  {tip}
                </span>
              </span>
            )}
          </div>
          <p className="tabular mt-2 font-mono text-[1.75rem] font-medium leading-none tracking-tight">{value}</p>
          {(TrendIcon || sub) && (
            <div className="mt-2 flex flex-wrap items-center gap-x-2 text-xs text-mute">
              {TrendIcon && trend !== undefined && (
                <span className={`tabular inline-flex items-center gap-1 font-semibold ${trendTone}`}>
                  <TrendIcon size={14} aria-hidden="true" />
                  {Math.abs(trend)}%
                </span>
              )}
              {sub && <span>{sub}</span>}
            </div>
          )}
        </div>
        {icon && <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${chip[variant]}`}>{icon}</div>}
      </div>
    </div>
  );
}

export function ScoreDot({ score }: { score: number }) {
  const tone = score >= 75 ? "bg-ok" : score >= 45 ? "bg-brand" : "bg-mute";
  return (
    <span className="tabular inline-flex items-center gap-1.5 text-xs font-semibold" title={`Score ${score}`}>
      <span className={`h-2 w-2 rounded-full ${tone}`} aria-hidden="true" />
      {score}
    </span>
  );
}
