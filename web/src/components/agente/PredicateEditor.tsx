"use client";
import { useId } from "react";
import { field } from "@/components/disparos/bits";
import type { Predicate, PredicateGroup, PredicateLeaf, PredicateOp, ProfileField } from "@/lib/types";
import { AddButton, RemoveButton, roField } from "./fields";

// Montador de regra: condições "campo / operador / valor", agrupadas por "todas" (E) ou "qualquer" (OU).
// A raiz é sempre um grupo; dentro dela cabe um subgrupo (um nível), o bastante para "A e (B ou C)".

const OPS: { op: PredicateOp; label: string }[] = [
  { op: "eq", label: "é igual a" },
  { op: "gt", label: "maior que" },
  { op: "gte", label: "maior ou igual a" },
  { op: "lt", label: "menor que" },
  { op: "lte", label: "menor ou igual a" },
  { op: "presente", label: "foi respondido" },
  { op: "ausente", label: "não foi respondido" },
];
const SEM_VALOR: PredicateOp[] = ["presente", "ausente"];
const NUMERICO: PredicateOp[] = ["gt", "gte", "lt", "lte"];

const isLeaf = (p: Predicate): p is PredicateLeaf => "campo" in p;
const modeOf = (g: PredicateGroup): "all" | "any" => (g.any && !g.all ? "any" : "all");
const itemsOf = (g: PredicateGroup) => g[modeOf(g)] ?? [];
const withItems = (g: PredicateGroup, items: Predicate[]): PredicateGroup => ({ [modeOf(g)]: items });
const novaCondicao = (chaves: string[]): PredicateLeaf => ({ campo: chaves[0] ?? "", op: "presente" });

const sel = `${field} ${roField} mt-1`;

function LeafEditor({ p, n, campos, onChange, onRemove, ro }: { p: PredicateLeaf; n: string; campos: ProfileField[]; onChange: (p: PredicateLeaf) => void; onRemove: () => void; ro: boolean }) {
  const id = useId();
  const chaves = campos.map((c) => c.chave.trim()).filter(Boolean);
  const inexistente = p.campo !== "" && !chaves.includes(p.campo);
  const valores = campos.find((c) => c.chave.trim() === p.campo)?.valores?.filter(Boolean) ?? [];
  const setOp = (op: PredicateOp) => {
    const next: PredicateLeaf = { campo: p.campo, op };
    if (!SEM_VALOR.includes(op)) next.valor = p.valor ?? "";
    onChange(next);
  };
  // Guarda o texto cru enquanto se digita; números ("1,5") viram número na hora de salvar (cleanPlaybook).
  const setValor = (raw: string) => onChange({ ...p, valor: raw });
  return (
    <fieldset className="flex flex-wrap items-end gap-3">
      <legend className="sr-only">Condição {n}</legend>
      <div className="min-w-[11rem] flex-1">
        <label htmlFor={`${id}-c`} className="block text-xs font-semibold text-mute">Campo</label>
        <select id={`${id}-c`} className={`${sel} font-mono`} value={p.campo} disabled={ro} onChange={(e) => onChange({ ...p, campo: e.target.value })} aria-invalid={inexistente || p.campo === "" || undefined} aria-describedby={inexistente ? `${id}-e` : undefined}>
          <option value="">Escolha um campo</option>
          {chaves.map((k) => <option key={k} value={k}>{k}</option>)}
          {inexistente && <option value={p.campo}>{p.campo} (inexistente)</option>}
        </select>
        {inexistente && <p id={`${id}-e`} className="mt-1 text-xs text-bad">Este campo não existe mais na lista de campos.</p>}
      </div>
      <div className="min-w-[11rem] flex-1">
        <label htmlFor={`${id}-o`} className="block text-xs font-semibold text-mute">Operador</label>
        <select id={`${id}-o`} className={sel} value={p.op} disabled={ro} onChange={(e) => setOp(e.target.value as PredicateOp)}>
          {OPS.map((o) => <option key={o.op} value={o.op}>{o.label}</option>)}
        </select>
      </div>
      <div className={SEM_VALOR.includes(p.op) ? "hidden" : "min-w-[9rem] flex-1"}>
        {!SEM_VALOR.includes(p.op) && (
          <>
            <label htmlFor={`${id}-v`} className="block text-xs font-semibold text-mute">Valor</label>
            <input
              id={`${id}-v`} className={sel} value={p.valor === undefined ? "" : String(p.valor)} readOnly={ro} maxLength={200}
              inputMode={NUMERICO.includes(p.op) ? "decimal" : undefined} list={valores.length ? `${id}-l` : undefined}
              onChange={(e) => setValor(e.target.value)}
            />
            {valores.length > 0 && <datalist id={`${id}-l`}>{valores.map((v) => <option key={v} value={v} />)}</datalist>}
          </>
        )}
      </div>
      {!ro && <RemoveButton label={`Remover a condição ${n}`} onClick={onRemove} />}
    </fieldset>
  );
}

