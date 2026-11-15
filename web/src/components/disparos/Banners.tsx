"use client";
import { PauseCircle, ShieldAlert } from "lucide-react";
import { useState } from "react";
import { Selo } from "@/components/Selo";
import { estadoEnvio } from "@/lib/disparos-view";
import { ActionError, act, useAct, type Safety } from "./api";
import { ConfirmDialog, PAUSE_REASON, btnSec } from "./bits";

/**
 * Estado do interruptor geral (sempre visível) e as regras do WhatsApp e da LGPD.
 * Na lista as regras ficam recolhidas (o que muda é o interruptor); no assistente de criação ficam abertas.
 */
export function SafetyBanner({ safety, regras = "recolhidas" }: { safety?: Safety; regras?: "recolhidas" | "abertas" }) {
  const e = estadoEnvio(safety);
  return (
    <section aria-label="Regras de envio" className="mb-8">
      <div role="status" className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Selo estado={e.estado} />
        <p className="text-sm">{e.texto}</p>
      </div>
      {e.aviso && <p className="mt-2 text-sm text-mute">{e.aviso}</p>}
      <details open={regras === "abertas"} className="mt-3 border-y border-line">
        <summary className="flex min-h-[44px] cursor-pointer items-center gap-2 text-sm font-medium">
          <ShieldAlert size={16} aria-hidden="true" className="text-brand-ink" />
          O que o WhatsApp e a LGPD exigem <span className="text-mute">(4 regras)</span>
        </summary>
        <ul className="list-disc space-y-1.5 pb-3 pl-9 text-sm">
          <li><strong>Só para quem deu opt-in.</strong> Mensagem de marketing exige consentimento de marketing ativo, com a origem registrada. Lista fria não recebe: o sistema barra o lead sem consentimento.</li>
          <li><strong>Janela de 24 horas.</strong> Fora dela só vale template aprovado pela Meta. Texto livre só até 24h depois da última mensagem do lead.</li>
          <li><strong>Saída fácil.</strong> Template de marketing precisa de aviso de saída (&quot;responda PARAR&quot;) ou botão de resposta rápida. Quem sair nunca mais recebe.</li>
          <li><strong>Horário e frequência.</strong> Janela padrão 9h às 18h, segunda a sexta (horário de Brasília), e no máximo 1 marketing a cada 7 dias por pessoa. <em>Confirmar com o jurídico e a regra da Anatel.</em></li>
        </ul>
      </details>
    </section>
  );
}

/** Aviso quando há disparo pausado pela saúde do número, com retomada manual e confirmação. */
export function AutoPausedBanner({ items, canResume }: { items: { id: string; name: string }[]; canResume: boolean }) {
  const [pick, setPick] = useState<{ id: string; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const m = useAct((id: string) => act("POST", `${id}/resume`, { confirm: true }));
  if (!items.length) return null;
  return (
    <section role="alert" className="mb-8 border-t border-line pt-5">
      <h2 className="flex items-center gap-2 font-display text-xl leading-tight text-warn">
        <PauseCircle size={18} aria-hidden="true" />
        Disparos pausados automaticamente
      </h2>
      <p className="mt-1 text-sm">{PAUSE_REASON.saude_numero}. A retomada é sempre manual: confira a saúde do número antes.</p>
      <ul className="mt-3 divide-y divide-line border-y border-line">
        {items.map((i) => (
          <li key={i.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
            <span className="text-sm font-medium">{i.name}</span>
            {canResume ? (
              <button type="button" className={btnSec} onClick={() => { setError(null); setPick(i); }}>Retomar...</button>
            ) : (
              <span className="text-xs text-mute">Só gerentes podem retomar.</span>
            )}
          </li>
        ))}
      </ul>
      {pick && (
        <ConfirmDialog
          title="Retomar este disparo?" confirmLabel="Sim, retomar" busy={m.isPending} error={error}
          onClose={() => setPick(null)}
          onConfirm={() => m.mutate(pick.id, { onSuccess: () => setPick(null), onError: (e) => setError(e instanceof ActionError ? e.userMessage : "Não foi possível retomar.") })}
        >
          <p>&quot;{pick.name}&quot; volta a enviar mensagens reais. O servidor confere a saúde do número de novo e recusa se ainda houver risco.</p>
          <p className="text-mute">A retomada fica registrada na trilha de auditoria.</p>
        </ConfirmDialog>
      )}
    </section>
  );
}
