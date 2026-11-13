"use client";

import { Eye, EyeOff } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { DEMO } from "@/lib/flags";

const field = "min-h-[44px] w-full rounded-lg border bg-card px-3 text-sm";

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [show, setShow] = useState(false);
  const [caps, setCaps] = useState(false);
  const email = useRef<HTMLInputElement>(null);
  const password = useRef<HTMLInputElement>(null);
  const errId = useId();
  const capsId = useId();

  // Só caminhos internos: evita redirecionamento aberto.
  // Barra também "\" (alguns navegadores a tratam como "/", virando "//host") e caracteres de controle.
  const raw = params.get("next") ?? "";
  const safe = raw.startsWith("/") && !raw.startsWith("//") && !raw.startsWith("/login") && !/[\\\u0000-\u001f]/.test(raw);
  const next = safe ? raw : "/dashboard";

  useEffect(() => { email.current?.focus(); }, []);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (DEMO) return router.replace(next);
    setBusy(true);
    setError(null);
    const f = new FormData(e.currentTarget);
    let msg: string | null = null;
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: f.get("email"), password: f.get("password") }),
      });
      if (res.ok) {
        router.replace(next);
        router.refresh();
        return;
      }
      const j = await res.json().catch(() => ({}));
      if (res.status === 401 || res.status === 400) msg = "E-mail ou senha incorretos.";
      else if (res.status === 429) msg = "Muitas tentativas. Aguarde um pouco e tente de novo.";
      else if (j?.error === "api_not_configured") msg = "O painel ainda não está ligado ao servidor do agente.";
      else msg = "Não foi possível falar com o servidor agora. Tente novamente em instantes.";
    } catch {
      msg = "Sem conexão com o painel. Verifique sua internet.";
    } finally {
      setBusy(false);
    }
    if (msg) {
      setError(msg);
      // Devolve o foco ao campo mais provável do erro e limpa a senha digitada.
      if (password.current) { password.current.value = ""; password.current.focus(); }
    }
  }

  const invalid = error ? true : undefined;
  const describedBy = [error ? errId : "", caps ? capsId : ""].filter(Boolean).join(" ") || undefined;

  return (
    <form className="w-full" onSubmit={onSubmit} noValidate={false}>
      <h2 className="font-display text-2xl">Entrar</h2>
      <p className="mb-6 mt-1 text-sm text-mute">{DEMO ? "Modo de demonstração: sem senha." : "Use o acesso fornecido pela sua equipe."}</p>

      {error && (
        <p id={errId} role="alert" className="mb-4 rounded-lg border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">{error}</p>
      )}

      <label className="mb-1.5 block text-sm font-medium" htmlFor="email">E-mail</label>
      <input
        ref={email} id="email" name="email" type="email" required={!DEMO} autoComplete="username" inputMode="email" autoCapitalize="none" spellCheck={false}
        aria-invalid={invalid} aria-describedby={error ? errId : undefined}
        className={`${field} mb-4 ${error ? "border-bad" : "border-line"}`}
      />

      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <label className="text-sm font-medium" htmlFor="senha">Senha</label>
        <Link href="/esqueci-senha" className="text-sm font-medium text-brand-ink underline underline-offset-2">Esqueceu a senha?</Link>
      </div>
      <div className="relative">
        <input
          ref={password} id="senha" name="password" type={show ? "text" : "password"} required={!DEMO} autoComplete="current-password"
          aria-invalid={invalid} aria-describedby={describedBy}
          onKeyDown={(e) => setCaps(e.getModifierState("CapsLock"))}
          onKeyUp={(e) => setCaps(e.getModifierState("CapsLock"))}
          onBlur={() => setCaps(false)}
          className={`${field} pr-12 ${error ? "border-bad" : "border-line"}`}
        />
        <button
          type="button" onClick={() => setShow((v) => !v)} aria-pressed={show} aria-label={show ? "Ocultar senha" : "Mostrar senha"}
          className="absolute right-0 top-0 inline-flex h-11 w-11 items-center justify-center rounded-lg text-mute hover:text-ink"
        >
          {show ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
        </button>
      </div>
      {caps && <p id={capsId} role="status" className="mt-1.5 text-xs font-medium text-warn">O Caps Lock está ligado.</p>}

      <button type="submit" disabled={busy} className="mt-6 flex min-h-[48px] w-full items-center justify-center rounded-full bg-brand px-6 text-sm font-bold text-on-brand transition-colors hover:brightness-110 disabled:opacity-60">
        {busy ? "Entrando…" : "Entrar no painel"}
      </button>

      <p className="mt-6 text-xs text-mute">
        Veja como tratamos os dados neste painel na{" "}
        <Link href="/privacidade" className="underline underline-offset-2">página de privacidade</Link>.
      </p>
    </form>
  );
}
