import type { Metadata } from "next";
import Link from "next/link";
import { Wordmark } from "@/components/Brand";

export const metadata: Metadata = { title: "Privacidade · Horizon Agente" };

type Parties = { controlador?: string; operador?: string; encarregado?: string; contato?: string };

function Field({ label, value }: { label: string; value?: string }) {
  return (
    <div className="rounded-lg border border-line bg-card p-4">
      <dt className="text-xs font-semibold uppercase tracking-wider text-mute">{label}</dt>
      <dd className="mt-1 text-sm">{value || <span className="text-warn">A preencher (variável de ambiente ainda não definida)</span>}</dd>
    </div>
  );
}

function PrivacyText({ controlador, operador, encarregado, contato }: Parties) {
  return (
    <>
      <p className="mb-6 rounded-lg border border-warn/40 bg-warn/10 p-4 text-sm font-semibold text-warn">
        Texto a ser validado pelo jurídico. Esta página é um marcador e não substitui a política de privacidade oficial.
      </p>
      <dl className="mb-8 grid gap-3 sm:grid-cols-2">
        <Field label="Controlador" value={controlador} />
        <Field label="Operador" value={operador} />
        <Field label="Encarregado (DPO)" value={encarregado} />
        <Field label="Contato do encarregado" value={contato} />
      </dl>
      <section className="space-y-3 text-[15px]">
        <h2 className="font-display text-lg font-semibold">O que este painel mostra</h2>
        <p>Dados de leads atendidos pelo agente comercial durante o piloto: nome, telefone (parcialmente oculto), mensagens trocadas, etapa do funil e origem do anúncio.</p>
        <h2 className="pt-3 font-display text-lg font-semibold">Como tratamos esses dados</h2>
        <p>Texto a ser validado pelo jurídico: finalidades, bases legais, prazo de retenção, compartilhamento com operadores e direitos dos titulares (acesso, correção, exclusão e oposição).</p>
        <h2 className="pt-3 font-display text-lg font-semibold">Cuidados técnicos do painel</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>Sem rastreadores, analytics ou scripts de terceiros.</li>
          <li>A sessão fica em cookies protegidos (httpOnly), sem tokens no navegador.</li>
          <li>Telefones aparecem mascarados e há a opção “ocultar dados sensíveis”, ligada por padrão.</li>
        </ul>
      </section>
    </>
  );
}

export default function Privacidade() {
  return (
    <main className="h-screen overflow-y-auto">
      <div className="mx-auto max-w-2xl px-5 py-10">
        <Wordmark />
        <h1 className="mb-6 mt-8 font-display text-3xl font-semibold">Privacidade e dados pessoais</h1>
        <PrivacyText
          controlador={process.env.NEXT_PUBLIC_LGPD_CONTROLADOR}
          operador={process.env.NEXT_PUBLIC_LGPD_OPERADOR}
          encarregado={process.env.NEXT_PUBLIC_LGPD_ENCARREGADO}
          contato={process.env.NEXT_PUBLIC_LGPD_CONTATO}
        />
        <p className="mt-10">
          <Link href="/dashboard" className="inline-flex min-h-[44px] items-center underline underline-offset-2">Voltar ao painel</Link>
        </p>
      </div>
    </main>
  );
}
