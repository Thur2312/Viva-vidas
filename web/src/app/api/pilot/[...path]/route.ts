import { NextResponse } from "next/server";
import { authedFetch, guard, sameOrigin, UpstreamError } from "@/lib/api";

export const dynamic = "force-dynamic";

const UUID = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
type Route = { re: RegExp; params: string[]; base?: string };

// Listas fechadas: o navegador só alcança estes endpoints do backend, com estes parâmetros.
// `base` padrão é /pilot; a voz vive em /voice.
const GET_ROUTES: Route[] = [
  { re: /^overview$/, params: ["from", "to"] },
  { re: /^leads$/, params: ["stage", "search", "campaignId", "page", "pageSize"] },
  { re: /^leads\/[A-Za-z0-9_-]{1,64}$/, params: [] },
  { re: /^campaigns$/, params: ["from", "to"] },
  { re: /^readiness$/, params: [] },
  { re: /^conversations$/, params: ["search", "mode", "status", "stage", "leadId", "page", "pageSize"] },
  { re: /^conversations\/stats$/, params: ["from", "to"] },
  { re: new RegExp(`^conversations/${UUID}/messages$`), params: ["before", "limit"] },
  { re: /^voice\/status$/, params: [], base: "/voice" },
  { re: /^voice\/calls$/, params: ["page", "pageSize", "status", "from", "to", "leadId"], base: "/voice" },
  { re: new RegExp(`^voice/calls/${UUID}$`), params: [], base: "/voice" },
  { re: /^voice\/settings$/, params: [], base: "/voice" },
  { re: /^broadcasts$/, params: [] },
  { re: /^broadcasts\/templates$/, params: ["refresh"] },
  { re: /^broadcasts\/number-health$/, params: [] },
  { re: /^crm\/status$/, params: [] },
  { re: /^whatsapp\/connection$/, params: [] },
  { re: /^calendar\/status$/, params: [] },
  { re: /^calendar\/slots$/, params: ["limit"] },
  { re: new RegExp(`^broadcasts/${UUID}$`), params: [] },
  { re: new RegExp(`^broadcasts/${UUID}/recipients$`), params: ["status", "page"] },
];

const POST_ROUTES: Route[] = [
  { re: new RegExp(`^conversations/${UUID}/messages$`), params: [] },
  { re: /^crm\/retry-dead$/, params: [] },
  { re: /^whatsapp\/connection\/start$/, params: [] },
  { re: /^calendar\/book$/, params: [] },
  { re: /^voice\/calls$/, params: [], base: "/voice" },
  { re: /^broadcasts$/, params: [] },
  { re: /^broadcasts\/templates$/, params: [] },
  { re: new RegExp(`^broadcasts/${UUID}/(audience/preview|start|pause|resume|cancel)$`), params: [] },
];

const PATCH_ROUTES: Route[] = [{ re: new RegExp(`^broadcasts/${UUID}$`), params: [] }];

// Só o dono altera a configuração de voz (o papel é conferido de novo no backend).
const PUT_ROUTES: Route[] = [{ re: /^voice\/settings$/, params: [], base: "/voice" }];

// voice/... -> /voice/...  |  demais -> /pilot/...
const target = (route: Route, path: string) => (route.base ? `${route.base}/${path.replace(/^voice\//, "")}` : `/pilot/${path}`);

export function GET(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  return guard(async () => {
    const path = (await ctx.params).path.join("/");
    const route = GET_ROUTES.find((r) => r.re.test(path));
    if (!route) throw new UpstreamError(404, "not_found");
    const src = new URL(req.url).searchParams;
    const q = new URLSearchParams();
    for (const k of route.params) {
      const v = src.get(k);
      if (v !== null && v !== "" && v.length <= 200) q.set(k, v);
    }
    const qs = q.toString();
    const res = await authedFetch(`${target(route, path)}${qs ? `?${qs}` : ""}`);
    if (!res.ok) throw new UpstreamError(res.status === 404 ? 404 : res.status >= 500 ? 502 : res.status, `upstream_${res.status}`);
    return NextResponse.json(await res.json(), { headers: { "cache-control": "no-store" } });
  });
}

const MAX_BODY = 8 * 1024;

type Method = "POST" | "PATCH" | "PUT";

const passthrough = (path: string, status: number) =>
  status === 422 || status === 503 || (path.startsWith("calendar/") && [400, 403, 404, 409, 502].includes(status)) || (path === "crm/retry-dead" && status === 403) || (path.startsWith("broadcasts") && [400, 403, 409].includes(status)) || (path === "voice/settings" && [400, 403].includes(status));

function mutate(method: Method, routes: Route[]) {
  return (req: Request, ctx: { params: Promise<{ path: string[] }> }) =>
    guard(async () => {
      const path = (await ctx.params).path.join("/");
      const route = routes.find((r) => r.re.test(path));
      if (!route) throw new UpstreamError(404, "not_found");
      if (!sameOrigin(req)) throw new UpstreamError(403, "forbidden_origin");
      const raw = await req.text();
      if (raw.length > MAX_BODY) throw new UpstreamError(413, "payload_too_large");
      let json: unknown;
      try {
        json = JSON.parse(raw || "{}");
      } catch {
        throw new UpstreamError(400, "invalid_json");
      }
      if (json === null || typeof json !== "object" || Array.isArray(json)) throw new UpstreamError(400, "invalid_json");

      const res = await authedFetch(target(route, path), {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(json),
      });
      if (res.ok) return NextResponse.json(await res.json().catch(() => ({})), { status: res.status, headers: { "cache-control": "no-store" } });

      // Bloqueios de negócio e "chat não configurado" voltam com código e mensagem em pt-BR do servidor,
      // para a tela explicar o motivo. Outros erros ficam genéricos.
      if (passthrough(path, res.status)) {
        const j = await res.json().catch(() => null);
        const code = typeof j?.code === "string" ? j.code : `upstream_${res.status}`;
        // O Nest devolve `message` como texto ou lista de textos (validação).
        const raw = Array.isArray(j?.message) ? j.message.join(" ") : j?.message;
        const message = typeof raw === "string" ? raw.slice(0, 300) : undefined;
        return NextResponse.json({ error: code, message }, { status: res.status, headers: { "cache-control": "no-store" } });
      }
      throw new UpstreamError(res.status >= 500 ? 502 : res.status, `upstream_${res.status}`);
    });
}

export const POST = mutate("POST", POST_ROUTES);
export const PATCH = mutate("PATCH", PATCH_ROUTES);
export const PUT = mutate("PUT", PUT_ROUTES);
