"use client";

import { PageHeader } from "@/components/ui";
import { SafetyBanner } from "@/components/disparos/Banners";
import { isManager, useBroadcasts } from "@/components/disparos/api";
import { Wizard } from "@/components/disparos/Wizard";
import { useMe } from "@/lib/hooks";

export default function NovoDisparo() {
  const me = useMe();
  const list = useBroadcasts();
  const manager = isManager(me.data?.role);
  return (
    <>
      <PageHeader eyebrow="Disparos" title="Novo disparo">Cinco passos. O rascunho é salvo ao continuar e nada sai até a confirmação final.</PageHeader>
      <SafetyBanner safety={list.data?.safety} regras="abertas" />
      {me.isSuccess && !manager ? (
        <p role="alert" className="rounded-xl border border-warn/40 bg-warn/10 p-5 text-sm">Seu perfil não pode criar disparos. Peça acesso de gerente.</p>
      ) : (
        <Wizard enabled={!!list.data?.safety.enabled} />
      )}
    </>
  );
}
