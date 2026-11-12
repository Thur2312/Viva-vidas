"use client";

import { Phone, PhoneCall, Shield, Mic } from "lucide-react";
import { useState } from "react";
import { QueryBlock, Skeleton } from "@/components/Block";
import { KpiCard, PageHeader } from "@/components/ui";
import { CallDialog } from "@/components/voz/CallDialog";
import { CallsTable } from "@/components/voz/CallsTable";
import { LiveCall, isActive } from "@/components/voz/LiveCall";
import { ComplianceCard } from "@/components/voz/ComplianceCard";
import { StatusPanel } from "@/components/voz/StatusPanel";
import { isManager, useCalls, useVoiceStatus, type VoiceStatus } from "@/components/voz/voz-api";
import { useMe } from "@/lib/hooks";
import { num } from "@/lib/format";

/** Por que o botão Ligar está indisponível, em linguagem direta. */
function blockedReason(s: VoiceStatus, manager: boolean): string | null {
  if (!manager) return "Só gestores podem ligar.";
  if (!s.telephony.ready) return "A telefonia ainda não está configurada (veja o que falta abaixo).";
  if (!s.recording.announcementConfigured) return "Falta o texto do aviso de gravação.";
  if (s.dnc.enabled && !s.dnc.configured) return "Não Perturbe está ligado, mas não há verificador configurado.";
  if (s.canPlaceCalls === false) return "Alguma condição de conformidade não está atendida.";
  return null;
}

export default function Voz() {
  const status = useVoiceStatus();
  const me = useMe();
  const calls = useCalls({ page: 1, status: "" });
  const [dialog, setDialog] = useState(false);
  const manager = isManager(me.data?.role);
  const activeCall = calls.data?.data.find(isActive);

  return (
    <>
      <PageHeader eyebrow="Voz" title="Ligações e gravações">
        Ligação assistida por um operador humano, com aviso de gravação e checagens de conformidade. O agente de voz automático ainda não existe: o agente continua em modo sombra, aprendendo com a equipe.
      </PageHeader>

      <QueryBlock q={status} skeleton={<div className="space-y-6"><Skeleton className="h-28" /><Skeleton className="h-64" /></div>}>
        {(s) => {
          const reason = blockedReason(s, manager);
          return (
            <div className="space-y-6">
              {activeCall && <LiveCall call={activeCall} canSeeTranscript={manager} />}
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <KpiCard
                  title="Telefonia"
                  value={s.telephony.ready ? "Pronta" : "Pendente"}
                  sub={s.telephony.ready ? "Provedor configurado (não testado com conta real)" : `${s.telephony.missing.length} item(ns) faltando`}
                  icon={<PhoneCall size={18} aria-hidden="true" />}
                  variant={s.telephony.ready ? "success" : "warning"}
                />
                <KpiCard
                  title="Aviso de gravação"
                  value={s.recording.announcementConfigured ? "Configurado" : "Pendente"}
                  sub={s.recording.announcementConfigured ? "Sem aviso não há gravação" : "Obrigatório para ligar"}
                  icon={<Shield size={18} aria-hidden="true" />}
                  variant={s.recording.announcementConfigured ? "success" : "warning"}
                />
                <KpiCard
                  title="Transcrição"
                  value={s.stt.ready ? "Ligada" : "Desligada"}
                  sub={s.stt.ready ? s.stt.provider : "Sem provedor de STT"}
                  icon={<Mic size={18} aria-hidden="true" />}
                  variant={s.stt.ready ? "success" : "default"}
                />
                <KpiCard
                  title="Ligações registradas"
                  value={calls.data ? num(calls.data.meta.totalItems) : "—"}
                  sub={calls.isError ? "Não foi possível carregar" : "Total no histórico"}
                  icon={<Phone size={18} aria-hidden="true" />}
                />
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  disabled={!!reason}
                  onClick={() => setDialog(true)}
                  aria-describedby={reason ? "ligar-motivo" : undefined}
                  className={`inline-flex min-h-[44px] items-center gap-2 rounded-full bg-deep px-6 text-sm font-semibold text-white shadow-sm hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-brand dark:text-deep ${activeCall ? "" : "btn-pulse"}`}
                >
                  <Phone size={16} aria-hidden="true" />
                  Ligar para um lead
                </button>
                {reason && <p id="ligar-motivo" className="text-sm text-mute">Indisponível: {reason}</p>}
              </div>

              <StatusPanel s={s} />
              <ComplianceCard s={s} />
              <CallsTable canSeeTranscript={manager} />
              {dialog && <CallDialog onClose={() => setDialog(false)} />}
            </div>
          );
        }}
      </QueryBlock>
    </>
  );
}
