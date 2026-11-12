"use client";

import { useId, useState } from "react";
import { PRESETS, isValidRange, resolvePreset, type Preset, type Range } from "@/lib/range";

const chip = (on: boolean) =>
  `inline-flex min-h-[44px] items-center rounded-full border px-4 text-sm font-medium transition-colors ${
    on ? "border-deep bg-deep text-white dark:border-brand dark:bg-brand dark:text-deep" : "border-line bg-card hover:bg-ink/5"
  }`;

/**
 * Presets aplicam na hora. "Personalizado" mostra datas:
 * - deferCustom (padrão): as datas ficam em rascunho e só valem após "Aplicar";
 * - sem deferCustom: cada alteração sobe como rascunho (o pai decide quando aplicar).
 */
export function RangePicker({ value, onChange, deferCustom = true }: { value: Range; onChange: (r: Range) => void; deferCustom?: boolean }) {
  const id = useId();
  const [draft, setDraft] = useState<Range>(value);
  const showCustom = deferCustom ? draft.preset === "custom" : value.preset === "custom";
  const shown = deferCustom ? draft : value;

  const pick = (p: Preset) => {
    if (p === "custom") {
      const base = { preset: "custom" as const, from: value.from, to: value.to };
      setDraft(base);
      if (!deferCustom) onChange(base);
      return;
    }
    const r = resolvePreset(p);
    setDraft(r);
    onChange(r);
  };
  const setDates = (patch: Partial<Range>) => {
    const next = { ...shown, ...patch, preset: "custom" as const };
    setDraft(next);
    if (!deferCustom) onChange(next);
  };
  const valid = isValidRange(shown);

  return (
    <div className="flex flex-wrap items-end gap-2">
      <div role="group" aria-label="Período" className="flex flex-wrap gap-2">
        {PRESETS.map((p) => (
          <button key={p.id} type="button" aria-pressed={shown.preset === p.id} onClick={() => pick(p.id)} className={chip(shown.preset === p.id)}>
            {p.label}
          </button>
        ))}
      </div>
      {showCustom && (
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label htmlFor={`${id}-de`} className="mb-1 block text-xs font-medium text-mute">De</label>
            <input id={`${id}-de`} type="date" value={shown.from} max={shown.to || undefined} onChange={(e) => setDates({ from: e.target.value })} className="min-h-[44px] rounded-lg border border-line bg-card px-3 text-sm" />
          </div>
          <div>
            <label htmlFor={`${id}-ate`} className="mb-1 block text-xs font-medium text-mute">Até</label>
            <input id={`${id}-ate`} type="date" value={shown.to} min={shown.from || undefined} onChange={(e) => setDates({ to: e.target.value })} className="min-h-[44px] rounded-lg border border-line bg-card px-3 text-sm" />
          </div>
          {deferCustom && (
            <button type="button" disabled={!valid} onClick={() => onChange(draft)} className="min-h-[44px] rounded-full bg-brand px-5 text-sm font-bold text-on-brand disabled:cursor-not-allowed disabled:opacity-50">
              Aplicar
            </button>
          )}
          {!valid && <p role="status" className="basis-full text-xs text-bad">Informe datas válidas, com início antes do fim.</p>}
        </div>
      )}
    </div>
  );
}
