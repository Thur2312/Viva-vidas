"use client";
import { ActionError, sendJson, type ActionMessages } from "./client";

// POST para o BFF (conversas). Devolve a mensagem do servidor para explicar o bloqueio com honestidade.
// SendError e o mesmo ActionError de todas as acoes de escrita do painel (um unico tipo de erro).
export { ActionError as SendError };

const MESSAGES: ActionMessages = {
  network: "Sem conexão com o servidor. A mensagem não foi enviada.",
  fallback: "Não foi possível enviar a mensagem. Tente de novo.",
  byStatus: {
    400: "A mensagem não é válida (vazia ou acima de 4096 caracteres).",
    401: "Sua sessão expirou. Entre de novo.",
    403: "Seu perfil só pode ler conversas. Peça acesso de gerente para enviar.",
    404: "Esta conversa não foi encontrada.",
    429: "Muitos envios em pouco tempo. Aguarde um instante e tente de novo.",
  },
};

export function postMessage(conversationId: string, body: string): Promise<{ id: number | null; created_at: string }> {
  return sendJson("POST", `/api/pilot/conversations/${encodeURIComponent(conversationId)}/messages`, { body }, MESSAGES);
}
