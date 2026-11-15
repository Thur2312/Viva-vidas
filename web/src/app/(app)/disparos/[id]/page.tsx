"use client";

import { useParams } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { Detail } from "@/components/disparos/Detail";
import { useMe } from "@/lib/hooks";

export default function DisparoDetalhe() {
  const { id } = useParams<{ id: string }>();
  const me = useMe();
  return (
    <>
      <PageHeader eyebrow="Disparos" title="Detalhe do disparo">Acompanhe envio, entrega, leitura, resposta e conversão. Os números são os registrados pelo sistema, sem estimativa.</PageHeader>
      <Detail id={id} role={me.data?.role} />
    </>
  );
}
