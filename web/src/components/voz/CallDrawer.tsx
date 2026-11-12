"use client";

import { Lock, X } from "lucide-react";
import { useEffect, useId, useRef } from "react";
import { ErrorState, Skeleton } from "@/components/Block";
import { usePrivacy } from "@/components/Providers";
import { dateTime } from "@/lib/format";
import { EVENT_LABEL, STATE_LABEL, STATE_TONE, TRANSCRIPT_LABEL, duration } from "./labels";
import { useCall, type CallDetail } from "./voz-api";

const FOCUSABLE = 'a[href],button:not([disabled]),input,select,textarea,[tabindex]:not([tabindex="-1"])';

function timeline(d: CallDetail) {
  const items: { at: string; label: string }[] = [{ at: d.requested_at, label: EVENT_LABEL.queued }];
  for (const e of d.events ?? []) {
    if (e.kind === "status" && e.status && e.status !== "queued") items.push({ at: e.at, label: EVENT_LABEL[e.status] ?? e.status });
    else if (e.kind === "announcement") items.push({ at: e.at, label: "Lead atendeu e ouviu o aviso de gravação" });
    else if (e.kind === "recording") items.push({ at: e.at, label: e.status === "completed" ? "Gravação recebida do provedor" : "Evento de gravação" });
  }
  return items.sort((a, b) => +new Date(a.at) - +new Date(b.at));
}

const speakerName = (sp: string | null, seen: string[]) => {
  if (!sp) return "Voz";
  let i = seen.indexOf(sp);
  if (i < 0) { seen.push(sp); i = seen.length - 1; }
  return `Falante ${String.fromCharCode(65 + (i % 26))}`;
};

export function CallDrawer({ id, canSeeTranscript, onClose }: { id: string; canSeeTranscript: boolean; onClose: () => void }) {
  const q = useCall(id);
  const { hide } = usePrivacy();
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();

  // Foco entra no painel e fica preso nele; Esc fecha; o foco volta ao botão que abriu.
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    panel.current?.querySelector<HTMLElement>("button")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); onClose(); return; }
      if (e.key !== "Tab" || !panel.current) return;
      const els = Array.from(panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null);
      if (!els.length) return;
      const first = els[0], last = els[els.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); prev?.focus?.(); };
  }, [onClose]);

  const d = q.data;
  const seen: string[] = [];

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <button type="button" tabIndex={-1} aria-label="Fechar detalhes" className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div ref={panel} role="dialog" aria-modal="true" aria-labelledby={titleId} className="relative flex h-full w-full max-w-xl flex-col overflow-hidden border-l border-line bg-paper shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-line bg-card px-5 py-4">
          <div className="min-w-0">
            <h2 id={titleId} className="truncate font-display text-xl font-semibold">{d?.lead_name || (q.isPending ? "Carregando…" : "Ligação")}</h2>
            <p className="tabular text-sm text-mute">{d?.phone_masked ?? ""}</p>
            {d && <span className={`mt-2 inline-block rounded-full px-2.5 py-1 text-xs font-semibold ${STATE_TONE[d.status]}`}>{STATE_LABEL[d.status]}</span>}
          </div>
          <button type="button" onClick={onClose} className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-mute hover:bg-ink/10" aria-label="Fechar">
            <X size={20} aria-hidden="true" />
          </button>
        </div>

        <div className="flex-1 space-y-6 overflow-y-auto px-5 py-5">
          {q.isPending && <Skeleton className="h-64" />}
          {q.isError && !d && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
          {d && (
            <>
              <section aria-labelledby={`${titleId}-t`}>
                <h3 id={`${titleId}-t`} className="mb-3 text-xs font-semibold uppercase tracking-wider text-mute">Linha do tempo</h3>
                <ol className="space-y-3 border-l-2 border-line pl-4">
                  {timeline(d).map((e, i) => (
                    <li key={i} className="relative text-sm">
                      <span aria-hidden="true" className="absolute -left-[22px] top-1.5 h-2.5 w-2.5 rounded-full bg-brand" />
                      <p className="font-semibold">{e.label}</p>
                      <p className="tabular text-xs text-mute">{dateTime(e.at)}</p>
                    </li>
                  ))}
                </ol>
              </section>

              <section aria-labelledby={`${titleId}-d`}>
                <h3 id={`${titleId}-d`} className="mb-2 text-xs font-semibold uppercase tracking-wider text-mute">Detalhes</h3>
                <dl className="grid grid-cols-[150px_1fr] gap-y-1.5 text-sm">
                  <dt className="text-mute">Duração</dt><dd className="tabular">{duration(d.duration_sec)}</dd>
                  <dt className="text-mute">Lead atendeu</dt><dd>{d.answered_at ? dateTime(d.answered_at) : d.status === "completed" || d.status === "no_answer" ? "Não" : "—"}</dd>
                  <dt className="text-mute">Aviso de gravação</dt>
                  <dd>{d.recording_announced_at ? `Entregue${d.announcement_version ? ` (versão ${d.announcement_version})` : ""}` : "Não entregue"}</dd>
                  <dt className="text-mute">Gravação</dt>
                  <dd>
                    {d.has_recording
                      ? `Armazenada com segurança no provedor${d.retention_until ? `, apagada em ${dateTime(d.retention_until)}` : ""}. O áudio não é exibido nesta tela.`
                      : d.recording_deleted_at ? `Apagada em ${dateTime(d.recording_deleted_at)}` : "Sem gravação"}
                  </dd>
                  {d.failure_reason && (<><dt className="text-mute">Motivo da falha</dt><dd>{d.failure_reason}</dd></>)}
                </dl>
              </section>

              <section aria-labelledby={`${titleId}-x`}>
                <h3 id={`${titleId}-x`} className="mb-2 text-xs font-semibold uppercase tracking-wider text-mute">Transcrição</h3>
                {d.transcript ? (
                  <ul className="space-y-2.5">
                    {d.transcript.segments.map((s, i) => (
                      <li key={i} className="rounded-xl border border-line bg-card p-3 text-sm">
                        <p className="text-xs font-semibold text-mute">{speakerName(s.speaker, seen)}</p>
                        <p className={`whitespace-pre-wrap ${hide ? "sensitive" : ""}`}>{s.text}</p>
                      </li>
                    ))}
                  </ul>
                ) : d.transcript_restricted || (!canSeeTranscript && d.transcript_status === "done") ? (
                  <p className="flex items-start gap-2 rounded-xl border border-dashed border-line p-3 text-sm text-mute">
                    <Lock size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
                    Transcrição disponível apenas para gestores. Conversas por telefone podem conter dado de saúde (LGPD, art. 11), e cada leitura fica registrada.
                  </p>
                ) : (
                  <p className="text-sm text-mute">{TRANSCRIPT_LABEL[d.transcript_status]}.{d.transcript_status === "disabled" ? " Configure o provedor de transcrição para habilitar." : ""}</p>
                )}
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
