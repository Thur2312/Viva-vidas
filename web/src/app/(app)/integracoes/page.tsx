"use client";

import { RefreshCw, Workflow } from "lucide-react";
import { EmptyState, QueryBlock, Skeleton } from "@/components/Block";
import { Folio, Marginalia } from "@/components/folha";
import { Selo } from "@/components/Selo";
import { PageHeader } from "@/components/ui";
import { isOwner } from "@/components/disparos/api";
import { useCalendarStatus, useCrmStatus, useRetryDead, useSlots, slotDay, slotHour, type CalendarStatus, type CrmStatus, type Slot } from "@/components/integracoes/api";
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
  return (
    <>
      <PageHeader eyebrow="Agente" title="Integrações">
        Pipedrive e Google Agenda: o que está ligado, o que falta configurar e o que ficou pendente.
      </PageHeader>

      <div className="grid gap-x-14 gap-y-12 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-12">
          <Folio n="01" title="Pipedrive (CRM)" hint="Cada etapa do funil vira um negócio no CRM do Alberto, por uma fila com nova tentativa.">
            <QueryBlock q={crm} skeleton={<Skeleton className="h-40" />}>{(s) => <CrmPanel s={s} owner={isOwner(me.data?.role)} />}</QueryBlock>
          </Folio>

          <Folio n="02" title="Google Agenda" hint="Horários livres da agenda do Alberto e agendamento direto pelo lead.">
            <QueryBlock q={cal} skeleton={<Skeleton className="h-40" />}>{(s) => <CalendarPanel s={s} />}</QueryBlock>
          </Folio>

          <p className="flex items-center gap-2 text-xs text-mute"><Workflow size={14} aria-hidden="true" /> Para agendar um lead, abra o lead no funil e use “Agendar reunião”.</p>
        </div>

        <aside className="min-w-0 space-y-10" aria-label="Números de apoio">
          <section aria-labelledby="fila-crm">
            <h2 id="fila-crm" className="mb-3 font-display text-xl leading-tight">Fila do CRM</h2>
            <QueryBlock q={crm} skeleton={<Skeleton className="h-40" />}>{(s) => <Marginalia items={contadoresCrm(s)} />}</QueryBlock>
            <p className="mt-3 text-xs text-mute">Só entram etapas qualificado, reunião, compareceu, venda, perdido e opt-out. Nunca conteúdo de mensagem.</p>
          </section>

          <section aria-labelledby="regras-agenda">
            <h2 id="regras-agenda" className="mb-3 font-display text-xl leading-tight">Regras da agenda</h2>
            <QueryBlock q={cal} skeleton={<Skeleton className="h-40" />}>
              {(s) => (
                <>
                  <Marginalia items={regrasAgenda(s.rules)} />
                  <p className="mt-3 text-xs text-mute">Ajustáveis no servidor, em <code className="font-mono">CALENDAR_RULES</code>.{!s.enabled && " Valem quando a agenda estiver ligada."}</p>
                </>
              )}
            </QueryBlock>
          </section>
        </aside>
      </div>
    </>
  );
}
