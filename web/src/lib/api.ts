// Cliente do backend, SOMENTE no servidor (route handlers). Bearer + refresh automático com single-flight.
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { AT, RT, clearSession, parseTokens, setSession, type Tokens } from "./session";

export class UpstreamError extends Error {
  constructor(public status: number, public code: string) {
    super(code);
  }
}

const baseUrl = () => process.env.API_URL?.replace(/\/+$/, "");

export async function rawFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const b = baseUrl();
  if (!b) throw new UpstreamError(503, "api_not_configured");
  try {
    return await fetch(b + path, { ...init, cache: "no-store", signal: AbortSignal.timeout(15_000) });
  } catch {
    throw new UpstreamError(502, "api_unreachable");
  }
}

// Refresh token é de uso único (rotativo). Chamadas simultâneas com o mesmo token
// compartilham a mesma promessa; o resultado fica 30 s em cache para requisições
// que chegaram com o cookie antigo antes de o navegador receber o novo.
// (Em memória: vale por instância do servidor.)
const inflight = new Map<string, Promise<Tokens | null>>();
const recent = new Map<string, { tokens: Tokens; at: number }>();

function refreshTokens(rt: string): Promise<Tokens | null> {
  const now = Date.now();
  recent.forEach((v, k) => {
    if (now - v.at > 30_000) recent.delete(k);
  });
  const hit = recent.get(rt);
  if (hit) return Promise.resolve(hit.tokens);
  let p = inflight.get(rt);
  if (!p) {
    p = (async () => {
      const res = await rawFetch("/panel-auth/refresh", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken: rt }),
      });
      if (res.status === 401 || res.status === 400 || res.status === 403) return null;
      if (!res.ok) throw new UpstreamError(502, "refresh_failed");
      const t = parseTokens(await res.json().catch(() => null));
      if (!t) throw new UpstreamError(502, "refresh_invalid");
      recent.set(rt, { tokens: t, at: Date.now() });
      return t;
    })().finally(() => inflight.delete(rt));
    inflight.set(rt, p);
  }
  return p;
}

export async function authedFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const jar = cookies();
  const at = jar.get(AT)?.value;
  const rt = jar.get(RT)?.value;
  if (!at && !rt) throw new UpstreamError(401, "unauthenticated");
  const attempt = (token: string) =>
    rawFetch(path, { ...init, headers: { ...(init.headers as Record<string, string>), authorization: `Bearer ${token}` } });

  if (at) {
    const r = await attempt(at);
    if (r.status !== 401) return r;
  }
  if (!rt) {
    clearSession();
    throw new UpstreamError(401, "session_expired");
  }
  const fresh = await refreshTokens(rt);
  if (!fresh) {
    clearSession();
    throw new UpstreamError(401, "session_expired");
  }
  setSession(fresh);
  const r2 = await attempt(fresh.accessToken);
  if (r2.status === 401) {
    clearSession();
    throw new UpstreamError(401, "session_expired");
  }
  return r2;
}

/** Envolve um handler: converte UpstreamError em JSON honesto, sem vazar detalhes. */
export async function guard(fn: () => Promise<NextResponse>): Promise<NextResponse> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof UpstreamError) return NextResponse.json({ error: e.code }, { status: e.status });
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}

/** Proteção extra contra CSRF em POST: Origin, quando presente, precisa ser o próprio host. */
export function sameOrigin(req: Request): boolean {
  const o = req.headers.get("origin");
  // Sem Origin (navegadores antigos ou clientes que não são navegador): só vale se o navegador declarar
  // que a requisição é do mesmo site. Mutação sem nenhuma das duas provas é recusada (defesa contra CSRF).
  if (!o) return req.headers.get("sec-fetch-site") === "same-origin";
  try {
    return new URL(o).host === req.headers.get("host");
  } catch {
    return false;
  }
}
