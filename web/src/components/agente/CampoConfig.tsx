"use client";

import { useId, useState } from "react";
import { ActionError } from "@/lib/client";
import { botao, botaoSec, campo } from "./estilo";
import { useChaves, useSalvarChave, type Chave } from "./chaves-api";

/** Formulário de uma chave ou configuração: senha para segredo, lista para opções fechadas, texto nos demais. */
export function FormChave({ c, onDone }: { c: Chave; onDone: () => void }) {
  const [valor, setValor] = useState(c.secret === false ? c.value ?? "" : "");
  const salvar = useSalvarChave(c.name, onDone);
  const id = useId();
  const comum = c.secret === false;
  const minimo = comum ? 1 : 4;
  return (
    <div>
      <form className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end" onSubmit={(e) => { e.preventDefault(); salvar.mutate(valor); }}>
        <div className="min-w-0 flex-1">
          <label htmlFor={id} className="mb-1 block text-xs font-semibold text-mute">
            {comum ? c.label : "Novo valor (não é exibido depois de salvar)"}
          </label>
          {c.options ? (
            <select id={id} className={campo} value={valor} onChange={(e) => setValor(e.target.value)}>
              <option value="">Escolha…</option>
              {c.options.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          ) : (
            <input
              id={id}
              className={campo}
              type={comum ? "text" : "password"}
              autoComplete="off"
              spellCheck={false}
              value={valor}
              placeholder={c.placeholder}
              onChange={(e) => setValor(e.target.value)}
            />
          )}
        </div>
        <button type="submit" className={botao} disabled={salvar.isPending || valor.trim().length < minimo}>{salvar.isPending ? "Salvando…" : "Salvar"}</button>
        <button type="button" className={botaoSec} onClick={onDone}>Cancelar</button>
      </form>
      {c.source === "painel" && (
        <button
          type="button"
          className="mt-2 min-h-[44px] text-sm font-semibold text-warn underline underline-offset-2"
          disabled={salvar.isPending}
          onClick={() => { if (window.confirm(`Remover "${c.label}" cadastrado no painel?`)) salvar.mutate(""); }}
        >
          Remover do painel
        </button>
      )}
      {salvar.isError && <p role="alert" className="mt-2 text-sm text-warn">{salvar.error instanceof ActionError ? salvar.error.message : "Não foi possível salvar."}</p>}
    </div>
  );
}

/** Botão "Preencher" ao lado de um item pendente (tela da Voz). Só aparece para o dono e para nomes cadastráveis. */
export function CampoConfig({ name, role }: { name: string; role?: string }) {
  const q = useChaves(role);
  const [aberto, setAberto] = useState(false);
  const c = q.data?.find((x) => x.name === name);
  if (role !== "owner" || !c) return null;
  return aberto ? (
    <FormChave c={c} onDone={() => setAberto(false)} />
  ) : (
    <button type="button" className="ml-3 inline-flex min-h-[44px] items-center text-sm font-semibold text-brand-ink underline underline-offset-2" onClick={() => setAberto(true)}>
      {c.configured ? "Trocar" : "Preencher"}
    </button>
  );
}