function GroupEditor({ g, depth, path, campos, onChange, onRemove, ro }: { g: PredicateGroup; depth: number; path: string; campos: ProfileField[]; onChange: (g: PredicateGroup) => void; onRemove?: () => void; ro: boolean }) {
  const id = useId();
  const mode = modeOf(g);
  const items = itemsOf(g);
  const chaves = campos.map((c) => c.chave.trim()).filter(Boolean);
  const setItem = (i: number, p: Predicate) => onChange(withItems(g, items.map((x, j) => (j === i ? p : x))));
  const removeItem = (i: number) => onChange(withItems(g, items.filter((_, j) => j !== i)));
  return (
    <div className={depth > 0 ? "rounded-[2px] border border-dashed border-line p-3" : ""}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <label htmlFor={`${id}-m`} className="block text-xs font-semibold text-mute">{depth > 0 ? `Subgrupo ${path}: vale quando` : "Vale quando"}</label>
          <select id={`${id}-m`} className={`${sel} w-auto`} value={mode} disabled={ro} onChange={(e) => onChange({ [e.target.value]: items })}>
            <option value="all">todas as condições abaixo valem (E)</option>
            <option value="any">qualquer condição abaixo vale (OU)</option>
          </select>
        </div>
        {onRemove && !ro && <RemoveButton label={`Remover o subgrupo ${path}`} onClick={onRemove} />}
      </div>
      {items.length === 0 && <p className="mt-3 text-sm text-mute">Sem condições. Adicione ao menos uma.</p>}
      <ol className="mt-3 space-y-3">
        {items.map((p, i) => {
          const n = path ? `${path}.${i + 1}` : String(i + 1);
          return (
            <li key={i} className="border-l-2 border-line pl-3">
              {i > 0 && <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-mute" aria-hidden="true">{mode === "all" ? "e" : "ou"}</p>}
              {isLeaf(p) ? (
                <LeafEditor p={p} n={n} campos={campos} ro={ro} onChange={(x) => setItem(i, x)} onRemove={() => removeItem(i)} />
              ) : (
                <GroupEditor g={p} depth={depth + 1} path={n} campos={campos} ro={ro} onChange={(x) => setItem(i, x)} onRemove={() => removeItem(i)} />
              )}
            </li>
          );
        })}
      </ol>
      {!ro && (
        <div className="mt-3 flex flex-wrap gap-3">
          <AddButton onClick={() => onChange(withItems(g, [...items, novaCondicao(chaves)]))}>Condição</AddButton>
          {depth === 0 && <AddButton onClick={() => onChange(withItems(g, [...items, { [mode === "all" ? "any" : "all"]: [novaCondicao(chaves)] }]))}>Subgrupo</AddButton>}
        </div>
      )}
    </div>
  );
}

export function PredicateEditor({ title, hint, value, onChange, campos, ro, opcional }: { title: string; hint: string; value: PredicateGroup | undefined; onChange: (g: PredicateGroup | undefined) => void; campos: ProfileField[]; ro: boolean; opcional?: boolean }) {
  const chaves = campos.map((c) => c.chave.trim()).filter(Boolean);
  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="font-semibold">{title}{opcional && <span className="ml-2 text-xs font-normal text-mute">(opcional)</span>}</h4>
        {value && !ro && (
          <button type="button" onClick={() => onChange(undefined)} className="inline-flex min-h-[44px] items-center text-sm font-medium text-brand-ink underline underline-offset-2">
            Apagar regra
          </button>
        )}
      </div>
      <p className="text-sm text-mute">{hint}</p>
      {value ? (
        <GroupEditor g={value} depth={0} path="" campos={campos} ro={ro} onChange={onChange} />
      ) : ro ? (
        <p className="text-sm text-mute">Sem regra.</p>
      ) : (
        <AddButton onClick={() => onChange({ all: [novaCondicao(chaves)] })}>Definir regra</AddButton>
      )}
    </section>
  );
}
