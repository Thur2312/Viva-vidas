"use client";
import { PauseCircle, ShieldAlert } from "lucide-react";
import { useState } from "react";
import { ActionError, act, useAct, type Safety } from "./api";
import { ConfirmDialog, PAUSE_REASON, btnPrimary } from "./bits";

/** Regras do WhatsApp e da LGPD, e o estado do interruptor geral. Sempre visível no topo. */
export function SafetyBanner({ safety }: { safety?: Safety }) {
  const off = !safety?.enabled;
  return (
    <aside aria-label="Regras de envio" className="mb-6 rounded-xl border border-brand/40 bg-brand/10 p-5">
      <p className="flex items-center gap-2 font-display text-base font-semibold">
        <ShieldAlert size={18} aria-hidden="true" className="text-brand-ink" />
        Antes de disparar: o que o WhatsApp e a LGPD exigem
      </p>
      <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm">
        <li><strong>Só para quem deu opt-in.</strong> Mensagem de marketing exige consentimento de marketing ativo, com a origem registrada. Lista fria não recebe: o sistema barra o lead sem consentimento.</li>
        <li><strong>Janela de 24 horas.</strong> Fora dela só vale template aprovado pela Meta. Texto livre só até 24h depois da última mensagem do lead.</li>
        <li><strong>Saída fácil.</strong> Template de marketing precisa de aviso de saída (&quot;responda PARAR&quot;) ou botão de resposta rápida. Quem sair nunca mais recebe.</li>
        <li><strong>Horário e frequência.</strong> Janela padrão 9h às 18h, segunda a sexta (horário de Brasília), e no máximo 1 marketing a cada 7 dias por pessoa. <em>Confirmar com o jurídico e a regra da Anatel.</em></li>
      </ul>
      <p className={`mt-3 rounded-lg border p-3 text-sm font-semibold ${off ? "border-warn/40 bg-warn/15 text-warn" : "border-ok/40 bg-ok/15 text-ok"}`} role="status">
        {safety === undefined
          ? "Verificando o interruptor geral de envio..."
          : off
            ? "Interruptor geral DESLIGADO (BROADCASTS_ENABLED). Nenhuma mensagem real sai: só é possível criar e simular (dry-run)."
            : "Interruptor geral LIGADO: disparos reais podem sair, dentro das regras acima."}
      </p>
      {safety && !safety.chat.configured && (
        <p className="mt-2 text-sm text-mute">Chat não configurado ({safety.chat.missing.join(", ") || "CHAT_API_URL, CHAT_BRIDGE_KEY"}): o envio real não é possível ainda. Nada foi testado com a Meta.</p>
      )}
    </aside>
  );
}

/** Aviso quando há disparo pausado pela saúde do número, com retomada manual e confirmação. */
export function AutoPausedBanner({ items, canResume }: { items: { id: string; name: string }[]; canResume: boolean }) {
  const [pick, setPick] = useState<{ id: string; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const m = useAct((id: string) => act("POST", `${id}/resume`, { confirm: true }));
  if (!items.length) return null;
  return (
    <section role="alert" className="mb-6 rounded-xl border border-warn/40 bg-warn/10 p-5">
      <p className="flex items-center gap-2 font-display text-base font-semibold text-warn">
        <PauseCircle size={18} aria-hidden="true" />
        Disparos pausados automaticamente
      </p>
      <p className="mt-1 text-sm">{PAUSE_REASON.saude_numero}. A retomada é sempre manual: confira a saúde do número antes.</p>
      <ul className="mt-3 space-y-2">
        {items.map((i) => (
          <li key={i.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-card p-3">
            <span className="text-sm font-semibold">{i.name}</span>
            {canResume ? (
              <button type="button" className={btnPrimary} onClick={() => { setError(null); setPick(i); }}>Retomar...</button>
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
