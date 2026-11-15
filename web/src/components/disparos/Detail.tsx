"use client";
import { ArrowLeft, Ban, Pause, Play } from "lucide-react";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { EmptyState, QueryBlock, Skeleton } from "@/components/Block";
import { Folio, Manchete, Marginalia, Strip } from "@/components/folha";
import { dateTime, num, pct, ratio } from "@/lib/format";
import { leituraEntrega, mancheteDetalhe, type LeituraEntrega } from "@/lib/disparos-view";
import { ActionError, act, isManager, useAct, useBroadcast, useRecipients, type BroadcastDetail, type RStatus } from "./api";
import { NumberHealthCard } from "./NumberHealthCard";
import { ConfirmDialog, PAUSE_REASON, Progress, StatusBadge, btnPrimary, btnSec, field } from "./bits";

// Detalhe do disparo no desenho "Prontuário". A lógica de ler os números (simulação, "sem retorno do chat") está em lib/disparos-view.ts.

const R_LABEL: Record<RStatus, string> = {
  pending: "Na fila", queued: "Enviando", sent: "Enviado", delivered: "Entregue", read: "Lido", replied: "Respondeu", failed: "Falhou", skipped: "Pulado",
};
const ERR: Record<string, string> = {
  chat_400: "O chat/WhatsApp recusou a mensagem (dados inválidos)", chat_401: "Chat recusou a chave", chat_404: "Recurso não encontrado no chat",
  chat_429: "Limite de envio atingido", chat_500: "Erro no chat", chat_502: "Chat indisponível", chat_timeout: "Chat não respondeu a tempo",
  envio_interrompido: "O servidor reiniciou durante o envio (não reenviado por segurança)",
};

const TH = "px-3 py-2 text-left font-mono text-[11px] font-medium uppercase tracking-wider text-mute";
const SEM_RETORNO = <span className="font-sans text-base font-medium text-mute">sem retorno do chat</span>;

/** Valor de Entregues/Lidos: nunca "0" quando o que falta é o retorno do chat. */
function valorEntrega(l: LeituraEntrega, n: number): { value: ReactNode; sub?: string } {
  if (l === "simulacao") return { value: "—", sub: "não se aplica à simulação" };
  if (l === "sem-retorno") return { value: SEM_RETORNO, sub: "o chat ainda não informou entrega nem leitura" };
  return { value: num(n) };
}

