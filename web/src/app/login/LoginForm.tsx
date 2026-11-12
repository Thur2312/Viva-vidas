"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { DEMO } from "@/lib/flags";

const field = "mb-4 min-h-[44px] w-full rounded-lg border border-line bg-card px-3 text-sm";

export function LoginForm({ onAuthenticated }: { onAuthenticated?: () => Promise<void> }) {
  const router = useRouter();
  const params = useSearchParams();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Só caminhos internos: evita redirecionamento aberto.
  const raw = params.get("next") ?? "";
  const next = raw.startsWith("/") && !raw.startsWith("//") && !raw.startsWith("/login") ? raw : "/dashboard";

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (DEMO) {
      setBusy(true);
      await onAuthenticated?.(); // as camadas se abrem antes de entrar
      return router.replace(next);
    }
    setBusy(true);
    setError(null);
    const f = new FormData(e.currentTarget);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: f.get("email"), password: f.get("password") }),
      });
      if (res.ok) {
        await onAuthenticated?.();
        router.replace(next);
        router.refresh();
        return;
      }
      const j = await res.json().catch(() => ({}));
      if (res.status === 401 || res.status === 400) setError("E-mail ou senha incorretos.");
      else if (res.status === 429) setError("Muitas tentativas. Aguarde um pouco e tente de novo.");
      else if (j?.error === "api_not_configured") setError("O painel ainda não está ligado ao servidor do agente.");
      else setError("Não foi possível falar com o servidor agora. Tente novamente em instantes.");
    } catch {
      setError("Sem conexão com o painel. Verifique sua internet.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="w-full max-w-sm" onSubmit={onSubmit} noValidate={false}>
      <h2 className="font-display text-4xl">Entrar</h2>
      <p className="mb-6 mt-1 text-sm text-mute">{DEMO ? "Modo de demonstração: sem senha." : "Use o acesso fornecido pela sua equipe."}</p>
      <label className="mb-1.5 block text-sm font-medium" htmlFor="email">E-mail</label>
      <input id="email" name="email" type="email" required={!DEMO} autoComplete="username" className={field} />
      <label className="mb-1.5 block text-sm font-medium" htmlFor="senha">Senha</label>
      <input id="senha" name="password" type="password" required={!DEMO} autoComplete="current-password" className={`${field} mb-5`} />
      {error && (
        <p role="alert" className="mb-4 rounded-lg border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">{error}</p>
      )}
      <button type="submit" disabled={busy} className="flex min-h-[48px] w-full items-center justify-center rounded-full bg-brand px-6 text-sm font-bold text-on-brand transition-colors hover:brightness-110 disabled:opacity-60">
        {busy ? "Entrando…" : "Entrar no painel"}
      </button>
      <p className="mt-6 text-xs text-mute">
        Ao entrar você concorda com o tratamento de dados descrito na{" "}
        <a href="/privacidade" className="underline underline-offset-2">página de privacidade</a>.
      </p>
    </form>
  );
}
