"use client";

import { ChevronUp, Info, Loader2, Send, X } from "lucide-react";
import { Fragment, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { EmptyState, ErrorState, Skeleton } from "../Block";
import { usePrivacy } from "../Providers";
import { useMe, useThread } from "@/lib/hooks";
import { AUTHOR, dayKey, dayLabel, hourLabel } from "./common";
import { STAGE_META, type DraftInfo, type Stage, type ThreadMessage } from "@/lib/types";

const MAX = 4096;
const WINDOW_MS = 24 * 3600_000;

const ACTION: Record<string, string> = {
  igual: "A equipe enviou praticamente igual",
  editou: "A equipe editou antes de enviar",
  diferente: "A equipe respondeu algo diferente",
  ignorou: "A equipe ignorou o rascunho",
};

function SimBadge({ v }: { v: number | null }) {
  if (v === null) return null;
  const p = Math.round(v * 100);
  const [tone, label] = v >= 0.8 ? ["bg-ok/15 text-ok", "alta"] : v >= 0.5 ? ["bg-warn/15 text-warn", "média"] : ["bg-bad/15 text-bad", "baixa"];
  return <span className={`tabular rounded-full px-2 py-0.5 text-xs font-semibold ${tone}`}>similaridade {label} · {p}%</span>;
}

/** Sugestão do agente em modo sombra: nunca foi enviada ao cliente. */
function DraftCard({ d, blur }: { d: DraftInfo; blur: string }) {
  const guess = [d.stage_guess ? (STAGE_META[d.stage_guess as Stage]?.nome ?? d.stage_guess) : null, d.next_action_guess?.replace(/_/g, " ")].filter(Boolean);
  return (
    <div className="ml-auto mt-1.5 w-full max-w-[85%] rounded-xl border border-dashed border-brand/70 bg-brand/[0.06] p-3 text-sm">
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold text-brand-ink">Rascunho do agente (não enviado)</p>
        <SimBadge v={d.similarity} />
      </div>
      <p className={`whitespace-pre-wrap break-words ${blur}`}>{d.draft_body}</p>
      <p className="mt-2 text-xs text-mute">
        {d.human_action ? ACTION[d.human_action] ?? d.human_action : "Aguardando a resposta da equipe para comparar"}
        {guess.length > 0 && ` · o agente via: ${guess.join(", ")}`}
      </p>
    </div>
  );
}

function Bubble({ m, blur, pendingLabel }: { m: Pick<ThreadMessage, "author" | "body" | "created_at">; blur: string; pendingLabel?: string }) {
  const lead = m.author === "lead";
  const tone = lead
    ? "mr-auto bg-card ring-1 ring-line rounded-bl-[2px]"
    : m.author === "agente"
      ? "ml-auto bg-brand/15 ring-1 ring-brand/50 rounded-br-[2px]"
      : "ml-auto bg-deep text-white dark:bg-bubble rounded-br-[2px]";
  const sub = m.author === "humano" ? "text-white/70" : "text-mute";
  return (
    <div className={`w-fit max-w-[85%] rounded-lg px-3.5 py-2 text-sm ${tone}`}>
      <p className={`mb-0.5 text-[11px] font-semibold ${sub}`}>{AUTHOR[m.author]}</p>
      <p className={`whitespace-pre-wrap break-words ${blur}`}>{m.body}</p>
      <p className={`mt-1 text-[11px] ${sub}`}>{pendingLabel ?? hourLabel(m.created_at)}</p>
    </div>
  );
}

function Toast({ text, onClose }: { text: string; onClose: () => void }) {
  useEffect(() => {
    const t = setTimeout(onClose, 9000);
    return () => clearTimeout(t);
  }, [text]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div role="alert" className="fixed bottom-24 left-1/2 z-[60] flex w-[min(92vw,26rem)] -translate-x-1/2 items-start gap-2 rounded-xl border border-bad/40 bg-card p-3 text-sm shadow-xl">
      <Info size={17} className="mt-0.5 shrink-0 text-bad" aria-hidden="true" />
      <p className="flex-1">{text}</p>
      <button type="button" onClick={onClose} aria-label="Fechar aviso" className="-m-2 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-mute hover:bg-ink/10">
        <X size={16} aria-hidden="true" />
      </button>
    </div>
  );
}

export function ConversationThread({ conversationId }: { conversationId: string }) {
  const t = useThread(conversationId);
  const me = useMe();
  const { hide } = usePrivacy();
  const blur = hide ? "sensitive" : "";
  const [text, setText] = useState("");
  const taId = useId();
  const area = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const keepFrom = useRef<number | null>(null);
  const seen = useRef<{ id: string; n: number } | null>(null);
  const [announce, setAnnounce] = useState("");

  useEffect(() => {
    setText("");
    stick.current = true;
    seen.current = null;
    setAnnounce("");
  }, [conversationId]);

  const msgs = t.messages;
  const total = msgs.length + t.pending.length;

  // Rolagem: cola no fim se o usuário já estava lá; preserva a posição ao carregar mensagens antigas.
  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    if (keepFrom.current !== null) {
      el.scrollTop += el.scrollHeight - keepFrom.current;
      keepFrom.current = null;
    } else if (stick.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [total, msgs[0]?.id]);

  // Aviso para leitor de tela: só o autor, nunca o conteúdo (pode estar oculto por privacidade).
  useEffect(() => {
    if (t.query.isPending) return;
    const last = msgs[msgs.length - 1];
    if (!seen.current || seen.current.id !== conversationId) {
      seen.current = { id: conversationId, n: msgs.length };
      return;
    }
    if (msgs.length > seen.current.n && last) setAnnounce(`Nova mensagem de ${AUTHOR[last.author].toLowerCase()}`);
    seen.current = { id: conversationId, n: msgs.length };
  }, [msgs, conversationId, t.query.isPending]);

  const lastIn = [...msgs].reverse().find((m) => m.direction === "in");
  const windowClosed = lastIn ? Date.now() - +new Date(lastIn.created_at) > WINDOW_MS : !t.hasMore && !t.query.isPending;
  const readOnly = me.data?.role === "viewer";
  const blockedReason = readOnly
    ? "Seu perfil só pode ler conversas. Peça acesso de gerente para enviar mensagens."
    : windowClosed
      ? "A janela de 24 horas com este cliente está fechada. Só é possível enviar um modelo (template) aprovado, pelos disparos."
      : null;

  const submit = async () => {
    const body = text.trim();
    if (!body || blockedReason || t.sending || body.length > MAX) return;
    setText("");
    stick.current = true;
    const ok = await t.send(body);
    if (!ok) setText((cur) => cur || body); // devolve o texto ao campo
  };

  const loadOlder = () => {
    keepFrom.current = area.current?.scrollHeight ?? null;
    stick.current = false;
    void t.loadOlder();
  };

  let prevDay = "";
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div role="status" aria-live="polite" className="sr-only">{announce}</div>
      <div
        ref={area}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
        }}
        className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-4 sm:px-4"
        tabIndex={0}
        role="log"
        aria-label="Mensagens da conversa"
      >
        {t.query.isPending && (
          <div className="space-y-3">
            <Skeleton className="h-14 w-2/3" />
            <Skeleton className="ml-auto h-14 w-1/2" />
            <Skeleton className="h-14 w-3/5" />
          </div>
        )}
        {t.query.isError && !t.query.data && <ErrorState error={t.query.error} onRetry={() => t.query.refetch()} compact />}
        {t.query.data && t.hasMore && (
          <div className="flex justify-center">
            <button type="button" onClick={loadOlder} disabled={t.loadingOlder} className="inline-flex min-h-[44px] items-center gap-2 rounded-full border border-line bg-card px-4 text-sm font-semibold hover:bg-ink/5 disabled:opacity-60">
              {t.loadingOlder ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <ChevronUp size={15} aria-hidden="true" />}
              Carregar mensagens anteriores
            </button>
          </div>
        )}
        {t.olderError && <p role="alert" className="text-center text-sm text-bad">Não foi possível carregar as mensagens anteriores.</p>}
        {t.query.data && msgs.length === 0 && t.pending.length === 0 && <EmptyState title="Sem mensagens">Esta conversa ainda não tem mensagens registradas.</EmptyState>}
        {msgs.map((m) => {
          const k = dayKey(m.created_at);
          const sep = k !== prevDay;
          prevDay = k;
          return (
            <Fragment key={m.id}>
              {sep && <p className="sticky top-0 z-[1] mx-auto w-fit rounded-full bg-paper/90 px-3 py-0.5 text-xs font-semibold text-mute ring-1 ring-line backdrop-blur">{dayLabel(m.created_at)}</p>}
              <div className="flex flex-col">
                <Bubble m={m} blur={blur} />
                {m.draft && <DraftCard d={m.draft} blur={blur} />}
              </div>
            </Fragment>
          );
        })}
        {t.pending.map((p) => (
          <div key={p.tempId} className="flex flex-col opacity-70">
            <Bubble m={{ author: "humano", body: p.body, created_at: p.created_at }} blur={blur} pendingLabel="Enviando…" />
          </div>
        ))}
      </div>

      <div className="border-t border-line bg-card px-3 py-3 sm:px-4">
        {blockedReason && (
          <p className="mb-2 flex items-start gap-2 text-xs text-mute">
            <Info size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
            {blockedReason}
          </p>
        )}
        <div className="flex items-end gap-2">
          <div className="min-w-0 flex-1">
            <label htmlFor={taId} className="sr-only">Escrever mensagem para o cliente</label>
            <textarea
              id={taId}
              value={text}
              rows={2}
              maxLength={MAX}
              disabled={!!blockedReason}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void submit();
                }
              }}
              placeholder={blockedReason ? "Envio indisponível" : "Escreva uma mensagem. Enter envia, Shift+Enter quebra a linha."}
              aria-describedby={`${taId}-n`}
              className="max-h-40 min-h-[44px] w-full resize-y rounded-xl border border-line bg-paper px-3 py-2.5 text-sm disabled:cursor-not-allowed disabled:opacity-60"
            />
            <p id={`${taId}-n`} className={`mt-1 text-right text-[11px] ${text.length > MAX - 200 ? "text-warn" : "text-mute"}`}>
              {text.length.toLocaleString("pt-BR")} / {MAX.toLocaleString("pt-BR")}
            </p>
          </div>
          <button type="button" onClick={() => void submit()} disabled={!!blockedReason || t.sending || !text.trim()} aria-label="Enviar mensagem" className="mb-6 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand text-on-brand disabled:cursor-not-allowed disabled:opacity-50">
            {t.sending ? <Loader2 size={18} className="animate-spin" aria-hidden="true" /> : <Send size={18} aria-hidden="true" />}
          </button>
        </div>
      </div>
      {t.sendError && <Toast text={t.sendError.userMessage} onClose={t.clearSendError} />}
    </div>
  );
}
