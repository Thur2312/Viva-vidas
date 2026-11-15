"use client";
import { AlertTriangle, CheckCircle2, CircleHelp, Loader2, PauseCircle, XCircle, Clock, Play, Ban, FileEdit } from "lucide-react";
import { useEffect, useId, useRef, type ReactNode } from "react";
import type { BStatus, Quality } from "./api";

export const STATUS: Record<BStatus, { label: string; tone: string; icon: React.ElementType }> = {
  draft: { label: "Rascunho", tone: "border-line bg-ink/[0.06] text-mute", icon: FileEdit },
  scheduled: { label: "Agendado", tone: "border-brand/40 bg-brand/15 text-brand-ink", icon: Clock },
  running: { label: "Em andamento", tone: "border-ok/40 bg-ok/15 text-ok", icon: Play },
  paused: { label: "Pausado", tone: "border-warn/40 bg-warn/15 text-warn", icon: PauseCircle },
  completed: { label: "Concluído", tone: "border-ok/40 bg-ok/10 text-ok", icon: CheckCircle2 },
  cancelled: { label: "Cancelado", tone: "border-line bg-ink/[0.06] text-mute", icon: Ban },
  failed: { label: "Falhou", tone: "border-bad/40 bg-bad/10 text-bad", icon: XCircle },
};

export const PAUSE_REASON: Record<string, string> = {
  manual: "Pausado por uma pessoa",
  taxa_falha_alta: "Pausa automática: mais de 30% de falha nos últimos 20 envios (proteção da qualidade do número)",
  saude_numero: "Pausa automática: a saúde do número do WhatsApp exige atenção",
  template_nao_aprovado: "Pausa automática: o template deixou de estar aprovado",
  template_nao_verificado: "Pausa automática: não foi possível confirmar o status do template",
  chat_nao_configurado: "Pausa automática: o chat não está configurado",
  corpo_desconhecido: "Pausa automática: texto do template desconhecido",
};

export function StatusBadge({ status, dry }: { status: BStatus; dry?: boolean }) {
  const s = STATUS[status];
  const Icon = s.icon;
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${s.tone}`}>
        <Icon size={13} aria-hidden="true" />
        {s.label}
      </span>
      {dry && <span className="rounded-full border border-line px-2 py-1 text-xs font-semibold text-mute">Simulação</span>}
    </span>
  );
}

export function Progress({ value, label }: { value: number; label: string }) {
  const v = Math.max(0, Math.min(100, value));
  return (
    <div role="progressbar" aria-label={label} aria-valuenow={v} aria-valuemin={0} aria-valuemax={100} className="h-2 w-full overflow-hidden rounded-full bg-ink/10">
      <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${v}%` }} />
    </div>
  );
}

const Q: Record<Quality, { label: string; tone: string; icon: React.ElementType; hint: string }> = {
  GREEN: { label: "Verde: saudável", tone: "border-ok/40 bg-ok/15 text-ok", icon: CheckCircle2, hint: "Qualidade alta." },
  YELLOW: { label: "Amarela: atenção", tone: "border-warn/40 bg-warn/15 text-warn", icon: AlertTriangle, hint: "Qualidade média. A velocidade cai pela metade." },
  RED: { label: "Vermelha: risco", tone: "border-bad/40 bg-bad/10 text-bad", icon: XCircle, hint: "Qualidade baixa. Os disparos são pausados." },
  UNKNOWN: { label: "Ainda sem classificação", tone: "border-line bg-ink/[0.06] text-mute", icon: CircleHelp, hint: "A Meta ainda não classificou o número." },
};
export const qualityHint = (q: Quality) => Q[q].hint;