function Funnel({ f, leitura }: { f: BroadcastDetail["funnel"]; leitura: LeituraEntrega }) {
  const steps: { l: string; v: number; semDado?: string }[] = [
    { l: "Enviados", v: f.sent },
    { l: "Entregues", v: f.delivered, semDado: leitura === "simulacao" ? "não se aplica à simulação" : leitura === "sem-retorno" ? "sem retorno do chat" : undefined },
    { l: "Lidos", v: f.read, semDado: leitura === "simulacao" ? "não se aplica à simulação" : leitura === "sem-retorno" ? "sem retorno do chat" : undefined },
    { l: "Responderam", v: f.replied, semDado: leitura === "simulacao" ? "não se aplica à simulação" : undefined },
    { l: "Converteram", v: f.converted, semDado: leitura === "simulacao" ? "não se aplica à simulação" : undefined },
  ];
  const max = Math.max(1, f.sent);
  return (
    <ol className="space-y-3" aria-label="Funil do disparo">
      {steps.map((s, i) => (
        <li key={s.l}>
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
            <span className="font-medium">{s.l}</span>
            {s.semDado ? (
              <span className="text-mute">{s.semDado}</span>
            ) : (
              <span className="tabular">{num(s.v)}{i > 0 && steps[i - 1].v > 0 && !steps[i - 1].semDado ? <span className="text-mute"> · {pct(ratio(s.v, steps[i - 1].v))} da etapa anterior</span> : ""}</span>
            )}
          </div>
          <div className="mt-1 h-2 overflow-hidden rounded-full bg-ink/10"><div className="h-full rounded-full bg-brand" style={{ width: `${s.semDado ? 0 : (s.v / max) * 100}%` }} /></div>
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
    <Folio n="03" title="Destinatários" hint="Telefones mascarados. O detalhe do lead fica na área de Funil."
      action={
        <label className="text-xs font-medium text-mute">Situação
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
              <table className="w-full min-w-[640px] border-y border-line text-left text-sm">
                <caption className="sr-only">Destinatários do disparo</caption>
                <thead><tr className="border-b border-line"><th scope="col" className={TH}>Lead</th><th scope="col" className={TH}>Telefone</th><th scope="col" className={TH}>Situação</th><th scope="col" className={TH}>Enviado</th><th scope="col" className={TH}>Detalhe</th></tr></thead>
                <tbody className="divide-y divide-line">
                  {d.data.map((r) => (
                    <tr key={r.id}>
                      <td className="px-3 py-2.5 font-medium">{r.firstName ?? "—"}</td>
                      <td className="tabular px-3">{r.phone ?? "—"}</td>
                      <td className="px-3">{R_LABEL[r.status]}</td>
                      <td className="tabular px-3">{dateTime(r.sentAt)}</td>
                      <td className="px-3 text-mute">{r.skipLabel ?? (r.errorCode ? ERR[r.errorCode] ?? r.errorCode : r.repliedAt ? `Respondeu ${dateTime(r.repliedAt)}` : "")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm">
              <span className="text-mute">Página {d.meta.page} de {Math.max(1, d.meta.totalPages)} · {num(d.meta.totalItems)} no total</span>
              <span className="flex gap-2">
                <button type="button" className={btnSec} disabled={page <= 1} onClick={() => setPage(page - 1)}>Anterior</button>
                <button type="button" className={btnSec} disabled={page >= d.meta.totalPages} onClick={() => setPage(page + 1)}>Próxima</button>
              </span>
            </div>
          </>
        )}
      </QueryBlock>
    </Folio>
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
        const leitura = leituraEntrega(k, d.simulated);
        const mh = mancheteDetalhe(k, d.simulated, b.total);
        const entregues = valorEntrega(leitura, k.delivered);
        const lidos = valorEntrega(leitura, k.read);
        const naoSeAplica = d.simulated ? "não se aplica à simulação" : undefined;
        return (
          <div className="space-y-10">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Link href="/disparos" className="inline-flex min-h-[44px] items-center gap-2 text-sm font-semibold text-brand-ink hover:underline"><ArrowLeft size={15} aria-hidden="true" />Todos os disparos</Link>
              {manager && (
                <div className="flex flex-wrap gap-2">
                  {(b.status === "running" || b.status === "scheduled") && <button type="button" className={btnSec} onClick={() => { setErr(null); setDlg("pause"); }}><Pause size={15} aria-hidden="true" />Pausar</button>}
                  {b.status === "paused" && <button type="button" className={btnPrimary} onClick={() => { setErr(null); setDlg("resume"); }}><Play size={15} aria-hidden="true" />Retomar</button>}
                  {["draft", "scheduled", "running", "paused"].includes(b.status) && <button type="button" className={`${btnSec} text-bad`} onClick={() => { setErr(null); setDlg("cancel"); }}><Ban size={15} aria-hidden="true" />Cancelar</button>}
                </div>
              )}
            </div>

            <div className="grid gap-x-14 gap-y-12 xl:grid-cols-[minmax(0,1fr)_320px]">
              <div className="min-w-0 space-y-10">
                <header>
                  <div className="flex flex-wrap items-center gap-3"><h2 className="font-display text-2xl leading-tight">{b.name}</h2><StatusBadge status={b.status} dry={b.dryRun} /></div>
                  {b.objective && <p className="mt-1 text-sm text-mute">{b.objective}</p>}
                  <div className="mt-4 max-w-xl"><Progress value={b.progress} label="Progresso do disparo" /><p className="tabular mt-1 text-xs text-mute">{b.progress}% processado de {num(b.total)} destinatários</p></div>
                </header>

                {(d.simulated || (b.status === "paused" && b.pausedReason) || (b.status === "running" && !d.safety.enabled && !b.dryRun)) && (
                  <div className="space-y-3 border-y border-line py-4 text-sm">
                    {d.simulated && <p role="status"><strong>Simulação.</strong> Estes números mostram o que SERIA enviado. Nenhuma mensagem foi enviada ao WhatsApp, então não há entrega, leitura nem resposta.</p>}
                    {b.status === "paused" && b.pausedReason && <p role="alert" className="font-semibold text-warn">{PAUSE_REASON[b.pausedReason] ?? b.pausedReason}</p>}
                    {b.status === "running" && !d.safety.enabled && !b.dryRun && <p role="alert">O interruptor geral de envio está desligado: este disparo está parado até ser ligado no servidor.</p>}
                  </div>
                )}

                <Manchete
                  label={mh.tipo === "simulado" ? "Enviados (simulados)" : "Responderam"}
                  tone="brand"
                  caption={
                    mh.tipo === "vazio" ? "Sem destinatários ainda: este disparo é um rascunho."
                    : mh.tipo === "simulado" ? "É o que SERIA enviado. Nada saiu para o WhatsApp, então não existe resposta."
                    : k.sent > 0 ? `${pct(ratio(k.replied, k.sent))} dos ${num(k.sent)} enviados. Resposta do lead em até 72 horas do envio.`
                    : "Ainda nada foi enviado."
                  }
                >
                  {mh.valor === null ? "—" : num(mh.valor)}
                </Manchete>

                <Strip
                  items={[
                    { label: "Enviados", value: num(k.sent), sub: d.simulated ? "simulados" : undefined },
                    { label: "Entregues", value: entregues.value, sub: entregues.sub ?? (k.sent ? pct(ratio(k.delivered, k.sent)) : undefined), tip: "Depende do retorno de entrega do chat (webhook)." },
                    { label: "Lidos", value: lidos.value, sub: lidos.sub ?? (k.sent ? pct(ratio(k.read, k.sent)) : undefined) },
                    { label: "Convertidos", value: naoSeAplica ? "—" : num(k.converted), sub: naoSeAplica ?? "reunião ou venda em 30 dias" },
                  ]}
                />

                <Folio n="01" title="Funil" hint="Enviado até convertido"><Funnel f={d.funnel} leitura={leitura} /></Folio>

                <Folio n="02" title="Erros e motivos" hint="Por código, sem dados pessoais">
                  {d.errors.length === 0 && d.skipReasons.length === 0 ? <p className="text-sm text-mute">Nenhum erro nem lead pulado.</p> : (
                    <div className="space-y-5 text-sm">
                      {d.errors.length > 0 && (
                        <div><p className="mb-1 font-mono text-[11px] font-medium uppercase tracking-wider text-mute">Falhas de envio</p>
                          <ul className="divide-y divide-line border-y border-line">{d.errors.map((e) => <li key={e.code ?? "?"} className="flex justify-between gap-3 py-2"><span>{ERR[e.code ?? ""] ?? e.code ?? "Sem código"}<span className="ml-2 font-mono text-xs text-mute">{e.code}</span></span><span className="tabular font-semibold">{num(e.n)}</span></li>)}</ul></div>
                      )}
                      {d.skipReasons.length > 0 && (
                        <div><p className="mb-1 font-mono text-[11px] font-medium uppercase tracking-wider text-mute">Pulados</p>
                          <ul className="divide-y divide-line border-y border-line">{d.skipReasons.map((e) => <li key={e.reason} className="flex justify-between gap-3 py-2"><span>{e.label}</span><span className="tabular font-semibold">{num(e.n)}</span></li>)}</ul></div>
                      )}
                    </div>
                  )}
                </Folio>

                <RecipientsTable id={id} />
              </div>

              <aside className="min-w-0 space-y-10" aria-label="Resultado, configuração e saúde do número">
                <section aria-labelledby="res-disparo">
                  <h2 id="res-disparo" className="mb-3 font-display text-xl leading-tight">Resultado</h2>
                  <Marginalia
                    items={[
                      { label: "Falhas", value: num(k.failed), tone: k.failed ? "bad" : undefined },
                      { label: "Pulados", value: num(k.skipped), sub: "barrados pelas regras" },
                      { label: "Opt-outs", value: naoSeAplica ? "—" : num(k.optOuts), sub: naoSeAplica ?? "saíram após receber", tone: !naoSeAplica && k.optOuts ? "warn" : undefined },
                    ]}
                  />
                </section>
                <section aria-labelledby="conf-disparo">
                  <h2 id="conf-disparo" className="mb-3 font-display text-xl leading-tight">Configuração</h2>
                  <Marginalia
                    items={[
                      { label: "Mensagem", value: <span className="text-sm">{b.kind === "template" ? b.templateName ?? "—" : "Texto livre"}</span> },
                      { label: "Janela", value: <span className="text-sm">{b.window.start} às {b.window.end}</span> },
                      { label: "Velocidade", value: <span className="text-sm">{b.ratePerMinute}/min</span> },
                      { label: "Teto por dia", value: <span className="text-sm">{num(b.dailyCap)}</span> },
                      { label: "Iniciado", value: <span className="text-sm">{b.startedAt ? dateTime(b.startedAt) : "ainda não"}</span> },
                    ]}
                  />
                </section>
                <NumberHealthCard compact />
              </aside>
            </div>

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
