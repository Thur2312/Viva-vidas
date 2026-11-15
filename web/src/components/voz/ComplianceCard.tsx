"use client";

import { CheckCircle2, CircleAlert, CircleDashed, Info } from "lucide-react";
import { itensConformidade, type TomConf } from "@/lib/voz-view";
import type { VoiceStatus } from "./voz-api";

const ICONE = { ok: CheckCircle2, bad: CircleAlert, warn: CircleDashed, regra: Info } as const;
const COR: Record<TomConf, string> = { ok: "text-ok", bad: "text-bad", warn: "text-warn", regra: "text-mute" };

/** Checklist de conformidade (coluna de marginália): reflete o que o servidor APLICA antes de cada ligação (todos os portões falham fechado). */
export function ComplianceCard({ s }: { s: VoiceStatus }) {
  return (
    <section aria-labelledby="conformidade">
      <h2 id="conformidade" className="font-display text-xl leading-tight">Conformidade</h2>
      <p className="mb-3 mt-1 text-xs text-mute">O servidor confere cada item antes de discar. Se algum falhar, a ligação não acontece.</p>
      <ul className="divide-y divide-line border-y border-line">
        {itensConformidade(s).map((it) => {
          const Icon = ICONE[it.tom];
          return (
            <li key={it.chave} className="flex gap-3 py-3">
              <Icon size={18} className={`mt-0.5 shrink-0 ${COR[it.tom]}`} aria-hidden="true" />
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  {it.titulo} <span className={`ml-1 text-xs font-semibold ${COR[it.tom]}`}>({it.rotulo})</span>
                </p>
                <p className="mt-0.5 text-xs leading-relaxed text-mute">{it.texto}</p>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
