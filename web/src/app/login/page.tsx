import { Suspense } from "react";
import { Mark, Wordmark } from "@/components/Brand";
import { LoginForm } from "./LoginForm";

export default function Login() {
  return (
    <main className="grid h-screen overflow-y-auto lg:grid-cols-2">
      <section className="relative flex flex-col justify-between overflow-hidden bg-deep p-8 text-white sm:p-12">
        <Wordmark light />
        <Mark size={520} className="pointer-events-none absolute -bottom-24 -right-24 text-white/[0.07]" />
        <div className="relative max-w-md">
          <p className="mb-4 text-xs font-semibold uppercase tracking-[0.16em] text-brand">Piloto · Alberto Apolinário</p>
          <h1 className="font-display text-4xl font-semibold leading-[1.1] sm:text-5xl">
            Um agente que prospecta, qualifica e marca a reunião.
          </h1>
          <p className="mt-5 text-white/75">Acompanhe o funil e o que cada anúncio devolve, em um painel só.</p>
        </div>
        <p className="relative text-xs text-white/60">Horizon · Estratégia, tecnologia e crescimento empresarial</p>
      </section>

      <section className="flex items-center justify-center overflow-y-auto p-8">
        <Suspense fallback={null}>
          <LoginForm />
        </Suspense>
      </section>
    </main>
  );
}
