"use client";

import { useState } from "react";
import { botaoSec } from "./estilo";
import { useChaves, type Chave } from "./chaves-api";
import { FormChave } from "./CampoConfig";

function Linha({ s, owner }: { s: Chave; owner: boolean }) {
  const [aberto, setAberto] = useState(false);
  const comum = s.secret === false;
  const estado = !s.configured
    ? "Pendente"
    : comum
      ? s.value ?? "Definida no servidor"
      : s.source === "painel"
        ? `Cadastrada${s.last4 ? ` · …${s.last4}` : ""}`
        : "Definida no servidor";
  return (
    <li className="border-b border-line/70 py-3 last:border-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold">{s.label}</p>
          <p className="text-sm text-mute">{s.hint}</p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <span className={`max-w-[16rem] break-all text-sm font-medium ${s.configured ? "text-ok" : "text-warn"}`}>{estado}</span>
          {owner && !aberto && (
            <button type="button" className={botaoSec} onClick={() => setAberto(true)}>
              {s.configured ? "Trocar" : "Cadastrar"}
            </button>
          )}
        </div>
      </div>
      {aberto && <FormChave c={s} onDone={() => setAberto(false)} />}
    </li>
  );
}

export function ChavesFolio({ role }: { role?: string }) {
  const owner = role === "owner";
  const q = useChaves(role);
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
