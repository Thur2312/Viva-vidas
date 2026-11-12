"use client";

import { ArrowLeft, MessageSquare } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback } from "react";
import { RangePicker } from "@/components/RangePicker";
import { PageHeader } from "@/components/ui";
import { ConversationList } from "@/components/conversas/ConversationList";
import { ConversationMetrics } from "@/components/conversas/Metrics";
import { ConversationThread } from "@/components/conversas/Thread";
import { PrivacyToggle } from "@/components/conversas/common";
import { useConversations } from "@/lib/hooks";
import { useRangeState } from "@/lib/range";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function Inbox() {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  const raw = sp.get("c");
  const active = raw && UUID.test(raw) ? raw : null;

  const open = useCallback((id: string | null) => {
    router.replace(id ? `${path}?c=${encodeURIComponent(id)}` : path, { scroll: false });
  }, [router, path]);

  // Cabeçalho da conversa aberta: reaproveita a linha já carregada na lista, quando existir.
  const list = useConversations({}, { enabled: false, poll: false });
  const row = list.data?.pages.flatMap((p) => p.data).find((c) => c.id === active);

  return (
    <section aria-label="Caixa de entrada" className="rise grid h-[calc(100vh-9rem)] min-h-[520px] overflow-hidden rounded-xl border border-line bg-card lg:grid-cols-[minmax(300px,380px)_1fr]">
      {/* Mobile: lista e conversa são telas separadas. Desktop: lado a lado. */}
      <div className={`${active ? "hidden lg:flex" : "flex"} min-h-0 flex-col border-line lg:border-r`}>
        <ConversationList activeId={active} onOpen={open} />
      </div>
      <div className={`${active ? "flex" : "hidden lg:flex"} min-h-0 min-w-0 flex-col bg-paper`}>
        {active ? (
          <>
            <div className="flex items-center gap-1 border-b border-line bg-card px-2 py-2">
              <button type="button" onClick={() => open(null)} aria-label="Voltar para a lista de conversas" className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-mute hover:bg-ink/10 lg:hidden">
                <ArrowLeft size={20} aria-hidden="true" />
              </button>
              <div className="min-w-0 flex-1 px-1">
                <h2 className="truncate font-display text-base font-semibold">{row ? row.lead_name || "Sem nome" : "Conversa"}</h2>
                {row && <p className="tabular text-xs text-mute">{row.phone}</p>}
              </div>
              <PrivacyToggle />
            </div>
            <ConversationThread key={active} conversationId={active} />
          </>
        ) : (
          <div className="m-auto max-w-xs p-6 text-center text-mute">
            <MessageSquare size={30} className="mx-auto" aria-hidden="true" />
            <p className="mt-3 font-display text-lg font-semibold text-ink">Escolha uma conversa</p>
            <p className="mt-1 text-sm">As mensagens, os rascunhos do agente e o campo de resposta aparecem aqui.</p>
          </div>
        )}
      </div>
    </section>
  );
}

export default function ConversasPage() {
  const [range, setRange] = useRangeState("30d");
  return (
    <>
      <PageHeader eyebrow="Atendimento" title="Conversas">
        Acompanhe quem está esperando resposta, o que o agente sugeriu e como a equipe está atendendo.
      </PageHeader>
      <div className="mb-6"><RangePicker value={range} onChange={setRange} /></div>
      <ConversationMetrics range={range} />
      <h2 className="mb-3 mt-8 font-display text-lg font-semibold">Caixa de entrada</h2>
      <Suspense fallback={null}>
        <Inbox />
      </Suspense>
    </>
  );
}
