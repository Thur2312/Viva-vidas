"use client";

import { useId, useRef, useState } from "react";
import { ActionError, sendJson } from "@/lib/client";
import { botao, botaoSec, campo } from "./estilo";

type Meta = { action: string; handoffReason: string | null; guardEvents: string[]; playbookVersion: number | null; provider: string };
type Turno = { author: "lead" | "agente"; body: string; meta?: Meta };
type Resp =
  | { status: "ok"; draft: string; action: string; handoffReason: string | null; guardEvents: string[]; playbookVersion: number | null; provider: string }
  | { status: "disabled" }
  | { status: "llm_error"; code: string };

const ACAO: Record<string, string> = {
  conversar: "Conversou com base no playbook",
  perguntar_campo: "Perguntou um campo",
  tratar_objecao: "Tratou uma objeção",
  responder_duvida: "Respondeu uma dúvida",
  propor_horario: "Propôs um horário",
  repassar_humano: "Repassou a uma pessoa",
  aguardar: "Aguardou",
};
const MOTIVO: Record<string, string> = {
  pediu_humano: "o lead pediu uma pessoa",
  saude: "assunto de saúde",
  sem_base: "sem base no playbook",
  nao_entendeu: "não entendeu a mensagem",
  guardacorpo: "o texto foi barrado pelas travas",
  playbook_incompleto: "não há playbook ativo e completo",
};
const MSG = { network: "Sem conexão com o servidor.", fallback: "Não foi possível testar agora. Tente de novo.", byStatus: { 403: "Só gerente ou dono pode testar o agente." } };

export function TesteAgente({ role }: { role?: string }) {
  const [turnos, setTurnos] = useState<Turno[]>([]);
  const [texto, setTexto] = useState("");
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const id = useId();
  const fim = useRef<HTMLDivElement>(null);
  const pode = role === "owner" || role === "manager";

  async function enviar() {
    const t = texto.trim();
    if (!t || busy) return;
    const lista: Turno[] = [...turnos, { author: "lead", body: t }];
    setTurnos(lista);
    setTexto("");
    setErro(null);
    setBusy(true);
    try {
      const r = await sendJson<Resp>("POST", "/api/pilot/agent/test", { messages: lista.map(({ author, body }) => ({ author, body })).slice(-30) }, MSG as never);
      if (r.status === "ok") {
        setTurnos([...lista, { author: "agente", body: r.draft, meta: { action: r.action, handoffReason: r.handoffReason, guardEvents: r.guardEvents, playbookVersion: r.playbookVersion, provider: r.provider } }]);
      } else if (r.status === "disabled") setErro("A IA está desligada: falta cadastrar a chave do provedor (seção 06).");
      else setErro("O provedor de IA recusou ou demorou demais. Tente de novo em instantes.");
    } catch (e) {
      setErro(e instanceof ActionError ? e.message : MSG.fallback);
    } finally {
      setBusy(false);
      setTimeout(() => fim.current?.scrollIntoView({ block: "nearest" }), 50);
    }
  }

  if (!pode) return <p className="text-sm text-mute">Só gerente ou dono pode testar o agente.</p>;

  return (
    <div className="max-w-2xl">
      <div className="min-h-[160px] space-y-3 border-l-2 border-line pl-4" role="log" aria-live="polite" aria-label="Conversa de teste">
        {turnos.length === 0 && <p className="text-sm text-mute">Escreva abaixo a primeira mensagem do lead. Ex.: “Oi, vocês atendem MEI?”</p>}
        {turnos.map((t, i) => (
          <div key={i} className={t.author === "lead" ? "" : "pl-6"}>
            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-mute">{t.author === "lead" ? "Lead (você)" : "Agente"}</p>
            <p className="mt-0.5 whitespace-pre-wrap text-sm text-ink">{t.body || "(sem resposta: o agente aguardaria)"}</p>
            {t.meta && (
              <p className="mt-1 text-xs text-mute">
                {ACAO[t.meta.action] ?? t.meta.action}
                {t.meta.handoffReason ? ` · ${MOTIVO[t.meta.handoffReason] ?? t.meta.handoffReason}` : ""}
                {t.meta.guardEvents.length ? ` · travas acionadas: ${t.meta.guardEvents.join(", ")}` : ""}
                {t.meta.playbookVersion !== null ? ` · playbook v${t.meta.playbookVersion}` : " · sem playbook ativo"}
              </p>
            )}
          </div>
        ))}
        {busy && <p className="pl-6 text-sm text-mute">O agente está escrevendo…</p>}
        <div ref={fim} />
      </div>
      {erro && <p role="alert" className="mt-3 text-sm text-warn">{erro}</p>}
      <form className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-end" onSubmit={(e) => { e.preventDefault(); void enviar(); }}>
        <div className="min-w-0 flex-1">
          <label htmlFor={id} className="mb-1 block text-xs font-semibold text-mute">Mensagem do lead</label>
          <input id={id} className={campo} value={texto} maxLength={1500} onChange={(e) => setTexto(e.target.value)} autoComplete="off" />
        </div>
        <button type="submit" className={botao} disabled={busy || !texto.trim()}>Enviar</button>
        <button type="button" className={botaoSec} disabled={busy || turnos.length === 0} onClick={() => { setTurnos([]); setErro(null); }}>Nova conversa</button>
      </form>
    </div>
  );
}
