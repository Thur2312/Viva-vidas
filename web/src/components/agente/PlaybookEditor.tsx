"use client";
import { Archive, CheckCircle2, ChevronDown, CircleAlert, FileEdit, Loader2, ShieldAlert } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { QueryBlock, Skeleton } from "@/components/Block";
import { ConfirmDialog, Progress, btnPrimary, btnSec, field } from "@/components/disparos/bits";
import { ActionError } from "@/lib/client";
import { dateTime } from "@/lib/format";
import { useActivatePlaybook, usePlaybook, usePlaybookVersion, useSavePlaybook } from "@/lib/hooks";
import type { PlaybookData, PlaybookOverview, PlaybookStatus } from "@/lib/types";
import { Exemplo, roField } from "./fields";
import {
  OPTIONAL_SECTIONS, PLAYBOOK_MAX_BYTES, SECTION_KEYS, SECTION_LABEL, checkPlaybook, cleanPlaybook, jsonBytes, normalizePlaybook, parseMissing, type SectionKey,
} from "./playbook-api";
import { SectionBody } from "./SectionBody";

// Editor do playbook de vendas. Leitura para todos; salvar e ativar só para o dono (o servidor confere de novo).
// A completude ao vivo usa as mesmas regras do servidor, mas quem decide é o servidor, na hora de ativar.

const STATUS: Record<PlaybookStatus, { label: string; tone: string; icon: React.ElementType }> = {
  rascunho: { label: "Rascunho", tone: "border-line bg-ink/[0.06] text-mute", icon: FileEdit },
  ativo: { label: "Ativo", tone: "border-ok/40 bg-ok/15 text-ok", icon: CheckCircle2 },
  arquivado: { label: "Arquivado", tone: "border-line bg-ink/[0.06] text-mute", icon: Archive },
};

