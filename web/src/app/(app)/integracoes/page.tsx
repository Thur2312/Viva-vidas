"use client";

import { CalendarClock, RefreshCw, Workflow } from "lucide-react";
import { EmptyState, QueryBlock, Skeleton } from "@/components/Block";
import { PageHeader, Panel } from "@/components/ui";
import { isOwner } from "@/components/disparos/api";
import { useCalendarStatus, useCrmStatus, useRetryDead, useSlots, slotDay, slotHour, type CalendarStatus, type CrmStatus, type Slot } from "@/components/integracoes/api";
import { useMe } from "@/lib/hooks";
import { num } from "@/lib/format";

const DIAS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

function Pill({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${ok ? "bg-ok/15 text-ok" : "bg-warn/15 text-warn"}`}>{children}</span>;
}

function Missing({ list }: { list: string[] }) {
  if (!list.length) return null;
  return (
    <div className="mt-3 rounded-lg bg-warn/10 p-3 text-sm text-warn">
      <p className="font-semibold">Falta configurar no servidor:</p>
      <ul className="mt-1 list-disc pl-5">{list.map((m) => <li key={m}><code>{m}</code></li>)}</ul>
    </div>
  );
}

function CrmCard({ s, owner }: { s: CrmStatus; owner: boolean }) {
  const retry = useRetryDead();
  const q = s.queue;
  const state = !s.enabled ? "Desligado" : s.configured ? "Ligado" : "Ligado, sem credenciais";
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Pill ok={s.enabled && s.configured}>{state}</Pill>
        <span className="text-sm text-mute">Provedor: {s.provider === "disabled" ? "nenhum" : s.provider}</span>
      </div>
      <Missing list={s.missing} />
      <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {([["Na fila", q.pending + q.processing], ["Enviados", q.sent], ["Ignorados", q.skipped], ["Com falha", q.dead]] as const).map(([k, v]) => (
          <div key={k} className="rounded-lg border border-line bg-card p-3">
            <dt className="text-xs font-semibold uppercase tracking-wider text-mute">{k}</dt>
            <dd className={`tabular mt-1 font-display text-2xl font-semibold ${k === "Com falha" && v > 0 ? "text-bad" : ""}`}>{num(v)}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-xs text-mute">Só entram etapas qualificado, reunião, compareceu, venda, perdido e opt-out. Nunca conteúdo de mensagem.</p>
      {q.dead > 0 && owner && (
        <div className="mt-4">
          <button type="button" disabled={retry.isPending} onClick={() => retry.mutate()} className="inline-flex min-h-[44px] items-center gap-2 rounded-full border border-line bg-card px-4 text-sm font-semibold hover:bg-ink/5 disabled:opacity-60">
            <RefreshCw size={15} aria-hidden="true" className={retry.isPending ? "animate-spin" : ""} />
            Reenviar os {num(q.dead)} com falha
          </button>
          {retry.isError && <p role="alert" className="mt-2 text-sm text-bad">{(retry.error as { userMessage?: string }).userMessage ?? "Não foi possível reenviar."}</p>}
          {retry.isSuccess && <p role="status" className="mt-2 text-sm text-ok">{num(retry.data.requeued)} voltaram para a fila.</p>}
        </div>
      )}
      {q.dead > 0 && !owner && <p className="mt-3 text-sm text-warn">Há itens com falha. Só o dono do painel pode reenviar.</p>}
    </>
  );
}

function SlotsList({ timezone, slots }: { timezone: string; slots: Slot[] }) {
  if (!slots.length) return <EmptyState title="Sem horários livres">Nenhum horário dentro das regras nos próximos dias, ou a agenda está cheia.</EmptyState>;
  const byDay = new Map<string, Slot[]>();
  for (const s of slots) { const d = slotDay(s.start, timezone); byDay.set(d, [...(byDay.get(d) ?? []), s]); }
  return (
    <ul className="space-y-3">
      {[...byDay].map(([day, list]) => (
        <li key={day}>
          <p className="mb-1 text-sm font-semibold capitalize">{day}</p>
          <div className="flex flex-wrap gap-2">
            {list.map((s) => <span key={s.start} className="tabular rounded-full border border-line bg-card px-3 py-1 text-sm">{slotHour(s.start, timezone)}</span>)}
          </div>
        </li>
      ))}
    </ul>
  );
}

function CalendarCard({ s }: { s: CalendarStatus }) {
  const ready = s.enabled && s.configured;
  const slots = useSlots(ready);
  const r = s.rules;
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Pill ok={ready}>{!s.enabled ? "Desligado" : s.configured ? "Ligado" : "Ligado, sem credenciais"}</Pill>
        <span className="text-sm text-mute">Provedor: {s.provider === "disabled" ? "nenhum" : s.provider}</span>
      </div>
      <Missing list={s.missing} />
      <p className="mt-4 text-sm text-mute">
        Regras: {r.days.map((d) => DIAS[d]).join(", ")}, {r.start} às {r.end}, reuniões de {r.durationMin} min, com {Math.round(r.minNoticeMin / 60 * 10) / 10} h de antecedência, até {r.horizonDays} dias à frente ({r.timezone}). Ajustáveis no servidor, em <code>CALENDAR_RULES</code>.
      </p>
      {ready && (
        <div className="mt-4">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-mute">Próximos horários livres</h3>
          <QueryBlock q={slots} skeleton={<Skeleton className="h-32" />}>{(d) => <SlotsList timezone={d.timezone} slots={d.slots} />}</QueryBlock>
        </div>
      )}
      {!ready && <p className="mt-4 text-sm text-mute">Para agendar pelo painel, o servidor precisa da conta Google do Alberto conectada. O passo a passo está em <code>docs/google-calendar.md</code>.</p>}
    </>
  );
}

export default function Integracoes() {
  const me = useMe();
  const crm = useCrmStatus();
  const cal = useCalendarStatus();
  return (
    <>
      <PageHeader eyebrow="Agente" title="Integrações">
        Pipedrive e Google Agenda: o que está ligado, o que falta configurar e o que ficou pendente.
      </PageHeader>
      <div className="grid gap-6 xl:grid-cols-2">
        <Panel title="Pipedrive (CRM)" hint="Cada etapa do funil vira um negócio no CRM do Alberto, por uma fila com nova tentativa.">
          <QueryBlock q={crm} skeleton={<Skeleton className="h-56" />}>{(s) => <CrmCard s={s} owner={isOwner(me.data?.role)} />}</QueryBlock>
        </Panel>
        <Panel title="Google Agenda" hint="Horários livres da agenda do Alberto e agendamento direto pelo lead." action={<CalendarClock size={18} className="text-mute" aria-hidden="true" />}>
          <QueryBlock q={cal} skeleton={<Skeleton className="h-56" />}>{(s) => <CalendarCard s={s} />}</QueryBlock>
        </Panel>
      </div>
      <p className="mt-6 flex items-center gap-2 text-xs text-mute"><Workflow size={14} aria-hidden="true" /> Para agendar um lead, abra o lead no funil e use “Agendar reunião”.</p>
    </>
  );
}
