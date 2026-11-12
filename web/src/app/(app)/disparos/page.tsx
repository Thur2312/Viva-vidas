"use client";

import { useState } from "react";
import { PageHeader } from "@/components/ui";
import { useMe } from "@/lib/hooks";
import { isManager, useBroadcasts, useNumberHealth } from "@/components/disparos/api";
import { AutoPausedBanner, SafetyBanner } from "@/components/disparos/Banners";
import { BroadcastList } from "@/components/disparos/BroadcastList";
import { NumberHealthCard } from "@/components/disparos/NumberHealthCard";
import { TemplatesTab } from "@/components/disparos/Templates";

export default function Disparos() {
  const me = useMe();
  const list = useBroadcasts();
  const health = useNumberHealth();
  const [tab, setTab] = useState<"disparos" | "modelos">("disparos");
  const manager = isManager(me.data?.role);
  const tabCls = (on: boolean) => `min-h-[44px] rounded-full border px-5 text-sm font-semibold ${on ? "border-brand bg-brand/15 text-brand-ink" : "border-line text-mute hover:bg-ink/5"}`;

  return (
    <>
      <PageHeader eyebrow="Disparos" title="Mensagens ativas por WhatsApp">
        Campanhas para quem já deu consentimento, com horário, velocidade e proteção da qualidade do número. Tudo começa em simulação.
      </PageHeader>

      <SafetyBanner safety={list.data?.safety} />
      <AutoPausedBanner items={health.data?.autoPaused ?? []} canResume={manager} />
      <NumberHealthCard />

      <div role="tablist" aria-label="Seções" className="mb-5 flex gap-2">
        <button role="tab" id="tab-d" aria-controls="panel-d" aria-selected={tab === "disparos"} type="button" className={tabCls(tab === "disparos")} onClick={() => setTab("disparos")}>Disparos</button>
        <button role="tab" id="tab-m" aria-controls="panel-m" aria-selected={tab === "modelos"} type="button" className={tabCls(tab === "modelos")} onClick={() => setTab("modelos")}>Modelos de mensagem</button>
      </div>
      <div role="tabpanel" id={tab === "disparos" ? "panel-d" : "panel-m"} aria-labelledby={tab === "disparos" ? "tab-d" : "tab-m"}>
        {tab === "disparos" ? <BroadcastList canCreate={manager} /> : <TemplatesTab role={me.data?.role} />}
      </div>
    </>
  );
}
