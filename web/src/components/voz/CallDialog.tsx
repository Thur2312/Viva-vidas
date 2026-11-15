"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Phone, Search, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { ErrorState } from "@/components/Block";
import { getJson } from "@/lib/client";
import type { LeadsPage } from "@/lib/types";
import { placeCall } from "./voz-api";

const FOCUSABLE = 'a[href],button:not([disabled]),input,select,textarea,[tabindex]:not([tabindex="-1"])';

function useDebounced<T>(v: T, ms: number) {
  const [d, setD] = useState(v);
  useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t); }, [v, ms]);
  return d;
}

/**
 * Escolhe o lead e liga (o servidor liga primeiro para o operador e só depois para o lead).
 * Os bloqueios de conformidade vêm do servidor e são mostrados com o motivo.
 */
export function CallDialog({ onClose }: { onClose: () => void }) {
  const [search, setSearch] = useState("");
  const term = useDebounced(search.trim(), 300);
  const [picked, setPicked] = useState<{ id: string; name: string | null; phone: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const qc = useQueryClient();

  const leads = useQuery({
    queryKey: ["voz", "lead-search", term],
    enabled: term.length >= 2,
    queryFn: ({ signal }) => getJson<LeadsPage>(`/api/pilot/leads?search=${encodeURIComponent(term)}&pageSize=8`, signal),
    staleTime: 30_000,
  });

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    panel.current?.querySelector<HTMLElement>("input")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); onClose(); return; }
      if (e.key !== "Tab" || !panel.current) return;
      const els = Array.from(panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null);
      if (!els.length) return;
      const first = els[0], last = els[els.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); prev?.focus?.(); };
  }, [onClose]);

  async function go() {
    if (!picked || busy) return;
    setBusy(true);
    setResult(null);
    const r = await placeCall(picked.id);
    setBusy(false);
    if (r.ok) {
      setResult({ ok: true, message: "Ligação pedida. O seu telefone vai tocar primeiro; ao atender, o lead é chamado e ouve o aviso de gravação." });
      qc.invalidateQueries({ queryKey: ["voz", "calls"] });
    } else {
      setResult({ ok: false, message: r.message });
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4">
      <button type="button" tabIndex={-1} aria-label="Fechar" className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div ref={panel} role="dialog" aria-modal="true" aria-labelledby={titleId} className="relative w-full max-w-lg rounded-lg border border-line bg-paper p-5 shadow-2xl">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 id={titleId} className="font-display text-xl font-semibold">Ligar para um lead</h2>
            <p className="text-sm text-mute">Busque por nome ou telefone. O servidor confere consentimento, horário, aviso de gravação e Não Perturbe antes de discar.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar" className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-mute hover:bg-ink/10">
            <X size={20} aria-hidden="true" />
          </button>
        </div>

        <label className="relative block">
          <span className="sr-only">Buscar lead</span>
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-mute" aria-hidden="true" />
          <input
            type="search"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPicked(null); setResult(null); }}
            placeholder="Nome ou telefone (mín. 2 caracteres)"
            className="min-h-[44px] w-full rounded-lg border border-line bg-card pl-9 pr-3 text-sm"
          />
        </label>

        <div className="mt-3 max-h-56 overflow-y-auto" aria-live="polite">
          {leads.isError && <ErrorState error={leads.error} onRetry={() => leads.refetch()} compact />}
          {term.length >= 2 && leads.data && leads.data.data.length === 0 && <p className="p-2 text-sm text-mute">Nenhum lead encontrado.</p>}
          <ul className="space-y-1.5">
            {leads.data?.data.map((l) => {
              const on = picked?.id === l.id;
              return (
                <li key={l.id}>
                  <button
                    type="button"
                    onClick={() => { setPicked({ id: l.id, name: l.name, phone: l.phone }); setResult(null); }}
                    aria-pressed={on}
                    className={`flex min-h-[44px] w-full items-center justify-between gap-3 rounded-lg border px-3 text-left text-sm ${on ? "border-brand bg-brand/10" : "border-line bg-card hover:bg-ink/5"}`}
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-semibold">{l.name || "Sem nome"}</span>
                      <span className="tabular block text-xs text-mute">{l.phone ?? ""}</span>
                    </span>
                    {l.opt_out && <span className="shrink-0 rounded-full bg-bad/15 px-2 py-0.5 text-xs font-semibold text-bad">Não contatar</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        {result && (
          <p role={result.ok ? "status" : "alert"} className={`mt-3 rounded-lg border p-3 text-sm ${result.ok ? "border-ok/40 bg-ok/10 text-ink" : "border-bad/40 bg-bad/10 text-ink"}`}>
            {result.message}
          </p>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="min-h-[44px] rounded-lg border border-line bg-card px-4 text-sm font-semibold hover:bg-ink/5">
            {result?.ok ? "Fechar" : "Cancelar"}
          </button>
          {!result?.ok && (
            <button
              type="button"
              onClick={go}
              disabled={!picked || busy}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-full bg-deep px-5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-40 dark:bg-brand dark:text-deep"
            >
              <Phone size={16} aria-hidden="true" />
              {busy ? "Ligando…" : picked ? `Ligar para ${picked.name || "o lead"}` : "Escolha um lead"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
