"use client";

import dynamic from "next/dynamic";
import { Suspense, useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { Wordmark } from "@/components/Brand";
import { brand } from "@/lib/brand";
import { LoginFallback } from "./LoginFallback";
import { LoginForm } from "./LoginForm";

gsap.registerPlugin(useGSAP);

const Scene = dynamic(() => import("./LoginScene"), { ssr: false, loading: () => <LoginFallback className="absolute inset-0 h-full w-full" /> });

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

export function LoginStage() {
  const root = useRef<HTMLElement>(null);
  const openRef = useRef(0);
  const [mode, setMode] = useState<"pending" | "3d" | "flat">("pending");

  useEffect(() => setMode(can3D() ? "3d" : "flat"), []);

  // Entrada: os textos sobem em sequência. O conteúdo existe no HTML; a animação só o revela.
  useGSAP(() => {
    if (reducedMotion()) return;
    gsap.from("[data-reveal]", { autoAlpha: 0, y: 18, duration: 0.8, stagger: 0.1, ease: "power3.out" });
  }, { scope: root });

  /** As camadas se abrem (revelando o painel) antes de navegar. Sem 3D ou com redução de movimento: imediato. */
  const open = () =>
    new Promise<void>((resolve) => {
      if (mode !== "3d") return resolve();
      gsap.to(openRef, { current: 1, duration: 1.1, ease: "power3.inOut", onComplete: resolve });
    });

  return (
    <main ref={root} className="grid min-h-screen lg:h-screen lg:grid-cols-[1.3fr_1fr] lg:overflow-hidden">
      <section className="relative flex min-h-[320px] flex-col justify-between overflow-hidden bg-petroleo p-8 text-osso sm:p-12 lg:min-h-0">
        {mode === "3d" ? (
          <Suspense fallback={null}><Scene openRef={openRef} /></Suspense>
        ) : (
          <LoginFallback className="pointer-events-none absolute inset-y-0 right-[-14%] hidden h-full w-[78%] opacity-90 lg:block" />
        )}
        <div data-reveal className="relative"><Wordmark light /></div>
        <div className="relative max-w-lg">
          <p data-reveal className="mb-4 font-mono text-xs uppercase tracking-[0.18em] text-limao">01 · Entrar</p>
          <h1 data-reveal className="font-display text-[clamp(2.4rem,5vw,4.5rem)] leading-[1.02]">
            Cada contato, no momento certo.
          </h1>
          <p data-reveal className="mt-5 max-w-sm text-osso/80">{brand.tagline}. Sem perder ninguém no caminho.</p>
        </div>
        {mode !== "3d" && <LoginFallback className="relative mx-auto h-40 w-full max-w-xs lg:hidden" />}
        <p data-reveal className="relative text-xs text-osso/70">{brand.footer}</p>
      </section>

      <section className="flex items-center justify-center bg-paper p-8 lg:overflow-y-auto">
        <div data-reveal className="w-full max-w-sm">
          <Suspense fallback={null}>
            <LoginForm onAuthenticated={open} />
          </Suspense>
        </div>
      </section>
    </main>
  );
}
