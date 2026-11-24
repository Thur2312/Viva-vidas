"use client";

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CampoConfig } from "@/components/agente/CampoConfig";
import { useChaves } from "@/components/agente/chaves-api";
import { getJson } from "@/lib/client";

type Start = { ok: true; url: string; redirectUri: string } | { ok: false; error: string; missing: string[] };

const ERROS: Record<string, string> = {
  faltam_credenciais: "Preencha antes o Client ID e o Client Secret.",
  sem_url_publica: "Preencha antes o endereço público da API (https).",
  estado_invalido: "O pedido de conexão expirou. Clique em Conectar de novo.",
  negado: "A autorização foi negada no Google. Nada foi conectado.",
  sem_refresh_token: "O Google não devolveu a permissão permanente. Remova o acesso do app em myaccount.google.com/permissions e conecte de novo.",
  troca_falhou: "Não foi possível concluir a conexão. Confira o Client ID e o Client Secret.",
};

const botao = "inline-flex min-h-[44px] items-center rounded-lg bg-brand px-4 text-sm font-semibold text-on-brand hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-60";

/** Passo a passo para ligar a Google Agenda: campos, URL de retorno para o Google Cloud e o botão de autorizar. Só o dono. */
export function ConectarGoogle({ role }: { role?: string }) {
  const q = useChaves(role);
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const [copiado, setCopiado] = useState(false);

  // Volta do Google: ?google=ok | <motivo>
  useEffect(() => {
    const g = new URLSearchParams(window.location.search).get("google");
    if (!g) return;
    setMsg(g === "ok" ? { ok: true, t: "Google Agenda conectada." } : { ok: false, t: ERROS[g] ?? "Não foi possível conectar." });
    qc.invalidateQueries({ queryKey: ["calendar"] });
    qc.invalidateQueries({ queryKey: ["config-secrets"] });
    window.history.replaceState(null, "", window.location.pathname);
  }, [qc]);

  if (role !== "owner") return <p className="mt-4 text-sm text-mute">Só o dono do painel conecta a Google Agenda.</p>;

  const get = (n: string) => q.data?.find((c) => c.name === n);
  const ok = (n: string) => !!get(n)?.configured;
  const base = (get("API_PUBLIC_URL")?.value ?? "").replace(/\/+$/, "");
  const retorno = base ? `${base}/pilot/calendar/oauth/callback` : "";
  const passos: { n: string; titulo: string; nota?: string }[] = [
    { n: "API_PUBLIC_URL", titulo: "Endereço público da API", nota: "O mesmo que aparece no navegador para a API (https)." },
    { n: "GOOGLE_CLIENT_ID", titulo: "Client ID do Google" },
    { n: "GOOGLE_CLIENT_SECRET", titulo: "Client Secret do Google" },
    { n: "CALENDAR_PROVIDER", titulo: "Ligar a agenda (escolha google)" },
  ];
  const prontos = passos.every((p) => ok(p.n));

  async function conectar() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await getJson<Start>("/api/pilot/calendar/oauth/start");
      if (r.ok) window.location.assign(r.url);
      else setMsg({ ok: false, t: ERROS[r.error] ?? "Não foi possível iniciar a conexão." });
    } catch {
      setMsg({ ok: false, t: "Não foi possível iniciar a conexão. Tente de novo." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-6 max-w-xl border-t border-line pt-5">
      <p className="text-sm font-semibold">Conectar a Google Agenda</p>
      <ol className="mt-3 space-y-3 text-sm">
        {passos.map((p, i) => (
          <li key={p.n} className="flex flex-wrap items-baseline gap-x-2">
            <span className={ok(p.n) ? "text-ok" : "text-warn"} aria-hidden="true">{ok(p.n) ? "✓" : "•"}</span>
            <span>{i + 1}. {p.titulo}</span>
            <span className="text-mute">{ok(p.n) ? (get(p.n)?.secret === false && get(p.n)?.value ? get(p.n)?.value : "definido") : "pendente"}</span>
            <CampoConfig name={p.n} role={role} />
            {p.nota && !ok(p.n) && <span className="basis-full pl-5 text-mute">{p.nota}</span>}
          </li>
        ))}
      </ol>
      <div className="mt-4 text-sm">
        <p className="font-medium">No Google Cloud (Credenciais &gt; ID do cliente OAuth &gt; aplicativo da Web):</p>
        <p className="mt-1 text-mute">Ative a Google Calendar API e, em &quot;URIs de redirecionamento autorizados&quot;, cadastre exatamente:</p>
        {retorno ? (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 break-all border-y border-line py-1.5 font-mono text-[13px]">{retorno}</code>
            <button type="button" className="inline-flex min-h-[44px] items-center rounded-lg border border-line px-4 text-sm font-semibold hover:bg-ink/5" onClick={async () => { try { await navigator.clipboard.writeText(retorno); setCopiado(true); setTimeout(() => setCopiado(false), 2000); } catch { /* copie à mão */ } }}>
              {copiado ? "Copiado" : "Copiar"}
            </button>
          </div>
        ) : (
          <p className="mt-1 text-warn">Preencha o passo 1 para ver a URL de retorno.</p>
        )}
      </div>
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button type="button" className={botao} disabled={busy || !prontos} onClick={() => void conectar()}>
          {busy ? "Abrindo o Google…" : ok("GOOGLE_REFRESH_TOKEN") ? "Reconectar Google Agenda" : "Conectar Google Agenda"}
        </button>
        {ok("GOOGLE_REFRESH_TOKEN") && <span className="text-sm text-ok">Permissão do Google já guardada.</span>}
        {!prontos && <span className="text-sm text-mute">Complete os 4 passos acima.</span>}
      </div>
      {msg && <p role={msg.ok ? "status" : "alert"} className={`mt-3 text-sm ${msg.ok ? "text-ok" : "text-bad"}`}>{msg.t}</p>}
    </div>
  );
}
