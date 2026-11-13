"use client";

import dynamic from "next/dynamic";
import { Suspense, useEffect, useRef, useState } from "react";
import { Wordmark } from "@/components/Brand";
import { brand } from "@/lib/brand";
import { LoginFallback } from "./LoginFallback";
import { LoginForm } from "./LoginForm";

const Scene = dynamic(() => import("./LoginScene"), { ssr: false, loading: () => null });

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** 3D só quando vale a pena: tela larga, WebGL disponível, máquina com folga e sem pedido de redução de movimento. */
function can3D(): boolean {
  if (reducedMotion() || window.innerWidth < 1024) return false;
  const nav = navigator as Navigator & { deviceMemory?: number };
  if ((nav.hardwareConcurrency ?? 4) < 4 || (nav.deviceMemory ?? 8) < 4) return false;
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

const POINTS = [
  "Funil e conversas num só lugar",
  "Quem espera resposta aparece primeiro",
  "Dados tratados conforme a LGPD",
];

/**
 * Login em duas colunas. À esquerda, o funil do CRM em movimento: contatos descem por seis etapas, a maioria sai pelo
 * caminho e poucos chegam ao fim como venda (taxas ilustrativas). À direita, o formulário. Sem 3D (celular, máquina
 * fraca, sem WebGL ou movimento reduzido) entra o mesmo funil em SVG estático.
 */
export function LoginStage() {
  const openRef = useRef(0); // a cena aceita "abrir"; aqui fica sempre fechada
  const [mode, setMode] = useState<"pending" | "3d" | "flat">("pending");
  useEffect(() => setMode(can3D() ? "3d" : "flat"), []);

  return (
    <main className="grid min-h-screen lg:h-screen lg:grid-cols-[1.25fr_1fr] lg:overflow-hidden">
      <section className="relative flex min-h-[340px] flex-col justify-between gap-6 overflow-hidden bg-deep p-8 text-white sm:p-12 lg:min-h-0">
        {mode === "3d" ? (
          <Suspense fallback={null}><Scene openRef={openRef} /></Suspense>
        ) : (
          <LoginFallback className="pointer-events-none absolute inset-y-0 right-[-14%] hidden h-full w-[78%] opacity-90 lg:block" />
        )}

        <div className="relative"><Wordmark light compact /></div>

        <div className="relative max-w-lg">
          <h1 className="font-display text-[clamp(1.9rem,3.2vw,3rem)] leading-[1.1]">Cada contato, no momento certo.</h1>
          <ul className="mt-6 space-y-2.5 text-sm text-white/80 sm:text-base">
            {POINTS.map((p) => (
              <li key={p} className="flex items-center gap-3">
                <i className="h-1.5 w-1.5 shrink-0 rounded-full bg-[rgb(var(--cena-conversa))]" aria-hidden="true" />
                {p}
              </li>
            ))}
          </ul>
        </div>

        {mode !== "3d" && <LoginFallback className="relative mx-auto h-40 w-full max-w-xs lg:hidden" />}
        <p className="relative text-xs text-white/60">{brand.footer}</p>
      </section>

      <section className="flex items-center justify-center bg-paper p-6 sm:p-10 lg:overflow-y-auto">
        <div className="w-full max-w-sm rounded-md border border-line bg-card p-6 shadow-sm sm:p-8">
          <Suspense fallback={null}>
            <LoginForm />
          </Suspense>
        </div>
      </section>
    </main>
  );
}
