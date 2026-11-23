"use client";
import { ShieldAlert } from "lucide-react";
import { useId } from "react";
import type { ProfileField } from "@/lib/types";
import { AddButton, LinesField, NumberField, RemoveButton, TextField, removeAt, setAt } from "./fields";

// Campos de qualificação: o que o agente pergunta, em que ordem e por quê.
// Campo sensível (ex.: saúde) nunca é perguntado; por isso não pode ser obrigatório.

const novoCampo = (ordem: number): ProfileField => ({ chave: "", pergunta: "", porque: "", obrigatorio: false, ordem, sensivel: false });

function Check({ label, checked, onChange, disabled, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; hint?: string }) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className={`inline-flex min-h-[44px] items-center gap-2 text-sm font-semibold ${disabled ? "cursor-not-allowed text-mute" : "cursor-pointer"}`}>
        <input id={id} type="checkbox" className="h-5 w-5 accent-[rgb(var(--brand))]" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} aria-describedby={hint ? `${id}-h` : undefined} />
        {label}
      </label>
      {hint && <p id={`${id}-h`} className="-mt-1 text-xs text-mute">{hint}</p>}
    </div>
  );
}

export function CampoListEditor({ campos, onChange, ro }: { campos: ProfileField[]; onChange: (c: ProfileField[]) => void; ro: boolean }) {
  const proximaOrdem = campos.reduce((m, c) => Math.max(m, c.ordem || 0), 0) + 1;
  return (
    <div className="space-y-4">
      {campos.length === 0 && <p className="text-sm text-mute">Nenhum campo cadastrado.</p>}
      <ol className="space-y-4">
        {campos.map((c, i) => {
          const nome = c.chave.trim() || `campo ${i + 1}`;
          return (
            <li key={i} className="rounded-[2px] border border-line bg-card p-4">
              <fieldset>
                <legend className="mb-3 flex w-full flex-wrap items-center gap-2 text-sm">
                  <span className="tabular font-mono text-mute">{String(i + 1).padStart(2, "0")}</span>
                  <span className="font-mono font-semibold">{nome}</span>
                  {c.sensivel && (
                    <span className="inline-flex items-center gap-1 rounded-full border border-warn/40 bg-warn/15 px-2 py-0.5 text-xs font-semibold text-warn">
                      <ShieldAlert size={12} aria-hidden="true" />
                      Sensível
                    </span>
                  )}
                </legend>
                <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
                  <TextField label="Chave" mono value={c.chave} onChange={(v) => onChange(setAt(campos, i, { chave: v }))} ro={ro} maxLength={64} hint="Nome curto, sem espaço (ex.: cidade)." />
                  <TextField label="Pergunta" value={c.pergunta} onChange={(v) => onChange(setAt(campos, i, { pergunta: v }))} ro={ro} maxLength={500} hint={c.sensivel ? "Campo sensível: o agente não faz esta pergunta." : undefined} />
                </div>
                <TextField label="Por quê" className="mt-4" value={c.porque} onChange={(v) => onChange(setAt(campos, i, { porque: v }))} ro={ro} maxLength={500} hint="Para que a corretora precisa deste dado." />
                <div className="mt-4 grid gap-4 sm:grid-cols-[auto_minmax(0,1fr)]">
                  <NumberField label="Ordem" value={c.ordem} onChange={(v) => onChange(setAt(campos, i, { ordem: v }))} ro={ro} min={0} max={999} />
                  <LinesField label="Valores possíveis (opcional)" value={c.valores ?? []} onChange={(v) => onChange(setAt(campos, i, { valores: v }))} ro={ro} />
                </div>
                <div className="mt-3 flex flex-wrap items-start justify-between gap-x-8 gap-y-1">
                  <div className="flex flex-wrap gap-x-8">
                    <Check
                      label="Sensível" checked={c.sensivel} disabled={ro}
                      onChange={(v) => onChange(setAt(campos, i, v ? { sensivel: true, obrigatorio: false } : { sensivel: false }))}
                      hint="Ex.: dado de saúde."
                    />
                    <Check
                      label="Obrigatório" checked={c.obrigatorio && !c.sensivel} disabled={ro || c.sensivel}
                      onChange={(v) => onChange(setAt(campos, i, { obrigatorio: v }))}
                      hint={c.sensivel ? "Campo sensível nunca é perguntado." : "O agente pergunta até ter a resposta."}
                    />
                  </div>
                  {!ro && <RemoveButton label={`Remover o campo ${nome}`} onClick={() => onChange(removeAt(campos, i))} />}
                </div>
              </fieldset>
            </li>
          );
        })}
      </ol>
      {!ro && <AddButton onClick={() => onChange([...campos, novoCampo(proximaOrdem)])}>Adicionar campo</AddButton>}
    </div>
  );
}
