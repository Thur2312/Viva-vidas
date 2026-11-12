import { DEMO } from "./flags";

// Cliente do navegador: fala só com o BFF (/api/*). Nenhum token passa por aqui (cookies httpOnly).
export class ApiError extends Error {
  constructor(public status: number, public code: string) {
    super(code);
  }
}

let redirecting = false;
/**
 * Sessão inválida: volta ao login. No modo demonstração não existe sessão (o login não cria cookie), então um 401 só
 * significa "esta tela não tem dados de demonstração" e NÃO pode expulsar a pessoa do painel.
 */
export function goLogin(next?: string) {
  if (DEMO || redirecting || typeof window === "undefined") return;
  redirecting = true;
  const to = next ?? window.location.pathname + window.location.search;
  window.location.assign(`/login?next=${encodeURIComponent(to)}`);
}

export async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { credentials: "same-origin", signal, headers: { accept: "application/json" } });
  } catch (e) {
    if (signal?.aborted) throw e;
    throw new ApiError(0, "network");
  }
  if (res.status === 401) {
    goLogin();
    throw new ApiError(401, "unauthenticated");
  }
  if (!res.ok) {
    let code = `http_${res.status}`;
    try {
      const j = await res.json();
      if (j && typeof j.error === "string") code = j.error;
    } catch { /* corpo vazio */ }
    throw new ApiError(res.status, code);
  }
  return (await res.json()) as T;
}

export function describeError(e: unknown): { title: string; detail: string } {
  const err = e instanceof ApiError ? e : null;
  if (err?.code === "api_unreachable" || err?.code === "network" || err?.status === 502)
    return { title: "Sem conexão com o servidor do agente", detail: "Não conseguimos falar com o servidor agora. Os números não foram carregados, e nada aqui é estimado." };
  if (err?.code === "api_not_configured")
    return { title: "Painel sem servidor configurado", detail: "A variável API_URL não está definida no servidor do painel." };
  if (err?.status === 404) return { title: "Não encontrado", detail: "O servidor não reconhece este recurso." };
  return { title: "Não foi possível carregar", detail: `O servidor respondeu com erro${err ? ` (${err.code})` : ""}. Tente novamente.` };
}
