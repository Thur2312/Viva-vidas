"use client";

import { useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ActionError, getJson, sendJson } from "@/lib/client";
import { botao, botaoSec, campo } from "./estilo";

type Chave = { name: string; label: string; group: string; hint: string; configured: boolean; source: "painel" | "ambiente" | null; last4: string | null };
const MSG = { network: "Sem conexão com o servidor. Nada foi salvo.", fallback: "Não foi possível salvar. Tente de novo.", byStatus: { 403: "Só o dono da conta cadastra chaves." } };

function Linha({ s, owner }: { s: Chave; owner: boolean }) {
  const [aberto, setAberto] = useState(false);
  const [valor, setValor] = useState("");
  const qc = useQueryClient();
  const id = useId();
  const salvar = useMutation({
    mutationFn: (v: string) => sendJson<Chave[]>("PUT", `/api/pilot/config/secrets/${s.name}`, { value: v }, MSG as never),
    onSuccess: (d) => {
      qc.setQueryData(["config-secrets"], d);
      qc.invalidateQueries({ queryKey: ["readiness"] });
      fechar();
    },
  });
  function fechar() {
    setAberto(false);
    setValor("");
    salvar.reset();
  }
  return (
    <li className="border-b border-line/70 py-3 last:border-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold">{s.label}</p>
          <p className="text-sm text-mute">{s.hint}</p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <span className={`text-sm font-medium ${s.configured ? "text-ok" : "text-warn"}`}>
            {!s.configured ? "Pendente" : s.source === "painel" ? `Cadastrada${s.last4 ? ` · …${s.last4}` : ""}` : "Definida no servidor"}
          </span>
          {owner && !aberto && (
            <button type="button" className={botaoSec} onClick={() => setAberto(true)}>
              {s.configured ? "Trocar" : "Cadastrar"}
            </button>
          )}
        </div>
      </div>
      {aberto && (
        <form className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end" onSubmit={(e) => { e.preventDefault(); salvar.mutate(valor); }}>
          <div className="min-w-0 flex-1">
            <label htmlFor={id} className="mb-1 block text-xs font-semibold text-mute">Novo valor (não é exibido depois de salvar)</label>
            <input id={id} className={campo} type="password" autoComplete="off" spellCheck={false} value={valor} onChange={(e) => setValor(e.target.value)} />
          </div>
          <button type="submit" className={botao} disabled={salvar.isPending || valor.trim().length < 4}>{salvar.isPending ? "Salvando…" : "Salvar"}</button>
          <button type="button" className={botaoSec} onClick={fechar}>Cancelar</button>
        </form>
      )}
      {aberto && s.source === "painel" && (
        <button
          type="button"
          className="mt-2 min-h-[44px] text-sm font-semibold text-warn underline underline-offset-2"
          disabled={salvar.isPending}
          onClick={() => { if (window.confirm(`Remover a chave "${s.label}" cadastrada no painel?`)) salvar.mutate(""); }}
        >
          Remover chave do painel
        </button>
      )}
      {salvar.isError && <p role="alert" className="mt-2 text-sm text-warn">{salvar.error instanceof ActionError ? salvar.error.message : MSG.fallback}</p>}
    </li>
  );
}

export function ChavesFolio({ role }: { role?: string }) {
  const owner = role === "owner";
  const q = useQuery({ queryKey: ["config-secrets"], enabled: owner || role === "manager", queryFn: ({ signal }) => getJson<Chave[]>("/api/pilot/config/secrets", signal) });
  const grupos = new Map<string, Chave[]>();
  (q.data ?? []).forEach((s) => grupos.set(s.group, [...(grupos.get(s.group) ?? []), s]));
  if (role && !owner && role !== "manager") return <p className="text-sm text-mute">Só gerente ou dono vê as chaves.</p>;
  return (
    <div className="max-w-3xl">
      {!owner && <p className="mb-3 text-sm text-mute">Só o dono da conta cadastra ou troca chaves. Aqui você vê o que está ligado.</p>}
      {q.isLoading && <p className="text-sm text-mute">Carregando…</p>}
      {q.isError && <p className="text-sm text-warn">Não foi possível carregar as chaves.</p>}
      {[...grupos.entries()].map(([g, itens]) => (
        <div key={g} className="mb-5 last:mb-0">
          <h3 className="mb-1 text-xs font-bold uppercase tracking-[0.08em] text-mute">{g}</h3>
          <ul>{itens.map((s) => <Linha key={s.name} s={s} owner={owner} />)}</ul>
        </div>
      ))}
      <p className="mt-4 text-xs text-mute">Banco de dados, chave do painel e chaves de criptografia ficam só no ambiente do servidor: sem elas a API não consegue abrir o que está guardado aqui.</p>
    </div>
  );
}
