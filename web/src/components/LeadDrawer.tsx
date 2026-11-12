"use client";

import { Eye, EyeOff, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { ErrorState, Skeleton } from "./Block";
import { LeadConversation } from "./conversas/LeadConversation";
import { BookMeeting } from "./integracoes/BookMeeting";
import { usePrivacy } from "./Providers";
import { ScoreDot } from "./ui";
import { dateTime } from "@/lib/format";
import { useLead } from "@/lib/hooks";
import { STAGE_META, toNum, type Stage } from "@/lib/types";

type Obj = Record<string, unknown>;
// O contrato não fixa os nomes dos campos de events/messages/drafts: lemos com tolerância.
const str = (o: Obj | undefined, ...keys: string[]): string | undefined => {
  for (const k of keys) {
    const v = o?.[k];
    if (typeof v === "string" && v) return v;
  }
  return undefined;
};
const sim = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return n > 1 ? n / 100 : n;
};

function SimBadge({ v }: { v: number | null }) {
  if (v === null) return <span className="rounded-full bg-ink/10 px-2 py-0.5 text-xs font-semibold text-mute">sem comparação</span>;
  const pctv = Math.round(v * 100);
  const [tone, label] = v >= 0.8 ? ["bg-ok/15 text-ok", "alta"] : v >= 0.5 ? ["bg-warn/15 text-warn", "média"] : ["bg-bad/15 text-bad", "baixa"];
  return <span className={`tabular rounded-full px-2 py-0.5 text-xs font-semibold ${tone}`}>similaridade {label} · {pctv}%</span>;
}

const FOCUSABLE = 'a[href],button:not([disabled]),input,select,textarea,[tabindex]:not([tabindex="-1"])';

