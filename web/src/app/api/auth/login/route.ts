import { NextResponse } from "next/server";
import { UpstreamError, guard, rawFetch, sameOrigin } from "@/lib/api";
import { parseTokens, setSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export function POST(req: Request) {
  return guard(async () => {
    if (!sameOrigin(req)) throw new UpstreamError(403, "forbidden");
    const body = (await req.json().catch(() => null)) as { email?: unknown; password?: unknown } | null;
    if (!body || typeof body.email !== "string" || typeof body.password !== "string" || !body.email || !body.password) {
      throw new UpstreamError(400, "invalid_request");
    }
    const res = await rawFetch("/panel-auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: body.email.trim(), password: body.password }),
    });
    if (res.status === 401 || res.status === 400) throw new UpstreamError(401, "invalid_credentials");
    if (res.status === 429) throw new UpstreamError(429, "too_many_attempts");
    if (!res.ok) throw new UpstreamError(502, "login_failed");
    const j = await res.json().catch(() => null);
    const tokens = parseTokens(j);
    if (!tokens) throw new UpstreamError(502, "login_invalid_response");
    setSession(tokens);
    return NextResponse.json({ user: (j as { user?: unknown }).user ?? null });
  });
}
