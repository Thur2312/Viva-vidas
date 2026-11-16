"use client";

import { RefreshCw, Workflow } from "lucide-react";
import { EmptyState, QueryBlock, Skeleton } from "@/components/Block";
import { Folio, Marginalia } from "@/components/folha";
import { Selo } from "@/components/Selo";
import { PageHeader } from "@/components/ui";
import { isOwner } from "@/components/disparos/api";
import { useCalendarStatus, useCrmStatus, useRetryDead, useSlots, useWhatsappConnection, type WhatsappConnection, slotDay, slotHour, type CalendarStatus, type CrmStatus, type Slot } from "@/components/integracoes/api";
import { estadoIntegracao } from "@/lib/agente-estados";
import { useMe } from "@/lib/hooks";
import { contadoresCrm, regrasAgenda } from "@/lib/integracoes-view";
import { num } from "@/lib/format";

// Tela Integrações no desenho "Prontuário": texto à esquerda, números na marginália, sem cartões.
// O estado usa a MESMA função da tela Agente (estadoIntegracao): as duas telas nunca divergem.

function Cabecalho({ s }: { s: { enabled: boolean; configured: boolean; missing: string[]; provider: string } }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <Selo estado={estadoIntegracao(s)} />
      <span className="text-sm text-mute">Provedor: {s.provider === "disabled" ? "nenhum" : s.provider}</span>
    </div>
  );
}

function Faltando({ list }: { list: string[] }) {
  if (!list.length) return null;
  return (
    <div className="mt-4">
      <p className="text-sm font-medium">Falta configurar no servidor:</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-mute">{list.map((m) => <li key={m}><code className="font-mono">{m}</code></li>)}</ul>
    </div>
  );
}

function CrmPanel({ s, owner }: { s: CrmStatus; owner: boolean }) {
  const retry = useRetryDead();
  const dead = s.queue.dead;
  return (
    <>
      <Cabecalho s={s} />
      <Faltando list={s.missing} />
      {dead > 0 && owner && (
        <div className="mt-5">
          <button type="button" disabled={retry.isPending} onClick={() => retry.mutate()} className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-line bg-card px-4 text-sm font-semibold hover:bg-ink/5 disabled:opacity-60">
            <RefreshCw size={15} aria-hidden="true" className={retry.isPending ? "animate-spin" : ""} />
            Reenviar os {num(dead)} com falha
          </button>
          {retry.isError && <p role="alert" className="mt-2 text-sm text-bad">{(retry.error as { userMessage?: string }).userMessage ?? "Não foi possível reenviar."}</p>}
          {retry.isSuccess && <p role="status" className="mt-2 text-sm text-ok">{num(retry.data.requeued)} voltaram para a fila.</p>}
        </div>
      )}
      {dead > 0 && !owner && <p className="mt-4 text-sm text-warn">Há itens com falha. Só o dono do painel pode reenviar.</p>}
    </>
  );
}

function SlotsList({ timezone, slots }: { timezone: string; slots: Slot[] }) {
  if (!slots.length) return <EmptyState title="Sem horários livres">Nenhum horário dentro das regras nos próximos dias, ou a agenda está cheia.</EmptyState>;
  const byDay = new Map<string, Slot[]>();
  for (const s of slots) { const d = slotDay(s.start, timezone); byDay.set(d, [...(byDay.get(d) ?? []), s]); }
  return (
    <ul className="divide-y divide-line border-y border-line">
      {[...byDay].map(([day, list]) => (
        <li key={day} className="grid grid-cols-1 gap-x-4 gap-y-1 py-2.5 sm:grid-cols-[11rem_minmax(0,1fr)]">
          <p className="text-sm font-medium capitalize">{day}</p>
          <p className="tabular font-mono text-sm">{list.map((s) => slotHour(s.start, timezone)).join("  ·  ")}</p>
        </li>
      ))}
    </ul>
  );
}

const WA_ESTADOS: Record<string, string> = { CONNECTED: "Conectado", qrcode: "Aguardando leitura do QR", PAIRING: "Pareando", OPENING: "Iniciando", TIMEOUT: "Tempo esgotado", DISCONNECTED: "Desconectado" };

