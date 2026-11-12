"use client";

import { useRef } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";

gsap.registerPlugin(useGSAP);

/**
 * Número que "conta" até o valor (a manchete). O texto final já está no HTML; com prefers-reduced-motion ele fica parado.
 * Ao mudar o valor (outro período) conta a partir do número anterior, não de zero.
 */
export function CountUp({ value, format, className }: { value: number; format: (n: number) => string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const prev = useRef(0);

  useGSAP(
    () => {
      const el = ref.current;
      if (!el) return;
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        el.textContent = format(value);
        prev.current = value;
        return;
      }
      const o = { v: prev.current };
      el.textContent = format(o.v);
      gsap.to(o, {
        v: value, duration: 0.9, ease: "power2.out",
        onUpdate: () => { el.textContent = format(o.v); },
        onComplete: () => { el.textContent = format(value); prev.current = value; },
      });
    },
    { dependencies: [value], scope: ref },
  );

  return <span ref={ref} className={className}>{format(value)}</span>;
}
