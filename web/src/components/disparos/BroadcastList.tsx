"use client";
import { Plus, Send } from "lucide-react";
import Link from "next/link";
import { EmptyState, QueryBlock, Skeleton } from "@/components/Block";
import { dateTime, num } from "@/lib/format";
import { useBroadcasts } from "./api";
import { PAUSE_REASON, Progress, StatusBadge, btnPrimary } from "./bits";

export function BroadcastList({ canCreate }: { canCreate: boolean }) {
  const q = useBroadcasts();
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-mute">Cada disparo tem público, mensagem, horário e limites próprios. Começa sempre em simulação.</p>
        {canCreate ? (
          <Link href="/disparos/novo" className={btnPrimary}><Plus size={16} aria-hidden="true" />Novo disparo</Link>
        ) : (
          <span className="text-sm text-mute">Só gerentes criam disparos.</span>
        )}
      </div>
      <QueryBlock
        q={q} skeleton={<div className="space-y-3"><Skeleton className="h-24" /><Skeleton className="h-24" /></div>}
        isEmpty={(d) => d.data.length === 0}
        empty={<EmptyState title="Nenhum disparo ainda">Crie o primeiro disparo. Ele começa como simulação: registra o que seria enviado, sem chamar o WhatsApp.</EmptyState>}
      >
        {(d) => (
          <ul className="space-y-3">
            {d.data.map((b) => (
              <li key={b.id}>
                <Link href={`/disparos/${b.id}`} className="block rounded-xl border border-line bg-card p-4 transition-shadow hover:shadow-md">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 font-display text-base font-semibold"><Send size={15} aria-hidden="true" className="shrink-0 text-brand-ink" /><span className="truncate">{b.name}</span></p>
                      <p className="mt-1 text-xs text-mute">
                        {b.kind === "template" ? `Template ${b.templateName ?? "(não escolhido)"}` : "Texto livre na janela de 24h"} · criado em {dateTime(b.createdAt)}
                      </p>
                    </div>
                    <StatusBadge status={b.status} dry={b.dryRun} />
                  </div>
                  {b.total > 0 ? (
                    <div className="mt-3">
                      <Progress value={b.progress} label={`Progresso de ${b.name}`} />
                      <p className="tabular mt-1.5 text-xs text-mute">
                        {num(b.progress)}% processado · {num((b.counts.sent ?? 0) + (b.counts.delivered ?? 0) + (b.counts.read ?? 0) + (b.counts.replied ?? 0))} enviados · {num(b.counts.failed ?? 0)} falhas · {num(b.counts.skipped ?? 0)} pulados · {num((b.counts.pending ?? 0) + (b.counts.queued ?? 0))} na fila
                      </p>
                    </div>
                  ) : (
                    <p className="mt-3 text-xs text-mute">Sem destinatários ainda (rascunho).</p>
                  )}
                  {b.status === "paused" && b.pausedReason && <p className="mt-2 text-xs font-semibold text-warn">{PAUSE_REASON[b.pausedReason] ?? b.pausedReason}</p>}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </QueryBlock>
    </div>
  );
}
