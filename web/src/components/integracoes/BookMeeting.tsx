"use client";

import { CalendarPlus } from "lucide-react";
import { useId, useState } from "react";
import { isManager } from "@/components/disparos/api";
import { slotLabel, useBook, useCalendarStatus, useSlots } from "./api";
import { useMe } from "@/lib/hooks";

/**
 * "Agendar reunião" dentro do lead. Só aparece para manager/owner e só com a agenda ligada e configurada.
 * O servidor confere de novo que o horário está livre; se ficou ocupado, volta 409 e a lista é recarregada.
 */
export function BookMeeting({ leadId, blocked, alreadyBooked }: { leadId: string; blocked: boolean; alreadyBooked: boolean }) {
  const me = useMe();
  const cal = useCalendarStatus();
  const ready = !!cal.data?.enabled && !!cal.data?.configured && isManager(me.data?.role);
  const slots = useSlots(ready && !blocked && !alreadyBooked, 30);
  const book = useBook();
  const [start, setStart] = useState("");
  const id = useId();

  if (!ready) return null;
  const tz = slots.data?.timezone ?? cal.data!.rules.timezone;

  return (
    <section aria-labelledby={`${id}-t`}>
      <h3 id={`${id}-t`} className="mb-2 text-xs font-semibold uppercase tracking-wider text-mute">Agendar reunião</h3>
      {blocked ? (
        <p className="text-sm text-mute">Este lead pediu para não ser contatado. Não é possível agendar.</p>
      ) : alreadyBooked || book.isSuccess ? (
        <p role="status" className="text-sm text-ok">
          {book.isSuccess ? `Reunião marcada para ${slotLabel(book.data.start, tz)}. O evento foi criado na agenda do Alberto.` : "Este lead já tem reunião marcada."}
        </p>
      ) : (
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (start) book.mutate({ leadId, start }, { onError: (err) => { if ((err as { status?: number }).status === 409) slots.refetch(); } });
          }}
        >
          <label className="min-w-[200px] flex-1 text-sm">
            <span className="mb-1 block font-medium">Horário (fuso da agenda: {tz})</span>
            <select value={start} onChange={(e) => setStart(e.target.value)} disabled={slots.isPending || !slots.data?.slots.length} className="min-h-[44px] w-full rounded-lg border border-line bg-card px-3">
              <option value="">{slots.isPending ? "Carregando horários…" : slots.data?.slots.length ? "Escolha um horário" : "Sem horários livres"}</option>
              {slots.data?.slots.map((s) => <option key={s.start} value={s.start}>{slotLabel(s.start, tz)}</option>)}
            </select>
          </label>
          <button type="submit" disabled={!start || book.isPending} className="inline-flex min-h-[44px] items-center gap-2 rounded-full bg-brand px-5 text-sm font-semibold text-on-brand disabled:opacity-60">
            <CalendarPlus size={16} aria-hidden="true" />
            {book.isPending ? "Marcando…" : "Marcar"}
          </button>
          {slots.isError && <p role="alert" className="w-full text-sm text-bad">Não foi possível consultar a agenda agora.</p>}
          {book.isError && <p role="alert" className="w-full text-sm text-bad">{(book.error as { userMessage?: string }).userMessage ?? "Não foi possível marcar."}</p>}
        </form>
      )}
    </section>
  );
}
