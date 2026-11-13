import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Wordmark } from "@/components/Brand";
import { brand } from "@/lib/brand";

export const metadata: Metadata = { title: `Esqueci a senha · ${brand.name}`, robots: { index: false, follow: false } };

const STEPS = [
  "Fale com quem administra o acesso ao painel (o usuário com papel Dono) e informe o e-mail com que você entra.",
  "Essa pessoa define uma senha nova para você e a entrega por um canal seguro, nunca por e-mail ou mensagem aberta.",
  "Entre com a senha nova. Ao redefinir, as sessões antigas são encerradas em poucos segundos.",
];

/** Não existe recuperação por e-mail (o painel não envia e-mail): a senha é redefinida por quem administra o servidor. */
export default function EsqueciSenha() {
  return (
    <main className="grid min-h-screen place-items-center bg-paper px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-8 flex justify-center"><Wordmark compact /></div>
        <div className="rounded-md border border-line bg-card p-6 shadow-sm sm:p-8">
          <h1 className="font-display text-2xl">Esqueceu a senha?</h1>
          <p className="mt-2 text-sm text-mute">
            Por segurança, o painel não envia link de recuperação por e-mail. A senha só pode ser redefinida por quem administra o acesso.
          </p>

          <ol className="mt-6 space-y-4">
            {STEPS.map((s, i) => (
              <li key={s} className="flex gap-3 text-sm">
                <span className="tabular flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand/15 text-xs font-semibold text-brand-ink" aria-hidden="true">{i + 1}</span>
                <span>{s}</span>
              </li>
            ))}
          </ol>

          <p className="mt-6 rounded-lg bg-ink/5 p-3 text-sm text-mute">
            Conta bloqueada por várias tentativas erradas? Ela se libera sozinha em 15 minutos, ou na hora, quando a senha é redefinida.
          </p>

          {brand.support && (
            <p className="mt-4 text-sm">
              <span className="text-mute">Contato do administrador: </span>
              <strong className="font-semibold">{brand.support}</strong>
            </p>
          )}

          <Link href="/login" className="mt-6 inline-flex min-h-[44px] items-center gap-2 text-sm font-semibold text-brand-ink underline underline-offset-2">
            <ArrowLeft size={16} aria-hidden="true" />
            Voltar para o login
          </Link>
        </div>
      </div>
    </main>
  );
}
