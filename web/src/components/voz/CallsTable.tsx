"use client";

import { ChevronLeft, ChevronRight, Mic, MicOff } from "lucide-react";
import { useState } from "react";
import { EmptyState, QueryBlock, Skeleton } from "@/components/Block";
import { Folio } from "@/components/folha";
import { dateTime, num } from "@/lib/format";
import { CallDrawer } from "./CallDrawer";
import { MicWave } from "./MicWave";
import { STATE_LABEL, STATE_TONE, TRANSCRIPT_LABEL, duration } from "./labels";
import { useCalls, type CallRow, type CallState } from "./voz-api";

const FILTERS: { v: string; label: string }[] = [
  { v: "", label: "Todos os estados" },
  ...(["completed", "no_answer", "busy", "failed", "canceled", "in_progress", "ringing", "queued"] as CallState[]).map((v) => ({ v, label: STATE_LABEL[v] })),
];

const th = "py-2 font-mono text-[11px] font-medium uppercase tracking-wider";
const secundario = "inline-flex min-h-[44px] items-center rounded-lg border border-line bg-card px-4 text-sm font-semibold hover:bg-ink/5";

function Table({ rows, onOpen }: { rows: CallRow[]; onOpen: (id: string) => void }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-left text-sm">
        <caption className="sr-only">Histórico de ligações, da mais recente para a mais antiga</caption>
        <thead>
          <tr className="border-b border-line text-mute">
            <th scope="col" className={`${th} pr-3`}>Lead</th>
            <th scope="col" className={`${th} pr-3`}>Estado</th>
            <th scope="col" className={`${th} pr-3`}>Quando</th>
            <th scope="col" className={`${th} pr-3`}>Duração</th>
            <th scope="col" className={`${th} pr-3`}>Gravação</th>
            <th scope="col" className={`${th} pr-3`}>Transcrição</th>
            <th scope="col" className={th}><span className="sr-only">Detalhes</span></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((c) => (
            <tr key={c.id}>
              <td className="py-2.5 pr-3">
                <p className="font-semibold leading-tight">{c.lead_name || "Sem nome"}</p>
                <p className="tabular text-xs text-mute">{c.phone_masked ?? ""}</p>
              </td>
              <td className="py-2.5 pr-3">
                <span className="inline-flex items-center gap-2">
                  {(c.status === "queued" || c.status === "ringing" || c.status === "in_progress") && <MicWave state={c.status} size={22} />}
                  <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${STATE_TONE[c.status]}`}>{STATE_LABEL[c.status]}</span>
                </span>
              </td>
              <td className="tabular py-2.5 pr-3 text-mute">{dateTime(c.requested_at)}</td>
              <td className="tabular py-2.5 pr-3 font-mono">{duration(c.duration_sec)}</td>
              <td className="py-2.5 pr-3">
                {c.has_recording ? (
                  <span className="inline-flex items-center gap-1.5 text-ok"><Mic size={15} aria-hidden="true" /> Guardada</span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 text-mute"><MicOff size={15} aria-hidden="true" /> Não</span>
                )}
              </td>
              <td className="py-2.5 pr-3 text-mute">{TRANSCRIPT_LABEL[c.transcript_status]}</td>
              <td className="py-1 text-right">
                <button
                  type="button"
                  onClick={() => onOpen(c.id)}
                  aria-haspopup="dialog"
                  aria-label={`Ver detalhes da ligação com ${c.lead_name || "lead sem nome"}`}
                  className={secundario}
                >
                  Detalhes
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Seção 01 da Voz: o histórico é a ferramenta de uso diário, por isso vem antes da configuração. */
export function CallsTable({ canSeeTranscript }: { canSeeTranscript: boolean }) {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const q = useCalls({ page, status });

  return (
    <Folio
      n="01"
      title="Histórico de ligações"
      hint="Telefones aparecem mascarados. Nenhum endereço de gravação é exposto nesta tela."
      action={
        <label className="flex items-center gap-2 text-sm">
          <span className="sr-only sm:not-sr-only text-mute">Estado</span>
          <select
            value={status}
            onChange={(e) => { setStatus(e.target.value); setPage(1); }}
            className="min-h-[44px] rounded-lg border border-line bg-card px-3 text-sm"
          >
            {FILTERS.map((f) => <option key={f.v} value={f.v}>{f.label}</option>)}
          </select>
        </label>
      }
    >
      <QueryBlock
        q={q}
        skeleton={<div className="space-y-2"><Skeleton className="h-12" /><Skeleton className="h-12" /><Skeleton className="h-12" /></div>}
        isEmpty={(d) => d.data.length === 0}
        empty={
          <EmptyState title={status ? "Nenhuma ligação com este estado" : "Ainda não há ligações"}>
            {status ? "Troque o filtro para ver as demais." : "Quando a telefonia estiver configurada e um gestor fizer a primeira ligação, ela aparece aqui."}
          </EmptyState>
        }
      >
        {(d) => (
          <>
            <Table rows={d.data} onOpen={setOpen} />
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-mute">
              <span className="tabular">{num(d.meta.totalItems)} ligação(ões) · página {d.meta.page} de {d.meta.totalPages}</span>
              <div className="flex gap-2">
                <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className={`${secundario} gap-1 disabled:opacity-40`}>
                  <ChevronLeft size={16} aria-hidden="true" /> Anterior
                </button>
                <button type="button" disabled={page >= d.meta.totalPages} onClick={() => setPage((p) => p + 1)} className={`${secundario} gap-1 disabled:opacity-40`}>
                  Próxima <ChevronRight size={16} aria-hidden="true" />
                </button>
              </div>
            </div>
          </>
        )}
      </QueryBlock>
      {open && <CallDrawer id={open} canSeeTranscript={canSeeTranscript} onClose={() => setOpen(null)} />}
    </Folio>
  );
}
