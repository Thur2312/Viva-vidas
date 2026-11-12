"use client";
import { useState } from "react";

export type Preset = "hoje" | "ontem" | "7d" | "30d" | "mes" | "custom";
export type Range = { preset: Preset; from: string; to: string };

export const PRESETS: { id: Preset; label: string }[] = [
  { id: "hoje", label: "Hoje" },
  { id: "ontem", label: "Ontem" },
  { id: "7d", label: "7 dias" },
  { id: "30d", label: "30 dias" },
  { id: "mes", label: "Este mês" },
  { id: "custom", label: "Personalizado" },
];

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

export function resolvePreset(preset: Exclude<Preset, "custom">, now = new Date()): Range {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  switch (preset) {
    case "hoje": return { preset, from: iso(today), to: iso(today) };
    case "ontem": return { preset, from: iso(addDays(today, -1)), to: iso(addDays(today, -1)) };
    case "7d": return { preset, from: iso(addDays(today, -6)), to: iso(today) };
    case "30d": return { preset, from: iso(addDays(today, -29)), to: iso(today) };
    case "mes": return { preset, from: iso(new Date(today.getFullYear(), today.getMonth(), 1)), to: iso(today) };
  }
}

export const isValidRange = (r: Range) => /^\d{4}-\d{2}-\d{2}$/.test(r.from) && /^\d{4}-\d{2}-\d{2}$/.test(r.to) && r.from <= r.to;


/** Período aplicado (estado local da página). */
export function useRangeState(initial: Exclude<Preset, "custom"> = "30d") {
  const [range, setRange] = useState<Range>(() => resolvePreset(initial));
  return [range, setRange] as const;
}
