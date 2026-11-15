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

const SESSAO_TENTATIVAS = 3;
const esperar = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * 409 "session_busy": outra requisição acabou de renovar a sessão (o refresh token é de uso único) e o cookie novo já
 * está a caminho. O pedido ainda NÃO foi executado no servidor (o 409 nasce na renovação, antes da chamada), então repetir
 * é seguro, até para escrita. Só esse 409: os demais (horário ocupado, estado mudou) são respostas de negócio e NÃO se repetem.
 */
async function sessaoOcupada(res: Response): Promise<boolean> {
  if (res.status !== 409) return false;
  try {
    const j = await res.clone().json();
    return j?.error === "session_busy";
  } catch {
    return false;
  }
}

/** fetch que repete, com pausa crescente (0,6 s, 1,2 s), enquanto a sessão estiver "ocupada". Máximo de 3 tentativas. */
async function buscar(url: string, init: RequestInit): Promise<Response> {
  for (let tentativa = 1; ; tentativa++) {
    const res = await fetch(url, init);
    if (tentativa >= SESSAO_TENTATIVAS || !(await sessaoOcupada(res))) return res;
    await esperar(600 * tentativa);
    if (init.signal?.aborted) throw new DOMException("Aborted", "AbortError");
  }
}

export async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await buscar(url, { credentials: "same-origin", signal, headers: { accept: "application/json" } });
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

/** Erro de uma ação de escrita (POST/PATCH/PUT), com a mensagem já pronta para mostrar na tela. */
export class ActionError extends Error {
  constructor(public status: number, public code: string, public userMessage: string) {
    super(code);
  }
}

/** Textos de uma ação: sem rede, texto padrão, e traduções por status HTTP ou por código de erro do servidor. */
export type ActionMessages = {
  network: string;
  fallback: string;
  byStatus?: Record<number, string>;
  byCode?: Record<string, string>;
};

/**
 * Único ponto de escrita do painel no BFF (POST/PATCH/PUT). Lança ActionError; nunca inventa sucesso.
 * Mensagem mostrada, por prioridade: tradução por código > texto do servidor (o Nest manda texto ou lista) >
 * tradução por status > texto padrão. 401 leva ao login (`loginNext` volta para a página certa).
 */
export async function sendJson<T = unknown>(
  method: "POST" | "PATCH" | "PUT",
  url: string,
  body: unknown,
  msgs: ActionMessages,
  opts: { loginNext?: string } = {},
): Promise<T> {
  let res: Response;
  try {
    res = await buscar(url, {
      method,
      credentials: "same-origin",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body ?? {}),
    });
  } catch {
    throw new ActionError(0, "network", msgs.network);
  }
  if (res.status === 401) goLogin(opts.loginNext);
  if (!res.ok) {
    let code = `http_${res.status}`;
    let server = "";
    try {
      const j = await res.json();
      if (typeof j?.error === "string") code = j.error;
      if (typeof j?.message === "string") server = j.message;
      else if (Array.isArray(j?.message)) server = j.message.filter((m: unknown) => typeof m === "string").join(" ");
    } catch { /* corpo vazio */ }
    throw new ActionError(res.status, code, msgs.byCode?.[code] ?? (server || msgs.byStatus?.[res.status] || msgs.fallback));
  }
  return (await res.json().catch(() => ({}))) as T;
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
