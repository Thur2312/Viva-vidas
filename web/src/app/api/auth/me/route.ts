import { NextResponse } from "next/server";
import { authedFetch, guard, UpstreamError } from "@/lib/api";

export const dynamic = "force-dynamic";

export function GET() {
  return guard(async () => {
    const res = await authedFetch("/panel-auth/me");
    if (!res.ok) throw new UpstreamError(res.status >= 500 ? 502 : res.status, "me_failed");
    const u = (await res.json()) as Record<string, unknown>;
    // Só o necessário para a interface.
    return NextResponse.json({ id: u.id, name: u.name, email: u.email, role: u.role });
  });
}
