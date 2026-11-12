"use client";
import { ArrowLeft, Ban, Pause, Play } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { EmptyState, QueryBlock, Skeleton } from "@/components/Block";
import { KpiCard, Panel } from "@/components/ui";
import { dateTime, num, pct, ratio } from "@/lib/format";
import { ActionError, act, isManager, useAct, useBroadcast, useRecipients, type BroadcastDetail, type RStatus } from "./api";
import { ConfirmDialog, PAUSE_REASON, Progress, StatusBadge, btnGhost, btnPrimary, field } from "./bits";

const R_LABEL: Record<RStatus, string> = {
  pending: "Na fila", queued: "Enviando", sent: "Enviado", delivered: "Entregue", read: "Lido", replied: "Respondeu", failed: "Falhou", skipped: "Pulado",
};
const ERR: Record<string, string> = {
  chat_400: "O chat/WhatsApp recusou a mensagem (dados inválidos)", chat_401: "Chat recusou a chave", chat_404: "Recurso não encontrado no chat",
  chat_429: "Limite de envio atingido", chat_500: "Erro no chat", chat_502: "Chat indisponível", chat_timeout: "Chat não respondeu a tempo",
  envio_interrompido: "O servidor reiniciou durante o envio (não reenviado por segurança)",
};

function Funnel({ f, total }: { f: BroadcastDetail["funnel"]; total: number }) {
  const steps: [string, number][] = [["Enviados", f.sent], ["Entregues", f.delivered], ["Lidos", f.read], ["Responderam", f.replied], ["Converteram", f.converted]];
  const max = Math.max(1, f.sent, total && 0);
  return (
    <ol className="space-y-2.5" aria-label="Funil do disparo">
      {steps.map(([l, v], i) => (
        <li key={l}>
          <div className="flex justify-between text-sm"><span className="font-semibold">{l}</span><span className="tabular">{num(v)}{i > 0 && steps[i - 1][1] > 0 ? ` · ${pct(ratio(v, steps[i - 1][1]))} da etapa anterior` : ""}</span></div>
          <div className="mt-1 h-3 overflow-hidden rounded-full bg-ink/10"><div className="h-full rounded-full bg-brand" style={{ width: `${(v / max) * 100}%` }} /></div>
        </li>
      ))}
    </ol>
  );
}

