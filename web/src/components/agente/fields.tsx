"use client";
import { Plus, Trash2 } from "lucide-react";
import { useId, type ReactNode } from "react";
import { btnSec, field } from "@/components/disparos/bits";
import { splitExemplo } from "./playbook-api";

// Peças pequenas do editor de playbook. Somente leitura (`ro`) mantém o texto legível e focável:
// campos de texto viram readOnly (sem o cinza do disabled), seletores e caixas ficam disabled.

export const roField = "read-only:bg-ink/[0.03] read-only:text-ink";

/** Instrução do modelo + exemplo apagado, rotulado "EXEMPLO (não ativo)". Nunca é salvo como conteúdo. */
export function Exemplo({ text }: { text?: string }) {
  const e = splitExemplo(text);
  if (!e) return null;
  return (
    <div className="mb-4 space-y-2 text-sm text-mute">
      {e.instrucao && <p className="max-w-[68ch]">{e.instrucao}</p>}
      {e.exemplo && (
        <p className="max-w-[68ch] border-l-2 border-dashed border-line pl-3 italic">
          <span className="mr-2 not-italic text-[11px] font-semibold uppercase tracking-wider">Exemplo (não ativo)</span>
          {e.exemplo}
        </p>
      )}
    </div>
  );
}

export function TextField({
  label, value, onChange, ro, hint, multiline, placeholder, mono, maxLength = 4000, className = "",
}: {
  label: string; value: string; onChange: (v: string) => void; ro?: boolean; hint?: ReactNode; multiline?: boolean;
  placeholder?: string; mono?: boolean; maxLength?: number; className?: string;
}) {
  const id = useId();
  const hid = hint ? `${id}-h` : undefined;
  const cls = `${field} ${roField} mt-1 ${mono ? "font-mono" : ""} ${multiline ? "min-h-[88px] py-2" : ""}`;
  return (
    <div className={className}>
      <label htmlFor={id} className="block text-sm font-semibold">{label}</label>
      {multiline ? (
        <textarea id={id} className={cls} value={value} onChange={(e) => onChange(e.target.value)} readOnly={ro} placeholder={placeholder} maxLength={maxLength} aria-describedby={hid} />
      ) : (
        <input id={id} className={cls} value={value} onChange={(e) => onChange(e.target.value)} readOnly={ro} placeholder={placeholder} maxLength={maxLength} aria-describedby={hid} />
      )}
      {hint && <p id={hid} className="mt-1 text-xs text-mute">{hint}</p>}
    </div>
  );
}

/** Lista de textos, uma por linha. Guarda as linhas cruas enquanto se digita; a limpeza é na hora de salvar. */
export function LinesField({ label, value, onChange, ro, hint, className = "" }: { label: string; value: string[]; onChange: (v: string[]) => void; ro?: boolean; hint?: ReactNode; className?: string }) {
  return (
    <TextField
      label={label} value={value.join("\n")} onChange={(v) => onChange(v === "" ? [] : v.split("\n"))} ro={ro} multiline maxLength={20000}
      hint={<>Um item por linha.{hint ? <> {hint}</> : null}</>} className={className}
    />
  );
}

export function NumberField({ label, value, onChange, ro, hint, min = 0, max = 999, className = "" }: { label: string; value: number; onChange: (v: number) => void; ro?: boolean; hint?: ReactNode; min?: number; max?: number; className?: string }) {
  const id = useId();
  const hid = hint ? `${id}-h` : undefined;
  return (
    <div className={className}>
      <label htmlFor={id} className="block text-sm font-semibold">{label}</label>
      <input
        id={id} type="number" inputMode="numeric" min={min} max={max} className={`${field} ${roField} tabular mt-1 max-w-[10rem] font-mono`}
        value={Number.isFinite(value) && value !== 0 ? value : ""} placeholder="0" readOnly={ro} aria-describedby={hid}
        onChange={(e) => onChange(Math.max(min, Math.min(max, Math.trunc(Number(e.target.value) || 0))))}
      />
      {hint && <p id={hid} className="mt-1 text-xs text-mute">{hint}</p>}
    </div>
  );
}

export function AddButton({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={btnSec}>
      <Plus size={15} aria-hidden="true" />
      {children}
    </button>
  );
}

export function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label} className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-line text-mute hover:border-bad/50 hover:text-bad">
      <Trash2 size={16} aria-hidden="true" />
    </button>
  );
}

/** Atualiza um item de uma lista sem mutar. */
export const setAt = <T,>(list: T[], i: number, patch: Partial<T>): T[] => list.map((x, j) => (j === i ? { ...x, ...patch } : x));
export const removeAt = <T,>(list: T[], i: number): T[] => list.filter((_, j) => j !== i);
