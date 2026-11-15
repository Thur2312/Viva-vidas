"use client";

import { Phone } from "lucide-react";
import { useState } from "react";
import { QueryBlock, Skeleton } from "@/components/Block";
import { Manchete, Marginalia } from "@/components/folha";
import { PageHeader } from "@/components/ui";
import { CallDialog } from "@/components/voz/CallDialog";
import { CallsTable } from "@/components/voz/CallsTable";
import { ComplianceCard } from "@/components/voz/ComplianceCard";
import { LiveCall, isActive } from "@/components/voz/LiveCall";
import { StatusPanel } from "@/components/voz/StatusPanel";
import { isManager, useCalls, useVoiceStatus } from "@/components/voz/voz-api";
import { num } from "@/lib/format";
import { useMe } from "@/lib/hooks";
import { manchete } from "@/lib/voz-view";

// Tela Voz no desenho "Prontuário": a manchete responde "posso ligar agora?", o histórico (uso diário) vem primeiro,
// a configuração depois, e a conformidade fica na marginália. A lógica de quem pode ligar está em lib/voz-view.ts.

export default function Voz() {
  const status = useVoiceStatus();
  const me = useMe();
  const calls = useCalls({ page: 1, status: "" });
  const [dialog, setDialog] = useState(false);
  const manager = isManager(me.data?.role);
  const activeCall = calls.data?.data.find(isActive);
  const emAndamento = calls.data?.data.filter(isActive).length;

  return (
    <>
      <PageHeader eyebrow="Voz" title="Ligações e gravações">
        Ligação assistida por um operador humano, com aviso de gravação e checagens de conformidade. O agente de voz automático ainda não existe: o agente continua em modo sombra, aprendendo com a equipe.
      </PageHeader>

      <QueryBlock q={status} skeleton={<div className="space-y-6"><Skeleton className="h-28" /><Skeleton className="h-64" /></div>}>
        {(s) => {
          const m = manchete(s, manager);
          return (
            <div className="space-y-10">
              {activeCall && <LiveCall call={activeCall} canSeeTranscript={manager} />}

              <div className="grid gap-x-14 gap-y-12 xl:grid-cols-[minmax(0,1fr)_340px]">
                <div className="min-w-0 space-y-12">
                  <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-5">
                    <Manchete
                      label="Ligação assistida"
                      tone={m.motivo ? "ink" : "brand"}
                      caption={m.motivo ?? "Nada impede a ligação agora. O servidor ainda confere consentimento, Não Perturbe e horário de cada lead antes de discar."}
                    >
                      {m.valor}
                    </Manchete>
                    <div>
                      <button
                        type="button"
                        disabled={!!m.motivo}
                        onClick={() => setDialog(true)}
                        aria-describedby={m.motivo ? "ligar-motivo" : undefined}
                        className={`inline-flex min-h-[44px] items-center gap-2 rounded-full bg-deep px-6 text-sm font-semibold text-white shadow-sm hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-brand dark:text-deep ${activeCall ? "" : "btn-pulse"}`}
                      >
                        <Phone size={16} aria-hidden="true" />
                        Ligar para um lead
                      </button>
                      {m.motivo && <p id="ligar-motivo" className="sr-only">Indisponível: {m.motivo}</p>}
                    </div>
                  </div>

                  <CallsTable canSeeTranscript={manager} />
                  <StatusPanel s={s} />
                </div>

                <aside className="min-w-0 space-y-10" aria-label="Resumo e conformidade">
                  <section aria-labelledby="resumo-voz">
                    <h2 id="resumo-voz" className="mb-3 font-display text-xl leading-tight">Resumo</h2>
                    <Marginalia
                      items={[
                        { label: "Ligações registradas", value: calls.data ? num(calls.data.meta.totalItems) : "—", sub: calls.isError ? "Não foi possível carregar" : "Total no histórico" },
                        { label: "Em andamento", value: emAndamento === undefined ? "—" : num(emAndamento), sub: "Entre as mais recentes" },
                      ]}
                    />
                  </section>
                  <ComplianceCard s={s} />
                </aside>
              </div>

              {dialog && <CallDialog onClose={() => setDialog(false)} />}
            </div>
          );
        }}
      </QueryBlock>
    </>
  );
}