/** Qualidade em texto + ícone + cor (nunca só a cor). */
export function QualityBadge({ q }: { q: Quality }) {
  const s = Q[q] ?? Q.UNKNOWN;
  const Icon = s.icon;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-semibold ${s.tone}`}>
      <Icon size={15} aria-hidden="true" />
      {s.label}
    </span>
  );
}

export const TIER_LABEL: Record<string, string> = {
  TIER_50: "50 por dia", TIER_250: "250 por dia", TIER_1K: "1.000 por dia", TIER_10K: "10 mil por dia", TIER_100K: "100 mil por dia", TIER_UNLIMITED: "Sem limite",
};

/** Linha simples da qualidade ao longo do tempo (eixo: 1 = vermelha, 3 = verde). Tem alternativa em texto. */
export function Sparkline({ points }: { points: { checkedAt: string; qualityRating: Quality }[] }) {
  const rank = (q: Quality) => (q === "GREEN" ? 3 : q === "YELLOW" ? 2 : q === "RED" ? 1 : 0);
  if (points.length < 2) return <p className="text-xs text-mute">Histórico ainda curto: são necessárias ao menos 2 leituras.</p>;
  const w = 240, h = 40;
  const xs = points.map((_, i) => (i / (points.length - 1)) * (w - 8) + 4);
  const ys = points.map((p) => h - 6 - ((rank(p.qualityRating) / 3) * (h - 12)));
  const d = xs.map((x, i) => `${i ? "L" : "M"}${x.toFixed(1)},${ys[i].toFixed(1)}`).join(" ");
  const last = points[points.length - 1];
  const alt = `Qualidade nos últimos 14 dias: ${points.length} leituras, a última foi ${Q[last.qualityRating].label}.`;
  return (
    <figure className="m-0">
      <svg role="img" aria-label={alt} viewBox={`0 0 ${w} ${h}`} className="h-10 w-full max-w-[260px] text-brand-ink">
        <line x1="0" x2={w} y1={h - 6 - (h - 12)} y2={h - 6 - (h - 12)} stroke="currentColor" strokeOpacity="0.15" strokeDasharray="3 3" />
        <path d={d} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {xs.map((x, i) => (
          <circle key={i} cx={x} cy={ys[i]} r={i === xs.length - 1 ? 3.5 : 2} fill="currentColor" />
        ))}
      </svg>
      <figcaption className="sr-only">{alt}</figcaption>
    </figure>
  );
}

const FOCUSABLE = 'a[href],button:not([disabled]),input,select,textarea,[tabindex]:not([tabindex="-1"])';

/** Diálogo de confirmação acessível (foco preso, Esc fecha). */
export function ConfirmDialog({
  title, children, confirmLabel, danger, busy, error, onConfirm, onClose, disabled,
}: {
  title: string; children: ReactNode; confirmLabel: string; danger?: boolean; busy?: boolean; error?: string | null; disabled?: boolean;
  onConfirm: () => void; onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const tid = useId();
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab" && ref.current) {
        const f = [...ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
        if (!f.length) return;
        const a = f[0], z = f[f.length - 1];
        if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); }
        else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); prev?.focus(); };
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button type="button" aria-label="Fechar" className="absolute inset-0 bg-black/50" onClick={onClose} tabIndex={-1} />
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={tid} className="relative w-full max-w-md rounded-xl border border-line bg-card p-6 shadow-xl">
        <h2 id={tid} className="font-display text-lg font-semibold">{title}</h2>
        <div className="mt-2 space-y-2 text-sm text-ink/90">{children}</div>
        {error && <p role="alert" className="mt-3 rounded-lg border border-bad/40 bg-bad/10 p-3 text-sm text-bad">{error}</p>}
        <div className="mt-5 flex flex-wrap justify-end gap-3">
          <button type="button" onClick={onClose} className="min-h-[44px] rounded-full border border-line px-5 text-sm font-semibold hover:bg-ink/5">Voltar</button>
          <button
            type="button" onClick={onConfirm} disabled={busy || disabled}
            className={`inline-flex min-h-[44px] items-center gap-2 rounded-full px-5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40 ${danger ? "bg-bad text-white" : "bg-deep text-white dark:bg-brand dark:text-deep"}`}
          >
            {busy && <Loader2 size={15} className="animate-spin" aria-hidden="true" />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export const btn = "inline-flex min-h-[44px] items-center justify-center gap-2 rounded-full px-5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40";
export const btnPrimary = `${btn} bg-deep text-white shadow-sm hover:opacity-90 dark:bg-brand dark:text-deep`;
export const btnGhost = `${btn} border border-line bg-card hover:bg-ink/5`;
/** Botão secundário (retangular): a pílula é só do botão primário e dos chips. */
export const btnSec = "inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg border border-line bg-card px-4 text-sm font-semibold hover:bg-ink/5 disabled:cursor-not-allowed disabled:opacity-40";
export const field = "min-h-[44px] w-full rounded-lg border border-line bg-card px-3 text-sm";
