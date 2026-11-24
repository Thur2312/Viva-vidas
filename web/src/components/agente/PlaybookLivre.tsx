"use client";

import { useEffect, useId, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ActionError } from "@/lib/client";
import { activatePlaybook, fetchPlaybook, savePlaybook } from "./playbook-api";
import { botao, campo } from "./estilo";
import type { PlaybookData } from "@/lib/types";

const MIN = 200;
const MAX = 40000;

export function PlaybookLivre({ owner }: { owner: boolean }) {
  const q = useQuery({ queryKey: ["playbook-livre"], queryFn: ({ signal }) => fetchPlaybook(signal) });
  const qc = useQueryClient();
  const [texto, setTexto] = useState("");
  const [carregado, setCarregado] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const id = useId();
  const ativo = q.data?.active?.data?.livre;

  useEffect(() => {
    if (q.data && !carregado) {
      setTexto(q.data.active?.data?.livre ?? "");
      setCarregado(true);
    }
  }, [q.data, carregado]);

  async function salvar() {
    setBusy(true);
    setMsg(null);
    try {
      const { version } = await savePlaybook({ data: { livre: texto.trim() } as unknown as PlaybookData });
      await activatePlaybook(version);
      setMsg({ ok: true, t: `Versão ${version} salva e ativa. O agente já usa este texto.` });
      await qc.invalidateQueries({ queryKey: ["playbook-livre"] });
      await qc.invalidateQueries({ queryKey: ["playbook"] });
    } catch (e) {
      setMsg({ ok: false, t: e instanceof ActionError ? [e.message, ...(e.missing ?? [])].join(" ") : "Não foi possível salvar." });
    } finally {
      setBusy(false);
    }
  }

  const curto = texto.trim().length < MIN;
  return (
    <div className="max-w-3xl">
      <p className="mb-3 text-sm">
        {q.isLoading ? (
          "Carregando…"
        ) : ativo ? (
          <>Em uso: <strong>playbook em texto v{q.data?.active?.version}</strong>.</>
        ) : q.data?.active ? (
          <>Em uso: playbook estruturado v{q.data.active.version}. Ao ativar um texto, ele passa a valer no lugar.</>
        ) : (
          <span className="text-warn">Nenhum playbook ativo: o agente repassa tudo a uma pessoa.</span>
        )}
      </p>
      <label htmlFor={id} className="mb-1 block text-sm font-semibold">Playbook (Markdown)</label>
      <textarea
        id={id}
        className={`${campo} min-h-[320px] py-3 font-mono leading-relaxed`}
        value={texto}
        readOnly={!owner}
        spellCheck
        onChange={(e) => setTexto(e.target.value)}
        placeholder={"## Oferta\nO que a corretora vende, para quem...\n\n## Fatos aprovados\n- Preços, carências, operadoras: só o que está aqui o agente afirma.\n\n## Nunca fazer\n- ..."}
      />
      <p className={`mt-1 text-xs ${texto.length > MAX ? "text-warn" : "text-mute"}`}>
        {texto.length.toLocaleString("pt-BR")} / {MAX.toLocaleString("pt-BR")} caracteres{curto && texto.length > 0 ? ` · escreva ao menos ${MIN}` : ""}
      </p>
      <p className="mt-2 text-sm text-mute">Números, preços e prazos só saem nas respostas se estiverem escritos aqui. O que o texto não cobre, o agente diz que vai confirmar com a equipe.</p>
      {owner ? (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button type="button" className={botao} disabled={busy || curto || texto.length > MAX} onClick={() => void salvar()}>
            {busy ? "Salvando…" : "Salvar e ativar"}
          </button>
          {msg && <p role={msg.ok ? "status" : "alert"} className={`text-sm ${msg.ok ? "text-ok" : "text-warn"}`}>{msg.t}</p>}
        </div>
      ) : (
        <p className="mt-3 text-sm text-mute">Só o dono da conta salva e ativa o playbook.</p>
      )}
    </div>
  );
}
