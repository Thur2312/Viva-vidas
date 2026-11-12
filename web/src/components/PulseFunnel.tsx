"use client";

import { useRef } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { num, pct, ratio } from "@/lib/format";

gsap.registerPlugin(useGSAP);

export type PulseRow = { key: string; nome: string; curto?: string; v: number };

/**
 * Funil como linha de batimento: cada etapa é um ponto, a altura é proporcional ao total de leads naquela etapa
 * (a escala é linear e começa em zero: nada de eixo enganoso). Os rótulos são HTML (não distorcem). O leitor de tela
 * recebe os totais pelo aria-label do gráfico; a parte visual é decorativa para ele (aria-hidden).
 */
export function PulseFunnel({ rows }: { rows: PulseRow[] }) {
  const line = useRef<SVGPolylineElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const n = rows.length;
  const max = Math.max(1, ...rows.map((r) => r.v));
  const y = (v: number) => 6 + (v / max) * 88; // % da altura útil: 6% a 94%
  const x = (i: number) => ((i + 0.5) / n) * 100;
  const pts = rows.map((r, i) => `${(i + 0.5) * 100},${100 - y(r.v)}`).join(" ");
  const area = `${0.5 * 100},100 ${pts} ${(n - 0.5) * 100},100`;
  const summary = rows.map((r) => `${r.nome}: ${num(r.v)}`).join("; ");

  useGSAP(
    () => {
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || !line.current) return;
      gsap.fromTo(line.current, { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: 1.2, ease: "power2.inOut" });
      gsap.from("[data-dot]", { scale: 0, transformOrigin: "50% 50%", duration: 0.4, stagger: 0.12, delay: 0.25, ease: "power2.out" });
    },
    { scope: box, dependencies: [pts] },
  );

  return (
    <figure ref={box} className="m-0">
      <div role="img" aria-label={`Funil do piloto. ${summary}`}>
        <div className="relative h-[230px]" aria-hidden="true">
          <div className="absolute inset-x-0 bottom-0 top-10">
            <svg viewBox={`0 0 ${n * 100} 100`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible">
              <line x1="0" y1="100" x2={n * 100} y2="100" stroke="rgb(var(--line))" strokeWidth="1" vectorEffect="non-scaling-stroke" />
              <polygon points={area} fill="rgb(var(--sinal) / 0.1)" />
              <polyline ref={line} points={pts} pathLength={1} strokeDasharray={1} fill="none" stroke="rgb(var(--sinal))" strokeWidth="2.25" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
            </svg>
            {rows.map((r, i) => {
              const last = i === n - 1;
              return (
                <div key={r.key}>
                  <span data-dot className={`absolute -translate-x-1/2 translate-y-1/2 rounded-full border-2 border-paper ${last ? "h-4 w-4 bg-sinal" : "h-3 w-3 bg-ink"}`} style={{ left: `${x(i)}%`, bottom: `${y(r.v)}%` }} />
                  <span className={`tabular absolute -translate-x-1/2 font-mono text-sm font-medium sm:text-base ${last ? "text-brand-ink" : "text-ink"}`} style={{ left: `${x(i)}%`, bottom: `calc(${y(r.v)}% + 14px)` }}>{num(r.v)}</span>
                </div>
              );
            })}
          </div>
        </div>
        <div className="mt-2 grid" style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }} aria-hidden="true">
          {rows.map((r, i) => (
            <div key={r.key} className="px-1 text-center">
              <p className={`text-[11px] font-semibold leading-tight sm:text-sm ${i === n - 1 ? "text-brand-ink" : ""}`}>
                {r.curto ? (<><span className="sm:hidden">{r.curto}</span><span className="hidden sm:inline">{r.nome}</span></>) : r.nome}
              </p>
              <p className="mt-0.5 text-[10px] text-mute sm:text-xs">{i === 0 ? "base" : rows[i - 1].v === 0 ? "sem base" : `${pct(ratio(r.v, rows[i - 1].v))} da anterior`}</p>
            </div>
          ))}
        </div>
      </div>
      <figcaption className="sr-only">Altura proporcional ao total de leads em cada etapa, a partir de zero.</figcaption>
    </figure>
  );
}
