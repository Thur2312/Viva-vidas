"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { Folio } from "@/components/folha";
import { CampoConfig } from "@/components/agente/CampoConfig";
import { useMe } from "@/lib/hooks";
import { Selo } from "@/components/Selo";
import { estadoProvedor, estadoTelefonia, type Estado } from "@/lib/agente-estados";
import { estadoAviso } from "@/lib/voz-view";
import type { VoiceStatus } from "./voz-api";

// Como obter cada item. Texto curto e honesto: prazos são estimativas de mercado, não promessas do provedor.
const HOWTO: Record<string, string> = {
  VOICE_TELEPHONY_PROVIDER: "Use twilio (único adaptador implementado).",
  TWILIO_ACCOUNT_SID: "Crie a conta no Twilio e copie o Account SID no Console.",
  TWILIO_AUTH_TOKEN: "No mesmo painel do Console (Auth Token). Trate como senha.",
  TWILIO_VOICE_NUMBER: "Número Twilio em formato +55… Números do Brasil exigem Regulatory Bundle aprovado (pode levar de dias a semanas).",
  VOICE_OPERATOR_PHONE: "Celular do operador que atende primeiro, formato +55DDDNÚMERO.",
  VOICE_WEBHOOK_BASE_URL: "Endereço público HTTPS da API (sem barra final), alcançável pelo Twilio.",
  ELEVENLABS_API_KEY: "No ElevenLabs: Perfil > API Keys.",
  ELEVENLABS_VOICE_ID: "No ElevenLabs: Voices, escolha a voz e copie o Voice ID.",
  STT_PROVIDER: "Use elevenlabs ou openai (API compatível).",
  STT_API_KEY: "Chave do provedor de transcrição escolhido (no ElevenLabs serve a mesma chave da voz).",
};
const howto = (name: string) => HOWTO[name] ?? (name.startsWith("STT_PROVIDER") ? HOWTO.STT_PROVIDER : "Defina esta variável no servidor da API.");
const envName = (s: string) => s.split(" ")[0];

const rotulo = "font-mono text-[11px] font-medium uppercase tracking-wider text-mute";

function Row({ title, subtitle, estado, missing = [], faltaRotulo = "O que falta", extra, role }: { title: string; subtitle: string; estado: Estado; missing?: string[]; faltaRotulo?: string; extra?: React.ReactNode; role?: string }) {
  return (
    <li className="py-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium leading-tight">{title}</p>
          <p className="mt-0.5 text-sm text-mute">{subtitle}</p>
        </div>
        <Selo estado={estado} />
      </div>
      {missing.length > 0 && (
        <div className="mt-3">
          <p className={`mb-1.5 ${rotulo}`}>{faltaRotulo}</p>
          <ul className="space-y-1.5">
            {missing.map((m) => (
              <li key={m} className="text-sm">
                <code className="font-mono text-[13px]">{envName(m)}</code>
                <span className="ml-2 text-mute">{howto(envName(m))}</span>
                <CampoConfig name={envName(m)} role={role} />
              </li>
            ))}
          </ul>
        </div>
      )}
      {extra}
    </li>
  );
}

function CopyUrl({ url }: { url: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <code className="min-w-0 flex-1 break-all border-y border-line py-1.5 font-mono text-[13px]">{url}</code>
      <button
        type="button"
        onClick={async () => {
          try { await navigator.clipboard.writeText(url); setDone(true); setTimeout(() => setDone(false), 2000); } catch { /* sem permissão: o usuário copia à mão */ }
        }}
        className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-line bg-card px-4 text-sm font-semibold hover:bg-ink/5"
      >
        {done ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
        {done ? "Copiado" : "Copiar"}
      </button>
    </div>
  );
}

export function StatusPanel({ s }: { s: VoiceStatus }) {
  const role = useMe().data?.role;
  const telMissing = s.telephony.missing;
  // O webhook só faz sentido depois da base pública definida; com ela, mostra as duas URLs que o Twilio chama.
  const baseMissing = telMissing.includes("VOICE_WEBHOOK_BASE_URL");
  return (
    <Folio n="02" title="Estado da integração" hint="Lido do servidor. Nada aqui é simulado: o que não está ligado aparece como pendente, com o nome exato da variável.">
      <ul className="divide-y divide-line border-y border-line">
        <Row
          title="Telefonia"
          subtitle={s.telephony.provider === "disabled" ? "Nenhum provedor ativo" : `Provedor: ${s.telephony.provider} (não testado com conta real)`}
          estado={estadoTelefonia(s.telephony)}
          missing={telMissing}
          role={role}
          extra={
            s.webhookUrl && !baseMissing ? (
              <div className="mt-4">
                <p className={rotulo}>Cole no console do provedor</p>
                <p className="mt-1 text-sm text-mute">Os eventos de status e gravação usam este endereço como base (/status e /recording).</p>
                <CopyUrl url={s.webhookUrl} />
              </div>
            ) : undefined
          }
        />
        <Row
          title="Voz sintética (TTS)"
          subtitle={`Provedor: ${s.tts.provider === "disabled" ? "ElevenLabs" : s.tts.provider}. Só será usada pelo agente de voz, ainda não construído.`}
          estado={estadoProvedor(s.tts, true)}
          missing={s.tts.missing}
          role={role}
          faltaRotulo={s.tts.provider === "disabled" ? "Para ligar (opcional)" : "O que falta"}
        />
        <Row
          title="Transcrição (STT)"
          subtitle={s.stt.provider === "disabled" ? "Sem provedor: gravações não são transcritas" : `Provedor: ${s.stt.provider}`}
          estado={estadoProvedor(s.stt, true)}
          missing={s.stt.missing}
          role={role}
          faltaRotulo={s.stt.provider === "disabled" ? "Para ligar (opcional)" : "O que falta"}
        />
        <Row
          title="Aviso de gravação"
          subtitle={s.recording.announcementConfigured ? `Texto configurado${s.recording.announcementVersion ? ` (versão ${s.recording.announcementVersion})` : ""}` : "Sem o texto, nenhuma ligação é feita"}
          estado={estadoAviso(s.recording)}
          extra={
            !s.recording.announcementConfigured ? (
              <p className="mt-3 text-sm text-mute">O texto é cadastrado pelo proprietário da conta (configurações de voz) e precisa de validação jurídica antes do uso.</p>
            ) : undefined
          }
        />
      </ul>
    </Folio>
  );
}
