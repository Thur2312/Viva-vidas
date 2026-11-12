"use client";

import { useIsFetching, type UseQueryResult } from "@tanstack/react-query";
import { AlertTriangle, Inbox, RefreshCw } from "lucide-react";
import { Component, type ReactNode } from "react";
import { describeError } from "@/lib/client";

/** Barra fina no topo enquanto qualquer consulta está em andamento (como no HDM). */
export function TopProgress() {
  const n = useIsFetching();
  if (n === 0) return null;
  return (
    <div role="progressbar" aria-label="Atualizando dados" aria-busy="true" className="pointer-events-none fixed inset-x-0 top-0 z-50 h-[3px] overflow-hidden bg-brand/20">
      <div className="topbar-run h-full w-1/3 bg-brand" />
    </div>
  );
}

export function Skeleton({ className = "h-32" }: { className?: string }) {
  return <div aria-hidden="true" className={`animate-pulse rounded-xl bg-ink/10 ${className}`} />;
}

export function ErrorState({ error, onRetry, compact = false }: { error: unknown; onRetry?: () => void; compact?: boolean }) {
  const { title, detail } = describeError(error);
  return (
    <div role="alert" className={`rounded-xl border border-bad/40 bg-bad/10 ${compact ? "p-3" : "p-5"}`}>
      <p className="flex items-center gap-2 text-sm font-semibold text-bad">
        <AlertTriangle size={16} aria-hidden="true" />
        {title}
      </p>
      <p className="mt-1 text-sm text-ink/80">{detail}</p>
      {onRetry && (
        <button type="button" onClick={onRetry} className="mt-3 inline-flex min-h-[44px] items-center gap-2 rounded-full border border-line bg-card px-4 text-sm font-semibold hover:bg-ink/5">
          <RefreshCw size={15} aria-hidden="true" />
          Tentar de novo
        </button>
      )}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-xl border border-dashed border-line px-6 py-10 text-center">
      <Inbox size={26} className="text-mute" aria-hidden="true" />
      <p className="mt-3 font-display text-lg font-semibold">{title}</p>
      {children && <p className="mt-1 max-w-md text-sm text-mute">{children}</p>}
    </div>
  );
}

// Erro de renderização num bloco não derruba a página inteira.
export class BlockBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed) return <ErrorState error={new Error("render")} onRetry={() => this.setState({ failed: false })} compact />;
    return this.props.children;
  }
}

/**
 * Um bloco da tela ligado a uma consulta: skeleton no primeiro carregamento, erro honesto com "tentar de novo",
 * e conteúdo esmaecido enquanto atualiza (keepPreviousData).
 */
export function QueryBlock<T>({
  q, skeleton, empty, isEmpty, children, className = "",
}: {
  q: UseQueryResult<T>;
  skeleton?: ReactNode;
  empty?: ReactNode;
  isEmpty?: (d: T) => boolean;
  children: (d: T) => ReactNode;
  className?: string;
}) {
  let body: ReactNode;
  if (q.isPending) body = skeleton ?? <Skeleton />;
  else if (q.isError && q.data === undefined) body = <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  else if (q.data !== undefined && isEmpty?.(q.data) && empty) body = empty;
  else if (q.data !== undefined) {
    body = (
      <>
        {q.isError && <div className="mb-3"><ErrorState error={q.error} onRetry={() => q.refetch()} compact /></div>}
        {children(q.data)}
      </>
    );
  }
  return (
    <BlockBoundary>
      <div aria-busy={q.isFetching} className={`transition-opacity duration-200 ${q.isFetching && !q.isPending ? "opacity-60" : ""} ${className}`}>
        {body}
      </div>
    </BlockBoundary>
  );
}
