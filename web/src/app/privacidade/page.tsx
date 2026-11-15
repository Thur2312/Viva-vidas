import type { Metadata } from "next";
import { brand } from "@/lib/brand";
import Link from "next/link";
import { Wordmark } from "@/components/Brand";

export const metadata: Metadata = { title: `Privacidade · ${brand.name}` };

type Parties = { controlador?: string; operador?: string; encarregado?: string; contato?: string };

function Field({ label, value }: { label: string; value?: string }) {
  return (
    <div className="grid gap-x-6 gap-y-1 py-3 sm:grid-cols-[200px_1fr]">
      <dt className="font-mono text-[11px] font-medium uppercase tracking-wider text-mute sm:pt-0.5">{label}</dt>
      <dd className="text-sm">{value || <span className="text-warn">A preencher (variável de ambiente ainda não definida)</span>}</dd>
    </div>
  );
}

function PrivacyText({ controlador, operador, encarregado, contato }: Parties) {
  return (
    <>
      <p role="note" className="mb-8 border-y border-warn/40 py-3 text-sm font-semibold text-warn">
        Texto a ser validado pelo jurídico. Esta página é um marcador e não substitui a política de privacidade oficial.
      </p>
      <h2 className="mb-1 font-display text-xl leading-tight"><span className="mr-3 text-xs font-semibold uppercase tracking-[0.08em] text-brand-ink">01</span>Quem trata os dados</h2>
      <dl className="mb-10 divide-y divide-line border-y border-line">
        <Field label="Controlador" value={controlador} />
        <Field label="Operador" value={operador} />
        <Field label="Encarregado (DPO)" value={encarregado} />
        <Field label="Contato do encarregado" value={contato} />
      </dl>
      <section className="space-y-3 text-[15px] leading-relaxed">
        <h2 className="font-display text-xl leading-tight"><span className="mr-3 text-xs font-semibold uppercase tracking-[0.08em] text-brand-ink">02</span>O que este painel mostra</h2>
        <p>Dados de leads atendidos pelo agente comercial durante o piloto: nome, telefone (parcialmente oculto), mensagens trocadas, etapa do funil e origem do anúncio.</p>
        <h2 className="border-t border-line pt-6 font-display text-xl leading-tight"><span className="mr-3 text-xs font-semibold uppercase tracking-[0.08em] text-brand-ink">03</span>Como tratamos esses dados</h2>
        <p>Texto a ser validado pelo jurídico: finalidades, bases legais, prazo de retenção, compartilhamento com operadores e direitos dos titulares (acesso, correção, exclusão e oposição).</p>
        <h2 className="border-t border-line pt-6 font-display text-xl leading-tight"><span className="mr-3 text-xs font-semibold uppercase tracking-[0.08em] text-brand-ink">04</span>Cuidados técnicos do painel</h2>
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