function WhatsappPanel({ c, owner }: { c: WhatsappConnection; owner: boolean }) {
  if (!c.ok) {
    const msg = c.error === "chat_nao_configurado" ? "O chat ainda não está ligado a esta API (faltam CHAT_API_URL e CHAT_BRIDGE_KEY no servidor)." : "O chat não respondeu agora. Tente de novo em instantes.";
    return <p role="status" className="text-sm text-warn">{msg}</p>;
  }
  const d = c.data;
  const conectado = d.status === "CONNECTED";
  return (
    <>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Selo estado={{ tom: conectado ? "ok" : "warn", rotulo: WA_ESTADOS[d.status] ?? d.status }} />
        <span className="text-sm text-mute">{d.name}{d.number ? ` · ${d.number}` : ""}</span>
      </div>
      {d.qrDataUrl && owner && (
        <div className="mt-5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={d.qrDataUrl} alt="QR code para conectar o WhatsApp" width={320} height={320} className="rounded-lg border border-line bg-white p-2" />
          <ol className="mt-3 list-decimal space-y-0.5 pl-5 text-sm text-mute">
            <li>No celular do número, abra o WhatsApp.</li>
            <li>Toque em Aparelhos conectados e depois em Conectar um aparelho.</li>
            <li>Aponte a câmera para este QR. Ele se renova sozinho a cada poucos segundos.</li>
          </ol>
        </div>
      )}
      {d.qrDataUrl && !owner && <p className="mt-4 text-sm text-warn">Só o dono do painel vê o QR de conexão.</p>}
      {conectado && <p className="mt-4 text-sm text-mute">Número conectado. As conversas aparecem na aba Conversas.</p>}
    </>
  );
}

function CalendarPanel({ s }: { s: CalendarStatus }) {
  const ready = s.enabled && s.configured;
  const slots = useSlots(ready);
  return (
    <>
      <Cabecalho s={s} />
      <Faltando list={s.missing} />
      {ready ? (
        <div className="mt-5">
          <h3 className="mb-2 font-mono text-[11px] font-medium uppercase tracking-wider text-mute">Próximos horários livres</h3>
          <QueryBlock q={slots} skeleton={<Skeleton className="h-32" />}>{(d) => <SlotsList timezone={d.timezone} slots={d.slots} />}</QueryBlock>
        </div>
      ) : (
        <p className="mt-4 text-sm text-mute">Para agendar pelo painel, o servidor precisa da conta Google do Alberto conectada. O passo a passo está em <code className="font-mono">docs/google-calendar.md</code>.</p>
      )}
    </>
  );
}

export default function Integracoes() {
  const me = useMe();
  const crm = useCrmStatus();
  const cal = useCalendarStatus();
  const wa = useWhatsappConnection();
  return (
    <>
      <PageHeader eyebrow="Agente" title="Integrações">
        WhatsApp, Pipedrive e Google Agenda: o que está ligado, o que falta configurar e o que ficou pendente.
      </PageHeader>

      <div className="grid gap-x-14 gap-y-12 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-12">
          <Folio n="01" title="WhatsApp" hint="Conexão do número pelo chat. Quando precisar parear, o QR aparece aqui.">
            <QueryBlock q={wa} skeleton={<Skeleton className="h-40" />}>{(c) => <WhatsappPanel c={c} owner={isOwner(me.data?.role)} />}</QueryBlock>
          </Folio>

          <Folio n="02" title="Pipedrive (CRM)" hint="Cada etapa do funil vira um negócio no CRM do Alberto, por uma fila com nova tentativa.">
            <QueryBlock q={crm} skeleton={<Skeleton className="h-40" />}>{(s) => <CrmPanel s={s} owner={isOwner(me.data?.role)} />}</QueryBlock>
          </Folio>

          <Folio n="03" title="Google Agenda" hint="Horários livres da agenda do Alberto e agendamento direto pelo lead.">
            <QueryBlock q={cal} skeleton={<Skeleton className="h-40" />}>{(s) => <CalendarPanel s={s} />}</QueryBlock>
          </Folio>

          <p className="flex items-center gap-2 text-xs text-mute"><Workflow size={14} aria-hidden="true" /> Para agendar um lead, abra o lead no funil e use “Agendar reunião”.</p>
        </div>

        <aside className="min-w-0 space-y-10" aria-label="Números de apoio">
          <section aria-labelledby="fila-crm">
            <h2 id="fila-crm" className="mb-3 font-display text-xl leading-tight">Fila do CRM</h2>
            <QueryBlock q={crm} skeleton={<Skeleton className="h-40" />}>{(s) => (s.enabled ? <Marginalia items={contadoresCrm(s)} /> : <p className="border-y border-line py-3 text-sm text-mute">CRM desligado: nada é enfileirado, então não há contadores para mostrar.</p>)}</QueryBlock>
            <p className="mt-3 text-xs text-mute">Só entram etapas qualificado, reunião, compareceu, venda, perdido e opt-out. Nunca conteúdo de mensagem.</p>
          </section>

          <section aria-labelledby="regras-agenda">
            <h2 id="regras-agenda" className="mb-3 font-display text-xl leading-tight">Regras da agenda</h2>
            <QueryBlock q={cal} skeleton={<Skeleton className="h-40" />}>
              {(s) => (
                <>
                  {!s.enabled && <p className="mb-3 text-sm">Agenda desligada: estas regras só valem quando ela for ligada.</p>}
                  <Marginalia items={regrasAgenda(s.rules)} className={s.enabled ? "" : "text-mute"} />
                  <p className="mt-3 text-xs text-mute">Ajustáveis no servidor, em <code className="font-mono">CALENDAR_RULES</code>.</p>
                </>
              )}
            </QueryBlock>
          </section>
        </aside>
      </div>
    </>
  );
}