function StatusBadge({ s }: { s: PlaybookStatus | "novo" }) {
  const x = s === "novo" ? { label: "Não salvo", tone: "border-warn/40 bg-warn/15 text-warn", icon: FileEdit } : STATUS[s] ?? STATUS.rascunho;
  const Icon = x.icon;
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold ${x.tone}`}>
      <Icon size={12} aria-hidden="true" />
      {x.label}
    </span>
  );
}

const DESCARTAR = "Há alterações não salvas no playbook. Descartar e continuar?";
const secId = (k: SectionKey) => `pb-sec-${k}`;

export function PlaybookEditor({ owner }: { owner: boolean }) {
  const ov = usePlaybook();
  return (
    <QueryBlock q={ov} skeleton={<Skeleton className="h-96" />}>
      {(o) => <Editor o={o} owner={owner} />}
    </QueryBlock>
  );
}

function Editor({ o, owner }: { o: PlaybookOverview; owner: boolean }) {
  const [selected, setSelected] = useState<number | null>(() => o.active?.version ?? o.versions[0]?.version ?? null);
  const detail = usePlaybookVersion(selected);
  const save = useSavePlaybook();
  const activate = useActivatePlaybook();

  // `loadedFor`: de qual versão veio o formulário (null = modelo vazio). Recarrega só quando a versão escolhida muda,
  // nunca num refetch: assim o que a pessoa digitou não some depois de salvar.
  const [loadedFor, setLoadedFor] = useState<number | null | undefined>(undefined);
  const [form, setForm] = useState<PlaybookData | null>(null);
  const [base, setBase] = useState("");
  const [notes, setNotes] = useState("");
  const [notesBase, setNotesBase] = useState("");
  const [open, setOpen] = useState<Record<SectionKey, boolean>>(() => Object.fromEntries(SECTION_KEYS.map((k) => [k, false])) as Record<SectionKey, boolean>);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [serverMissing, setServerMissing] = useState<string[] | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const missingRef = useRef<HTMLDivElement>(null);

  const load = useCallback((v: number | null, d: PlaybookData | null | undefined, n: string | null) => {
    const f = normalizePlaybook(d);
    setForm(f);
    setBase(JSON.stringify(cleanPlaybook(f)));
    setNotes(n ?? "");
    setNotesBase(n ?? "");
    setLoadedFor(v);
    setServerMissing(null);
  }, []);

  useEffect(() => {
    if (selected === null) {
      if (loadedFor !== null) load(null, o.template, null);
    } else if (detail.data && detail.data.version === selected && loadedFor !== selected) {
      load(selected, detail.data.data, detail.data.notes);
    }
  }, [selected, detail.data, loadedFor, load, o.template]);

  const cleaned = useMemo(() => (form ? cleanPlaybook(form) : null), [form]);
  const dirty = !!cleaned && (JSON.stringify(cleaned) !== base || notes !== notesBase);
  const live = useMemo(() => (cleaned ? checkPlaybook(cleaned) : []), [cleaned]);
  const porSecao = useMemo(() => {
    const m = Object.fromEntries(SECTION_KEYS.map((k) => [k, [] as string[]])) as Record<SectionKey, string[]>;
    for (const s of live) {
      const p = parseMissing(s);
      if (p.section) m[p.section].push(p.text);
    }
    return m;
  }, [live]);
  const completas = SECTION_KEYS.filter((k) => porSecao[k].length === 0).length;

  const row = o.versions.find((v) => v.version === selected);
  const status: PlaybookStatus | "novo" = selected === null ? "novo" : (detail.data?.version === selected ? detail.data.status : row?.status) ?? "rascunho";
  const editable = owner && (status === "novo" || status === "rascunho");
  const ro = !editable;
  const busy = save.isPending || activate.isPending;
  const busyRef = useRef(busy);
  busyRef.current = busy;
  // Estável: o diálogo refaz o foco quando onClose muda.
  const closeDialog = useCallback(() => { if (!busyRef.current) setConfirming(false); }, []);
  const loading = form === null || (selected !== null && loadedFor !== selected);

  // Guarda de alterações não salvas: fechar/recarregar a aba e links internos do painel.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
      if (new URL(a.href, location.href).origin !== location.origin) return;
      if (!window.confirm(DESCARTAR)) { e.preventDefault(); e.stopPropagation(); }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClick, true);
    return () => { window.removeEventListener("beforeunload", onBeforeUnload); document.removeEventListener("click", onClick, true); };
  }, [dirty]);

  const choose = (v: number | null) => {
    if (v === selected) return;
    if (dirty && !window.confirm(DESCARTAR)) return;
    setMsg(null);
    setServerMissing(null);
    setSelected(v);
  };

  const set = useCallback((fn: (d: PlaybookData) => PlaybookData) => setForm((f) => (f ? fn(f) : f)), []);

  const goTo = (k: SectionKey) => {
    setOpen((s) => ({ ...s, [k]: true }));
    requestAnimationFrame(() => {
      const el = document.getElementById(secId(k));
      el?.scrollIntoView({ block: "start", behavior: "smooth" });
      el?.querySelector<HTMLElement>("summary")?.focus();
    });
  };

  /** Salva o formulário: atualiza o rascunho escolhido ou cria uma versão nova. Devolve a versão salva. */
  const persist = async (): Promise<number | null> => {
    if (!cleaned) return null;
    if (jsonBytes(cleaned) > PLAYBOOK_MAX_BYTES) {
      setMsg({ ok: false, text: "O playbook passou do tamanho máximo (200 KB). Encurte os textos e tente de novo." });
      return null;
    }
    const r = await save.mutateAsync({ version: selected ?? undefined, data: cleaned, notes: notes.trim() || undefined });
    setBase(JSON.stringify(cleaned));
    setNotesBase(notes);
    if (selected === null) {
      setLoadedFor(r.version);
      setSelected(r.version);
    }
    return r.version;
  };

  const onSave = async () => {
    setMsg(null);
    setServerMissing(null);
    try {
      const v = await persist();
      if (v !== null) setMsg({ ok: true, text: `Rascunho salvo (versão ${v}). O agente continua usando o playbook ativo até você ativar este.` });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof ActionError ? e.userMessage : "Não foi possível salvar." });
    }
  };

  const onNewFrom = async () => {
    if (selected === null) return;
    if (dirty && !window.confirm(DESCARTAR)) return;
    setMsg(null);
    try {
      const r = await save.mutateAsync({ fromVersion: selected });
      setSelected(r.version);
      setMsg({ ok: true, text: `Versão ${r.version} criada como rascunho a partir da versão ${selected}.` });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof ActionError ? e.userMessage : "Não foi possível criar a versão." });
    }
  };

  const onActivate = async () => {
    setDialogError(null);
    try {
      const v = dirty || selected === null ? await persist() : selected;
      if (v === null) { setConfirming(false); return; }
      await activate.mutateAsync(v);
      setConfirming(false);
      setServerMissing(null);
      setMsg({ ok: true, text: `Versão ${v} ativada. O agente passa a usar este playbook.` });
    } catch (e) {
      if (e instanceof ActionError && e.status === 422) {
        setConfirming(false);
        setServerMissing(e.missing?.length ? e.missing : [e.userMessage]);
        requestAnimationFrame(() => missingRef.current?.focus());
        return;
      }
      setDialogError(e instanceof ActionError ? e.userMessage : "Não foi possível ativar.");
    }
  };

  return (
    <div className="space-y-6">
      <p className="flex items-start gap-2 rounded-lg border border-warn/40 bg-warn/10 p-3 text-sm">
        <ShieldAlert size={16} className="mt-0.5 shrink-0 text-warn" aria-hidden="true" />
        <span><strong className="font-semibold">Não coloque dados pessoais de clientes no playbook.</strong> Ele é instrução de venda, lida pelo agente em toda conversa.</span>
      </p>

      <div className="grid gap-6 lg:grid-cols-[11rem_minmax(0,1fr)]">
        {/* Versões */}
        <nav aria-label="Versões do playbook" className="min-w-0">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-mute">Versões</h3>
          <ul className="max-h-56 space-y-1 overflow-y-auto lg:max-h-[28rem]">
            {selected === null && (
              <li>
                <button type="button" aria-current="true" className="flex min-h-[44px] w-full flex-wrap items-center justify-between gap-1 rounded-lg border border-brand bg-brand/10 px-3 py-1.5 text-left text-sm">
                  <span className="font-semibold">Nova</span>
                  <StatusBadge s="novo" />
                </button>
              </li>
            )}
            {o.versions.map((v) => {
              const cur = v.version === selected;
              return (
                <li key={v.version}>
                  <button
                    type="button" onClick={() => choose(v.version)} aria-current={cur ? "true" : undefined}
                    className={`flex min-h-[44px] w-full flex-wrap items-center justify-between gap-1 rounded-lg border px-3 py-1.5 text-left text-sm ${cur ? "border-brand bg-brand/10" : "border-transparent hover:bg-ink/5"}`}
                  >
                    <span className="tabular font-mono font-semibold">v{v.version}</span>
                    <StatusBadge s={v.status} />
                    <span className="w-full text-xs text-mute">{dateTime(v.created_at)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          {o.versions.length === 0 && <p className="mt-2 text-xs text-mute">Nenhuma versão salva. O formulário começa do modelo vazio.</p>}
        </nav>

        <div className="min-w-0">
          {loading ? (
            detail.isError ? (
              <p role="alert" className="rounded-lg border border-bad/40 bg-bad/10 p-3 text-sm text-bad">Não foi possível carregar esta versão. <button type="button" className="underline" onClick={() => detail.refetch()}>Tentar de novo</button></p>
            ) : (
              <Skeleton className="h-96" />
            )
          ) : (
            <>
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line pb-4">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="font-display text-lg">{selected === null ? "Nova versão" : `Versão ${selected}`}</span>
                    <StatusBadge s={status} />
                    {dirty && <span className="text-xs font-semibold text-warn">alterações não salvas</span>}
                  </p>
                  <p className="mt-1 text-sm text-mute">
                    {status === "ativo" ? "É o playbook que o agente usa agora. Para mudar, crie uma nova versão a partir desta."
                      : status === "arquivado" ? "Versão antiga, só para consulta."
                      : editable ? "Rascunho: o agente não usa até ser ativado."
                      : "Rascunho, em leitura. Só o dono da conta edita e ativa o playbook."}
                  </p>
                </div>
                {owner && selected !== null && (
                  <button type="button" className={btnSec} onClick={onNewFrom} disabled={busy}>Nova versão a partir desta</button>
                )}
              </div>

              <div className="mt-4">
                <label htmlFor="pb-notes" className="block text-sm font-semibold">Nota da versão (opcional)</label>
                <input id="pb-notes" className={`${field} ${roField} mt-1`} value={notes} onChange={(e) => setNotes(e.target.value)} readOnly={ro} maxLength={500} placeholder={ro ? "" : "Ex.: novas objeções de preço"} />
              </div>

              <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-[12rem] flex-1">
                  <p className="text-sm"><span className="tabular font-mono font-semibold">{completas} de 10</span> seções completas</p>
                  <div className="mt-1.5 max-w-xs"><Progress value={completas * 10} label={`${completas} de 10 seções completas`} /></div>
                </div>
                <div className="flex gap-2">
                  <button type="button" className={btnSec} onClick={() => setOpen(Object.fromEntries(SECTION_KEYS.map((k) => [k, true])) as Record<SectionKey, boolean>)}>Abrir todas</button>
                  <button type="button" className={btnSec} onClick={() => setOpen(Object.fromEntries(SECTION_KEYS.map((k) => [k, false])) as Record<SectionKey, boolean>)}>Fechar todas</button>
                </div>
              </div>

              {serverMissing && (
                <div ref={missingRef} tabIndex={-1} role="alert" className="mt-5 rounded-lg border border-bad/40 bg-bad/10 p-4 text-sm">
                  <p className="font-semibold text-bad">Não foi ativado: o servidor encontrou {serverMissing.length} pendência(s).</p>
                  <ul className="mt-2 space-y-1">
                    {serverMissing.map((m, i) => {
                      const p = parseMissing(m);
                      return (
                        <li key={i} className="flex flex-wrap items-center gap-x-2">
                          {p.section ? (
                            <button type="button" onClick={() => goTo(p.section!)} className="inline-flex min-h-[44px] items-center text-left font-medium text-ink underline underline-offset-2">
                              {SECTION_LABEL[p.section]}: {p.text}
                            </button>
                          ) : <span>{p.text}</span>}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}

              <div className="mt-5 divide-y divide-line border-y border-line">
                {SECTION_KEYS.map((k, i) => {
                  const falta = porSecao[k];
                  const opcional = OPTIONAL_SECTIONS.includes(k);
                  return (
                    <details key={k} id={secId(k)} open={open[k]} onToggle={(e) => { const v = (e.currentTarget as HTMLDetailsElement).open; setOpen((s) => (s[k] === v ? s : { ...s, [k]: v })); }} className="group scroll-mt-20">
                      <summary className="flex min-h-[52px] cursor-pointer list-none items-center gap-3 py-2 [&::-webkit-details-marker]:hidden">
                        <span className="tabular w-6 font-mono text-xs font-semibold text-brand-ink">{String(i + 1).padStart(2, "0")}</span>
                        <span className="min-w-0 flex-1 font-semibold">{SECTION_LABEL[k]}</span>
                        {opcional && falta.length === 0 ? (
                          <span className="rounded-full border border-line px-2 py-0.5 text-xs font-semibold text-mute">Opcional</span>
                        ) : falta.length === 0 ? (
                          <span className="inline-flex items-center gap-1 rounded-full border border-ok/40 bg-ok/15 px-2 py-0.5 text-xs font-semibold text-ok"><CheckCircle2 size={12} aria-hidden="true" />Completa</span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full border border-warn/40 bg-warn/15 px-2 py-0.5 text-xs font-semibold text-warn"><CircleAlert size={12} aria-hidden="true" />Falta {falta.length}</span>
                        )}
                        <ChevronDown size={16} className="shrink-0 text-mute transition-transform group-open:rotate-180 motion-reduce:transition-none" aria-hidden="true" />
                      </summary>
                      {open[k] && (
                        <div className="pb-6 pt-2">
                          <Exemplo text={o.template.exemplos?.[k]} />
                          <SectionBody k={k} d={form!} set={set} ro={ro} />
                          {falta.length > 0 && (
                            <ul className="mt-4 space-y-0.5 text-xs text-warn" aria-label={`O que falta em ${SECTION_LABEL[k]}`}>
                              {falta.map((t, j) => <li key={j}>Falta: {t}</li>)}
                            </ul>
                          )}
                        </div>
                      )}
                    </details>
                  );
                })}
              </div>

              <div aria-live="polite" className="mt-4 min-h-[1px]">
                {msg && <p role={msg.ok ? "status" : "alert"} className={`rounded-lg border p-3 text-sm ${msg.ok ? "border-ok/40 bg-ok/10 text-ink" : "border-bad/40 bg-bad/10 text-bad"}`}>{msg.text}</p>}
              </div>

              {editable && (
                <div className="sticky bottom-0 z-10 -mx-1 mt-4 flex flex-wrap items-center justify-end gap-3 border-t border-line bg-paper/95 px-1 py-3 backdrop-blur-sm">
                  <p className="mr-auto text-xs text-mute">{live.length === 0 ? "Pronto para ativar." : `${live.length} pendência(s) antes de ativar.`}</p>
                  <button type="button" className={btnSec} onClick={onSave} disabled={busy || (!dirty && selected !== null)}>
                    {save.isPending && !confirming && <Loader2 size={15} className="animate-spin" aria-hidden="true" />}
                    Salvar rascunho
                  </button>
                  <button type="button" className={btnPrimary} onClick={() => { setDialogError(null); setConfirming(true); }} disabled={busy}>Ativar</button>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {confirming && (
        <ConfirmDialog
          title={`Ativar ${selected === null ? "esta nova versão" : `a versão ${selected}`}?`} confirmLabel="Ativar" busy={busy} error={dialogError}
          onConfirm={onActivate} onClose={closeDialog}
        >
          <p>Isto troca o playbook que o agente usa.{o.active ? ` A versão ativa hoje (v${o.active.version}) passa a arquivada.` : " Hoje nenhuma versão está ativa."}</p>
          {dirty && <p>As alterações não salvas serão salvas antes.</p>}
          {live.length > 0 && <p className="text-warn">A checagem ao vivo ainda vê {live.length} pendência(s); o servidor vai conferir.</p>}
        </ConfirmDialog>
      )}
    </div>
  );
}
