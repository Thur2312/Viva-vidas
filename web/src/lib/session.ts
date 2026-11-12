// Cookies de sessão do painel. Servidor apenas: os tokens nunca chegam ao JS do navegador.
import { cookies } from "next/headers";

export const AT = "hz_at";
export const RT = "hz_rt";

export type Tokens = { accessToken: string; refreshToken: string; expiresIn: number };

/** expiresIn pode vir em segundos (número) ou como "15m", "1h". Padrão: 15 min. */
export function parseExpires(v: unknown): number {
  if (typeof v === "number" && v > 0) return Math.floor(v);
  if (typeof v === "string") {
    const m = /^(\d+)\s*([smhd])?$/.exec(v.trim());
    if (m) return Number(m[1]) * ({ s: 1, m: 60, h: 3600, d: 86400 } as Record<string, number>)[m[2] ?? "s"];
  }
  return 900;
}

export function parseTokens(j: unknown): Tokens | null {
  const o = j as Record<string, unknown> | null;
  if (!o || typeof o.accessToken !== "string" || typeof o.refreshToken !== "string") return null;
  return { accessToken: o.accessToken, refreshToken: o.refreshToken, expiresIn: parseExpires(o.expiresIn) };
}

function opts(maxAge: number) {
  return { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/", maxAge };
}

export async function setSession(t: Tokens) {
  const jar = await cookies();
  const days = Number(process.env.REFRESH_COOKIE_DAYS) || 14;
  jar.set(AT, t.accessToken, opts(Math.max(30, t.expiresIn - 10)));
  jar.set(RT, t.refreshToken, opts(60 * 60 * 24 * days));
}

export async function clearSession() {
  const jar = await cookies();
  jar.set(AT, "", opts(0));
  jar.set(RT, "", opts(0));
}