export function LeadDrawer({ leadId, onClose }: { leadId: string; onClose: () => void }) {
  const q = useLead(leadId);
  const { hide, setHide } = usePrivacy();
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const [tab, setTab] = useState<"resumo" | "conversa">("resumo");

  // Foco entra no painel, fica preso nele (Tab/Shift+Tab), Esc fecha, e o foco volta ao card ao sair.
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

  const blur = hide ? "sensitive" : "";
  const d = q.data;
  const lead = (d?.lead ?? {}) as Obj;
  const stage = str(lead, "stage") as Stage | undefined;
  const optOut = lead.opt_out === true;
  const consent = str(lead, "consent_status", "consent");
  const origin = [str(lead, "source"), str(lead, "campaign_name", "campaign"), str(lead, "ad_name", "ad_headline", "ad")].filter(Boolean);

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <button type="button" tabIndex={-1} aria-label="Fechar detalhes" className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div ref={panel} role="dialog" aria-modal="true" aria-labelledby={titleId} className="relative flex h-full w-full max-w-xl flex-col overflow-hidden border-l border-line bg-paper shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-line bg-card px-5 py-4">
          <div className="min-w-0">
            <h2 id={titleId} className="truncate font-display text-xl font-semibold">{str(lead, "name") ?? (q.isPending ? "Carregando…" : "Lead")}</h2>
            <p className="tabular text-sm text-mute">{str(lead, "phone") ?? ""}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {stage && <span className="rounded-full bg-deep px-2.5 py-0.5 text-xs font-semibold text-white dark:bg-brand dark:text-deep">{STAGE_META[stage]?.nome ?? stage}</span>}
              {lead.score !== undefined && lead.score !== null && <ScoreDot score={toNum(lead.score)} />}
              {optOut && <span className="rounded-full bg-bad/15 px-2.5 py-0.5 text-xs font-semibold text-bad">Pediu para não receber contato</span>}
            </div>
          </div>
          <div className="flex shrink-0 items-center">
            <button type="button" onClick={() => setHide(!hide)} aria-pressed={hide} className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-mute hover:bg-ink/10" aria-label={hide ? "Mostrar dados sensíveis" : "Ocultar dados sensíveis"} title={hide ? "Mostrar dados sensíveis" : "Ocultar dados sensíveis"}>
              {hide ? <EyeOff size={19} aria-hidden="true" /> : <Eye size={19} aria-hidden="true" />}
            </button>
            <button type="button" onClick={onClose} className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-mute hover:bg-ink/10" aria-label="Fechar">
              <X size={20} aria-hidden="true" />
            </button>
          </div>
        </div>

        <div role="tablist" aria-label="Seções do lead" className="flex gap-1 border-b border-line bg-card px-4">
          {([["resumo", "Resumo"], ["conversa", "Conversa"]] as const).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              id={`${titleId}-tab-${id}`}
              aria-selected={tab === id}
              aria-controls={`${titleId}-panel-${id}`}
              onClick={() => setTab(id)}
              className={`min-h-[44px] border-b-2 px-4 text-sm font-semibold transition-colors ${tab === id ? "border-brand text-ink" : "border-transparent text-mute hover:text-ink"}`}
            >
              {label}
            </button>
          ))}
        </div>

        <div role="tabpanel" id={`${titleId}-panel-resumo`} aria-labelledby={`${titleId}-tab-resumo`} hidden={tab !== "resumo"} className={`flex-1 space-y-6 overflow-y-auto px-5 py-5 ${tab === "resumo" ? "" : "hidden"}`}>
          {q.isPending && <Skeleton className="h-64" />}
          {q.isError && !d && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
          {d && (
            <>
              <section aria-labelledby={`${titleId}-o`}>
                <h3 id={`${titleId}-o`} className="mb-2 text-xs font-semibold uppercase tracking-wider text-mute">Origem e consentimento</h3>
                <dl className="grid grid-cols-[120px_1fr] gap-y-1.5 text-sm">
                  <dt className="text-mute">Origem</dt><dd>{origin.length ? origin.join(" · ") : "Não informada"}</dd>
                  <dt className="text-mute">Contato</dt><dd>{optOut ? "Não contatar (opt-out registrado)" : "Permitido"}</dd>
                  {consent && (<><dt className="text-mute">Consentimento</dt><dd>{consent}</dd></>)}
                </dl>
              </section>

              <BookMeeting leadId={leadId} blocked={optOut} alreadyBooked={d.events.some((e) => (e as Obj).type === "reuniao_marcada")} />

              <section aria-labelledby={`${titleId}-r`}>
                <h3 id={`${titleId}-r`} className="mb-2 text-xs font-semibold uppercase tracking-wider text-mute">Rascunhos do agente × resposta humana</h3>
                {d.drafts.length === 0 ? (
                  <p className="text-sm text-mute">Nenhum rascunho do agente para este lead.</p>
                ) : (
                  <ul className="space-y-3">
                    {d.drafts.map((r, i) => (
                      <li key={str(r, "id") ?? i} className="rounded-xl border border-line bg-card p-3 text-sm">
                        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                          <span className="text-xs text-mute">{dateTime(r.created_at)}</span>
                          <SimBadge v={sim(r.similarity)} />
                        </div>
                        <p className="text-xs font-semibold text-mute">Agente (rascunho, não enviado)</p>
                        <p className={`whitespace-pre-wrap ${blur}`}>{str(r, "body", "text", "draft", "content") ?? "—"}</p>
                        <p className="mt-2 text-xs font-semibold text-mute">Equipe (resposta enviada)</p>
                        <p className={`whitespace-pre-wrap ${blur}`}>{str(r, "human_reply", "human_body", "human", "final") ?? "Ainda sem resposta humana para comparar."}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section aria-labelledby={`${titleId}-t`}>
                <h3 id={`${titleId}-t`} className="mb-2 text-xs font-semibold uppercase tracking-wider text-mute">Linha do tempo</h3>
                {d.events.length === 0 ? (
                  <p className="text-sm text-mute">Sem eventos registrados.</p>
                ) : (
                  <ol className="space-y-3 border-l border-line pl-4">
                    {d.events.map((e, i) => (
                      <li key={str(e, "id") ?? i} className="relative text-sm">
                        <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-brand" aria-hidden="true" />
                        <p className="font-medium capitalize">{(str(e, "type", "event", "name") ?? "evento").replace(/_/g, " ")}</p>
                        <p className="text-xs text-mute">{dateTime(e.created_at ?? e.at)}{str(e, "actor") ? ` · ${str(e, "actor")}` : ""}</p>
                      </li>
                    ))}
                  </ol>
                )}
              </section>
            </>
          )}
        </div>

        {tab === "conversa" && (
          <div role="tabpanel" id={`${titleId}-panel-conversa`} aria-labelledby={`${titleId}-tab-conversa`} className="flex min-h-0 flex-1 flex-col">
            <LeadConversation leadId={leadId} />
          </div>
        )}
      </div>
    </div>
  );
}
