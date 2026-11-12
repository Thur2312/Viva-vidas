"use client";
// POST para o BFF (conversas). Devolve a mensagem do servidor para explicar o bloqueio com honestidade.
export class SendError extends Error {
  constructor(public status: number, public code: string, public userMessage: string) {
    super(code);
  }
}

const FALLBACK: Record<number, string> = {
  400: "A mensagem não é válida (vazia ou acima de 4096 caracteres).",
  401: "Sua sessão expirou. Entre de novo.",
  403: "Seu perfil só pode ler conversas. Peça acesso de gerente para enviar.",
  404: "Esta conversa não foi encontrada.",
  429: "Muitos envios em pouco tempo. Aguarde um instante e tente de novo.",
};

export async function postMessage(conversationId: string, body: string): Promise<{ id: number | null; created_at: string }> {
  let res: Response;
  try {
    res = await fetch(`/api/pilot/conversations/${encodeURIComponent(conversationId)}/messages`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ body }),
    });
  } catch {
    throw new SendError(0, "network", "Sem conexão com o servidor. A mensagem não foi enviada.");
  }
  if (res.status === 401 && typeof window !== "undefined") {
    window.location.assign(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
  }
  if (!res.ok) {
    let code = `http_${res.status}`;
    let msg = "";
    try {
      const j = await res.json();
      if (typeof j?.error === "string") code = j.error;
      if (typeof j?.message === "string") msg = j.message;
    } catch { /* corpo vazio */ }
    throw new SendError(res.status, code, msg || FALLBACK[res.status] || "Não foi possível enviar a mensagem. Tente de novo.");
  }
  return res.json();
}
