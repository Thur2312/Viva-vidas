"use client";

import { Check, Copy, PhoneCall, Mic, AudioLines, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { Panel } from "@/components/ui";
import type { ProviderStatus, VoiceStatus } from "./voz-api";

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

function Chip({ tone, children }: { tone: "ok" | "warn" | "bad"; children: React.ReactNode }) {
  const c = { ok: "bg-ok/15 text-ok", warn: "bg-warn/15 text-warn", bad: "bg-bad/15 text-bad" }[tone];
  return <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${c}`}>{children}</span>;
}

function Row({
  icon, title, subtitle, state, missing = [], extra,
}: { icon: React.ReactNode; title: string; subtitle: string; state: { tone: "ok" | "warn" | "bad"; label: string }; missing?: string[]; extra?: React.ReactNode }) {
  return (
    <li className="rounded-xl border border-line bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span aria-hidden="true" className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-ink/[0.07] text-mute">{icon}</span>
          <div className="min-w-0">
            <p className="font-semibold leading-tight">{title}</p>
            <p className="text-sm text-mute">{subtitle}</p>
          </div>
        </div>
        <Chip tone={state.tone}>{state.label}</Chip>
      </div>
      {missing.length > 0 && (
        <div className="mt-3 border-t border-line pt-3">
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-mute">O que falta</p>
          <ul className="space-y-1.5">
            {missing.map((m) => (
              <li key={m} className="text-sm">
                <code className="rounded bg-ink/[0.08] px-1.5 py-0.5 font-mono text-[13px]">{envName(m)}</code>
                <span className="ml-2 text-mute">{howto(envName(m))}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {extra}
    </li>
  );
}

const provState = (p: ProviderStatus) => (p.ready ? { tone: "ok" as const, label: "Pronto" } : { tone: "warn" as const, label: "Pendente" });

function CopyUrl({ url }: { url: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
      <code className="min-w-0 flex-1 break-all rounded bg-ink/[0.08] px-2 py-1.5 font-mono text-[13px]">{url}</code>
      <button
        type="button"
        onClick={async () => {
          try { await navigator.clipboard.writeText(url); setDone(true); setTimeout(() => setDone(false), 2000); } catch { /* sem permissão: o usuário copia à mão */ }
        }}
        className="inline-flex min-h-[44px] items-center gap-2 rounded-full border border-line bg-card px-4 text-sm font-semibold hover:bg-ink/5"
      >
        {done ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
        {done ? "Copiado" : "Copiar"}
      </button>
    </div>
  );
}

export function StatusPanel({ s }: { s: VoiceStatus }) {
  const telMissing = s.telephony.missing;
  // O webhook só faz sentido depois da base pública definida; com ela, mostra as duas URLs que o Twilio chama.
  const baseMissing = telMissing.includes("VOICE_WEBHOOK_BASE_URL");
  return (
    <Panel
      title="Estado da integração"
      hint="Lido do servidor. Nada aqui é simulado: o que não está ligado aparece como pendente, com o nome exato da variável."
    >
      <ul className="grid gap-3 lg:grid-cols-2">
        <Row
          icon={<PhoneCall size={18} />}
          title="Telefonia"
          subtitle={s.telephony.provider === "disabled" ? "Nenhum provedor ativo" : `Provedor: ${s.telephony.provider} (não testado com conta real)`}
          state={provState(s.telephony)}
          missing={telMissing}
          extra={
            s.webhookUrl && !baseMissing ? (
              <>
                <p className="mt-3 text-xs font-semibold uppercase tracking-wider text-mute">Cole no console do provedor</p>
                <p className="mt-1 text-sm text-mute">Os eventos de status e gravação usam este endereço como base (/status e /recording).</p>
                <CopyUrl url={s.webhookUrl} />
              </>
            ) : undefined
          }
        />
        <Row
          icon={<AudioLines size={18} />}
          title="Voz sintética (TTS)"
          subtitle={`Provedor: ${s.tts.provider === "disabled" ? "ElevenLabs" : s.tts.provider}. Só será usada pelo agente de voz, ainda não construído.`}
          state={provState(s.tts)}
          missing={s.tts.missing}
        />
        <Row
          icon={<Mic size={18} />}
          title="Transcrição (STT)"
          subtitle={s.stt.provider === "disabled" ? "Sem provedor: gravações não são transcritas" : `Provedor: ${s.stt.provider}`}
          state={provState(s.stt)}
          missing={s.stt.missing}
        />
        <Row
          icon={<ShieldCheck size={18} />}
          title="Aviso de gravação"
          subtitle={s.recording.announcementConfigured ? `Texto configurado${s.recording.announcementVersion ? ` (versão ${s.recording.announcementVersion})` : ""}` : "Sem o texto, nenhuma ligação é feita"}
          state={s.recording.announcementConfigured ? { tone: "ok", label: "Configurado" } : { tone: "bad", label: "Obrigatório" }}
          extra={
            !s.recording.announcementConfigured ? (
              <p className="mt-3 border-t border-line pt-3 text-sm text-mute">O texto é cadastrado pelo proprietário da conta (configurações de voz) e precisa de validação jurídica antes do uso.</p>
            ) : undefined
          }
        />
      </ul>
    </Panel>
  );
}
