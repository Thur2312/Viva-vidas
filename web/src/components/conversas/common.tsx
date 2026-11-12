"use client";

import { Eye, EyeOff } from "lucide-react";
import { usePrivacy } from "../Providers";

/** "Ocultar dados sensíveis": mesmo estado global da gaveta do funil. */
export function PrivacyToggle({ className = "" }: { className?: string }) {
  const { hide, setHide } = usePrivacy();
  const label = hide ? "Mostrar dados sensíveis" : "Ocultar dados sensíveis";
  return (
    <button type="button" onClick={() => setHide(!hide)} aria-pressed={hide} aria-label={label} title={label} className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-mute hover:bg-ink/10 ${className}`}>
      {hide ? <EyeOff size={19} aria-hidden="true" /> : <Eye size={19} aria-hidden="true" />}
    </button>
  );
}

export const AUTHOR: Record<string, string> = { lead: "Cliente", humano: "Equipe", agente: "Agente" };
export const MODE_LABEL: Record<string, string> = { shadow: "Sombra", assisted: "Assistido", auto: "Automático" };

/** 45 s, 12 min, 1 h 20 min, 2 d 3 h. Nulo vira traço (sem estimativa). */
export function duration(sec: number | null | undefined): string {
  if (sec === null || sec === undefined || !Number.isFinite(sec)) return "—";
  const s = Math.round(sec);
  if (s < 60) return `${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 ? `${h} h ${m % 60} min` : `${h} h`;
  const d = Math.floor(h / 24);
  return h % 24 ? `${d} d ${h % 24} h` : `${d} d`;
}

const TZ = "America/Sao_Paulo";
export const dayKey = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: TZ });
export function dayLabel(iso: string): string {
  const k = dayKey(iso);
  const today = dayKey(new Date().toISOString());
  const yest = dayKey(new Date(Date.now() - 86_400_000).toISOString());
  if (k === today) return "Hoje";
  if (k === yest) return "Ontem";
  const sameYear = new Date(iso).getFullYear() === new Date().getFullYear();
  return new Date(iso).toLocaleDateString("pt-BR", { timeZone: TZ, day: "2-digit", month: "long", year: sameYear ? undefined : "numeric" });
}
export const hourLabel = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
