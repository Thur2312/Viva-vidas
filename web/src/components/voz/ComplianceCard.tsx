"use client";

import { CheckCircle2, CircleAlert, CircleDashed } from "lucide-react";
import { Panel } from "@/components/ui";
import type { VoiceStatus } from "./voz-api";

const DIAS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const diasTxt = (d: number[]) => {
  const s = [...d].sort();
  const seq = s.every((v, i) => i === 0 || v === s[i - 1] + 1);
  return seq && s.length > 2 ? `${DIAS[s[0]]} a ${DIAS[s[s.length - 1]]}` : s.map((x) => DIAS[x]).join(", ");
};

type Tone = "ok" | "warn" | "bad";
function Item({ tone, title, label: custom, children }: { tone: Tone; title: string; label?: string; children: React.ReactNode }) {
  const Icon = tone === "ok" ? CheckCircle2 : tone === "bad" ? CircleAlert : CircleDashed;
  const color = tone === "ok" ? "text-ok" : tone === "bad" ? "text-bad" : "text-warn";
  const label = custom ?? (tone === "ok" ? "em ordem" : tone === "bad" ? "bloqueia ligações" : "pendente");
  return (
    <li className="flex gap-3">
      <Icon size={20} className={`mt-0.5 shrink-0 ${color}`} aria-hidden="true" />
      <div className="min-w-0">
        <p className="text-sm font-semibold">
          {title} <span className={`ml-1 text-xs font-semibold ${color}`}>({label})</span>
        </p>
        <p className="text-sm text-mute">{children}</p>
      </div>
    </li>
  );
}

/** Checklist de conformidade: reflete o que o servidor APLICA antes de cada ligação (todos os portões falham fechado). */
export function ComplianceCard({ s }: { s: VoiceStatus }) {
  const w = s.callWindow;
  const dncTone: Tone = !s.dnc.enabled ? "warn" : s.dnc.configured ? "ok" : "bad";
  return (
    <Panel title="Checklist de conformidade" hint="O servidor confere cada item antes de discar. Se algum falhar, a ligação não acontece.">
      <ul className="space-y-4">
        <Item tone={s.recording.announcementConfigured ? "ok" : "bad"} title="Aviso de gravação">
          {s.recording.announcementConfigured
            ? "Tocado ao lead assim que ele atende. A gravação só é guardada se o aviso foi entregue."
            : "Texto não configurado: sem aviso, não há ligação nem gravação."}
        </Item>
        <Item tone="ok" title="Consentimento e contato permitido">
          Conferidos lead a lead no momento da ligação: precisa existir consentimento ativo para atendimento, sem pedido de não contato.
        </Item>
        <Item tone="warn" title="Janela de horário" label="confirmar com o jurídico">
          {diasTxt(w.days)}, {w.start} às {w.end} ({w.tz}){w.source ? `, definida por ${w.source === "painel" ? "configuração do painel" : w.source === "ambiente" ? "variável de ambiente" : "padrão do sistema"}` : ""}.
          As regras da Anatel para ligações de oferta e o prefixo de identificação do número precisam de confirmação jurídica/de telecom.
        </Item>
        <Item tone={dncTone} title="Não Perturbe">
          {!s.dnc.enabled
            ? "Checagem desligada. Defina a política com o jurídico antes de ligar em escala."
            : s.dnc.configured
              ? "Checagem ligada, com verificador configurado."
              : "Checagem ligada, mas sem verificador configurado: toda ligação é recusada até existir um."}
        </Item>
        <Item tone="warn" title="Retenção das gravações" label={s.recording.retentionPendingClientConfirmation ? "confirmar com o cliente" : "configurada"}>
          {s.recording.retentionDays
            ? `${s.recording.retentionDays} dias, depois a gravação é apagada no provedor.`
            : "Prazo não informado pelo servidor."}
          {s.recording.retentionPendingClientConfirmation ? " O prazo de 1 ano vem do briefing da SUSEP e precisa ser confirmado pelo cliente." : ""}
        </Item>
      </ul>
    </Panel>
  );
}
