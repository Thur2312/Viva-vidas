import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { guard, rawFetch, sameOrigin } from "@/lib/api";
import { RT, clearSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export function POST(req: Request) {
  return guard(async () => {
    if (!sameOrigin(req)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    const rt = cookies().get(RT)?.value;
    if (rt) {
      // Melhor esforço: mesmo se a API estiver fora, a sessão local é encerrada.
      await rawFetch("/panel-auth/logout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken: rt }),
      }).catch(() => null);
    }
    clearSession();
    return new NextResponse(null, { status: 204 });
  });
}
