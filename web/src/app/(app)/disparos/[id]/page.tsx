"use client";

import { useParams } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { AutoPausedBanner } from "@/components/disparos/Banners";
import { Detail } from "@/components/disparos/Detail";
import { NumberHealthCard } from "@/components/disparos/NumberHealthCard";
import { isManager, useNumberHealth } from "@/components/disparos/api";
import { useMe } from "@/lib/hooks";

export default function DisparoDetalhe() {
  const { id } = useParams<{ id: string }>();
  const me = useMe();
  const health = useNumberHealth();
  return (
    <>
      <PageHeader eyebrow="Disparos" title="Detalhe do disparo">Acompanhe envio, entrega, leitura, resposta e conversão. Os números são os registrados pelo sistema, sem estimativa.</PageHeader>
      <AutoPausedBanner items={health.data?.autoPaused ?? []} canResume={isManager(me.data?.role)} />
      <Detail id={id} role={me.data?.role} />
      <div className="mt-6"><NumberHealthCard compact /></div>
    </>
  );
}
