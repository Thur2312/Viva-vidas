"use client";
import { Plus } from "lucide-react";
import Link from "next/link";
import { EmptyState, QueryBlock, Skeleton } from "@/components/Block";
import { dateTime, num } from "@/lib/format";
import { linhaDisparo } from "@/lib/disparos-view";
import { useBroadcasts } from "./api";
import { PAUSE_REASON, Progress, StatusBadge, btnPrimary } from "./bits";

const TH = "px-3 py-2 text-right font-mono text-[11px] font-medium uppercase tracking-wider text-mute";

/** Lista de disparos em tabela: uma linha por disparo, números alinhados para comparar. Simulação nunca é contada como envio real. */
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
        q={q} skeleton={<div className="space-y-3"><Skeleton className="h-12" /><Skeleton className="h-12" /><Skeleton className="h-12" /></div>}
        isEmpty={(d) => d.data.length === 0}
        empty={<EmptyState title="Nenhum disparo ainda">Crie o primeiro disparo. Ele começa como simulação: registra o que seria enviado, sem chamar o WhatsApp.</EmptyState>}
      >
        {(d) => (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-y border-line text-sm">
              <caption className="sr-only">Disparos, do mais recente ao mais antigo</caption>
              <thead>
                <tr className="border-b border-line">
                  <th scope="col" className="px-3 py-2 text-left font-mono text-[11px] font-medium uppercase tracking-wider text-mute">Disparo</th>
                  <th scope="col" className="px-3 py-2 text-left font-mono text-[11px] font-medium uppercase tracking-wider text-mute">Estado</th>
                  <th scope="col" className="px-3 py-2 text-left font-mono text-[11px] font-medium uppercase tracking-wider text-mute">Progresso</th>
                  <th scope="col" className={TH}>Enviados</th>
                  <th scope="col" className={TH}>Falhas</th>
                  <th scope="col" className={TH}>Pulados</th>
                  <th scope="col" className={TH}>Na fila</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {d.data.map((b) => {
                  const l = linhaDisparo(b);
                  return (
                    <tr key={b.id} className="align-top hover:bg-ink/[0.03]">
                      <td className="min-w-[220px] px-3 py-3">
                        <Link href={`/disparos/${b.id}`} className="font-medium underline-offset-2 hover:underline">{b.name}</Link>
                        <p className="mt-0.5 text-xs text-mute">
                          {b.kind === "template" ? `Template ${b.templateName ?? "(não escolhido)"}` : "Texto livre na janela de 24h"} · criado em {dateTime(b.createdAt)}
                        </p>
                      </td>
                      <td className="px-3 py-3">
                        <StatusBadge status={b.status} dry={b.dryRun} />
                        {b.status === "paused" && b.pausedReason && <p className="mt-1.5 max-w-[240px] text-xs text-warn">{PAUSE_REASON[b.pausedReason] ?? b.pausedReason}</p>}
                      </td>
                      <td className="w-[150px] px-3 py-3">
                        {l.semDestinatarios ? (
                          <span className="text-xs text-mute">Sem destinatários (rascunho)</span>
                        ) : (
                          <>
                            <Progress value={b.progress} label={`Progresso de ${b.name}`} />
                            <span className="tabular mt-1 block text-xs text-mute">{num(b.progress)}% processado</span>
                          </>
                        )}
                      </td>
                      {l.semDestinatarios ? (
                        <td colSpan={4} className="px-3 py-3 text-right text-mute">—</td>
                      ) : (
                        <>
                          <td className="tabular px-3 py-3 text-right">
                            {num(l.enviados)}
                            {l.simulado && <span className="block text-xs text-mute">simulados</span>}
                          </td>
                          <td className={`tabular px-3 py-3 text-right ${l.falhas ? "font-semibold text-bad" : ""}`}>{num(l.falhas)}</td>
                          <td className="tabular px-3 py-3 text-right">{num(l.pulados)}</td>
                          <td className="tabular px-3 py-3 text-right">{num(l.naFila)}</td>
                        </>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </QueryBlock>
    </div>
  );
}