function RecipientsTable({ id }: { id: string }) {
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const q = useRecipients(id, status, page);
  return (
    <Panel title="Destinatários" hint="Telefones mascarados. O detalhe do lead fica na área de Funil."
      action={
        <label className="text-xs font-semibold text-mute">Situação
          <select className={`${field} ml-2 inline-block w-auto text-ink`} value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
            <option value="">Todas</option>
            {(Object.keys(R_LABEL) as RStatus[]).map((k) => <option key={k} value={k}>{R_LABEL[k]}</option>)}
          </select>
        </label>
      }>
      <QueryBlock q={q} skeleton={<Skeleton className="h-48" />} isEmpty={(d) => d.data.length === 0} empty={<EmptyState title="Nenhum destinatário nesta situação" />}>
        {(d) => (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-sm">
                <caption className="sr-only">Destinatários do disparo</caption>
                <thead><tr className="border-b border-line text-xs uppercase tracking-wider text-mute"><th scope="col" className="py-2 pr-3">Lead</th><th scope="col" className="pr-3">Telefone</th><th scope="col" className="pr-3">Situação</th><th scope="col" className="pr-3">Enviado</th><th scope="col">Detalhe</th></tr></thead>
                <tbody>
                  {d.data.map((r) => (
                    <tr key={r.id} className="border-b border-line/60">
                      <td className="py-2.5 pr-3 font-semibold">{r.firstName ?? "—"}</td>
                      <td className="tabular pr-3">{r.phone ?? "—"}</td>
                      <td className="pr-3">{R_LABEL[r.status]}</td>
                      <td className="tabular pr-3">{dateTime(r.sentAt)}</td>
                      <td className="text-mute">{r.skipLabel ?? (r.errorCode ? ERR[r.errorCode] ?? r.errorCode : r.repliedAt ? `Respondeu ${dateTime(r.repliedAt)}` : "")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-3 flex items-center justify-between text-sm">
              <span className="text-mute">Página {d.meta.page} de {Math.max(1, d.meta.totalPages)} · {num(d.meta.totalItems)} no total</span>
              <span className="flex gap-2">
                <button type="button" className={btnGhost} disabled={page <= 1} onClick={() => setPage(page - 1)}>Anterior</button>
                <button type="button" className={btnGhost} disabled={page >= d.meta.totalPages} onClick={() => setPage(page + 1)}>Próxima</button>
              </span>
            </div>
          </>
        )}
      </QueryBlock>
    </Panel>
  );
}

export function Detail({ id, role }: { id: string; role?: string }) {
  const q = useBroadcast(id);
  const [dlg, setDlg] = useState<null | "pause" | "resume" | "cancel">(null);
  const [err, setErr] = useState<string | null>(null);
  const m = useAct((a: "pause" | "resume" | "cancel") => act("POST", `${id}/${a}`, a === "resume" ? { confirm: true } : {}));
  const manager = isManager(role);
  const run = (a: "pause" | "resume" | "cancel") => m.mutate(a, { onSuccess: () => setDlg(null), onError: (e) => setErr(e instanceof ActionError ? e.userMessage : "Não foi possível concluir.") });

  return (
    <QueryBlock q={q} skeleton={<div className="space-y-6"><Skeleton className="h-28" /><Skeleton className="h-64" /></div>}>
      {(d) => {
        const b = d.broadcast;
        const k = d.kpis;
        return (
          <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Link href="/disparos" className="inline-flex min-h-[44px] items-center gap-2 text-sm font-semibold text-brand-ink hover:underline"><ArrowLeft size={15} aria-hidden="true" />Todos os disparos</Link>
              {manager && (
                <div className="flex flex-wrap gap-2">
                  {(b.status === "running" || b.status === "scheduled") && <button type="button" className={btnGhost} onClick={() => { setErr(null); setDlg("pause"); }}><Pause size={15} aria-hidden="true" />Pausar</button>}
                  {b.status === "paused" && <button type="button" className={btnPrimary} onClick={() => { setErr(null); setDlg("resume"); }}><Play size={15} aria-hidden="true" />Retomar</button>}
                  {["draft", "scheduled", "running", "paused"].includes(b.status) && <button type="button" className={`${btnGhost} text-bad`} onClick={() => { setErr(null); setDlg("cancel"); }}><Ban size={15} aria-hidden="true" />Cancelar</button>}
                </div>
              )}
            </div>

            <div>
              <div className="flex flex-wrap items-center gap-3"><h2 className="font-display text-xl font-semibold">{b.name}</h2><StatusBadge status={b.status} dry={b.dryRun} /></div>
              {b.objective && <p className="mt-1 text-sm text-mute">{b.objective}</p>}
              <p className="mt-1 text-xs text-mute">
                {b.kind === "template" ? `Template ${b.templateName}` : "Texto livre"} · janela {b.window.start} às {b.window.end} · {b.ratePerMinute}/min · teto {num(b.dailyCap)}/dia
                {b.startedAt ? ` · iniciado ${dateTime(b.startedAt)}` : ""}
              </p>
              <div className="mt-3 max-w-xl"><Progress value={b.progress} label="Progresso do disparo" /><p className="tabular mt-1 text-xs text-mute">{b.progress}% processado de {num(b.total)} destinatários</p></div>
            </div>

            {d.simulated && <p role="status" className="rounded-xl border border-brand/40 bg-brand/10 p-4 text-sm"><strong>Simulação.</strong> Estes números mostram o que SERIA enviado. Nenhuma mensagem foi enviada ao WhatsApp, então não há entrega, leitura nem resposta.</p>}
            {b.status === "paused" && b.pausedReason && <p role="alert" className="rounded-xl border border-warn/40 bg-warn/10 p-4 text-sm font-semibold text-warn">{PAUSE_REASON[b.pausedReason] ?? b.pausedReason}</p>}
            {b.status === "running" && !d.safety.enabled && !b.dryRun && <p role="alert" className="rounded-xl border border-warn/40 bg-warn/10 p-4 text-sm">O interruptor geral de envio está desligado: este disparo está parado até ser ligado no servidor.</p>}

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <KpiCard title="Enviados" value={num(k.sent)} sub={d.simulated ? "simulados" : undefined} />
              <KpiCard title="Entregues" value={num(k.delivered)} sub={k.sent ? pct(ratio(k.delivered, k.sent)) : undefined} tip="Depende do retorno de entrega do chat (webhook). Sem ele fica em zero." />
              <KpiCard title="Lidos" value={num(k.read)} sub={k.sent ? pct(ratio(k.read, k.sent)) : undefined} />
              <KpiCard title="Responderam" value={num(k.replied)} sub={k.sent ? pct(ratio(k.replied, k.sent)) : undefined} variant="primary" tip="Resposta do lead em até 72h do envio." />
              <KpiCard title="Convertidos" value={num(k.converted)} sub="reunião ou venda em 30 dias" variant="success" />
              <KpiCard title="Falhas" value={num(k.failed)} variant={k.failed ? "warning" : "default"} />
              <KpiCard title="Pulados" value={num(k.skipped)} sub="barrados pelas regras" />
              <KpiCard title="Opt-outs" value={num(k.optOuts)} sub="saíram após receber" variant={k.optOuts ? "warning" : "default"} />
            </div>

            <div className="grid gap-6 lg:grid-cols-2">
              <Panel title="Funil" hint="Enviado até convertido"><Funnel f={d.funnel} total={b.total} /></Panel>
              <Panel title="Erros e motivos" hint="Por código, sem dados pessoais">
                {d.errors.length === 0 && d.skipReasons.length === 0 ? <p className="text-sm text-mute">Nenhum erro nem lead pulado.</p> : (
                  <div className="space-y-4 text-sm">
                    {d.errors.length > 0 && (
                      <div><p className="mb-1 text-xs font-semibold uppercase tracking-wider text-mute">Falhas de envio</p>
                        <ul className="space-y-1">{d.errors.map((e) => <li key={e.code ?? "?"} className="flex justify-between gap-3"><span>{ERR[e.code ?? ""] ?? e.code ?? "Sem código"}<span className="ml-2 font-mono text-xs text-mute">{e.code}</span></span><span className="tabular font-semibold">{num(e.n)}</span></li>)}</ul></div>
                    )}
                    {d.skipReasons.length > 0 && (
                      <div><p className="mb-1 text-xs font-semibold uppercase tracking-wider text-mute">Pulados</p>
                        <ul className="space-y-1">{d.skipReasons.map((e) => <li key={e.reason} className="flex justify-between gap-3"><span>{e.label}</span><span className="tabular font-semibold">{num(e.n)}</span></li>)}</ul></div>
                    )}
                  </div>
                )}
              </Panel>
            </div>

            <RecipientsTable id={id} />

            {dlg && (
              <ConfirmDialog
                title={dlg === "pause" ? "Pausar este disparo?" : dlg === "resume" ? "Retomar este disparo?" : "Cancelar este disparo?"}
                confirmLabel={dlg === "pause" ? "Pausar" : dlg === "resume" ? "Retomar" : "Cancelar disparo"} danger={dlg === "cancel"}
                busy={m.isPending} error={err} onClose={() => setDlg(null)} onConfirm={() => run(dlg)}
              >
                {dlg === "pause" && <p>Nada mais é enviado até alguém retomar. Quem já recebeu continua contado.</p>}
                {dlg === "resume" && <p>O servidor confere a saúde do número e o interruptor geral antes de voltar a enviar. A retomada fica na trilha de auditoria.</p>}
                {dlg === "cancel" && <p>Quem ainda estava na fila nunca receberá esta mensagem. Não dá para desfazer.</p>}
              </ConfirmDialog>
            )}
          </div>
        );
      }}
    </QueryBlock>
  );
}
