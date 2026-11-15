import type { Estado } from "./agente-estados";

// Lógica pura da área de Disparos: o que a tela AFIRMA sobre o envio e sobre cada disparo.
// Regra: o interruptor desligado é o estado SEGURO padrão (cinza), não um alerta; e o que é simulado nunca é apresentado como enviado de verdade.

type Seguranca = { enabled: boolean; chat: { configured: boolean; missing: string[] } };

/** Estado do interruptor geral de envio. `estado` null = ainda lendo. */
export function estadoEnvio(s?: Seguranca): { estado: Estado | null; texto: string; aviso?: string } {
  if (s === undefined) return { estado: null, texto: "Verificando o interruptor geral de envio..." };
  const aviso = s.chat.configured
    ? undefined
    : `Chat não configurado (${s.chat.missing.join(", ") || "CHAT_API_URL, CHAT_BRIDGE_KEY"}): o envio real não é possível ainda. Nada foi testado com a Meta.`;
  if (s.enabled) {
    return { estado: { tom: "ok", rotulo: "Envio real ligado" }, texto: "Interruptor geral LIGADO: disparos reais podem sair, dentro das regras de envio.", aviso };
  }
  return {
    estado: { tom: "mute", rotulo: "Só simulação" },
    texto: "Interruptor geral DESLIGADO (BROADCASTS_ENABLED). Nenhuma mensagem real sai: só é possível criar e simular (dry-run).",
    aviso,
  };
}

type Contagens = Partial<Record<"pending" | "queued" | "sent" | "delivered" | "read" | "replied" | "failed" | "skipped", number>>;

/** "Enviado" é acumulado: quem foi entregue, lido ou respondeu também foi enviado. */
export const enviados = (c: Contagens) => (c.sent ?? 0) + (c.delivered ?? 0) + (c.read ?? 0) + (c.replied ?? 0);
export const naFila = (c: Contagens) => (c.pending ?? 0) + (c.queued ?? 0);

export type LinhaDisparo = { enviados: number; falhas: number; pulados: number; naFila: number; simulado: boolean; semDestinatarios: boolean };

/** Números de uma linha da lista. Sem destinatários (rascunho) não há números a mostrar. */
export function linhaDisparo(b: { counts: Contagens; total: number; dryRun: boolean }): LinhaDisparo {
  return {
    enviados: enviados(b.counts),
    falhas: b.counts.failed ?? 0,
    pulados: b.counts.skipped ?? 0,
    naFila: naFila(b.counts),
    simulado: b.dryRun,
    semDestinatarios: !(b.total > 0),
  };
}

type KpisEntrega = { sent: number; delivered: number; read: number };

export type LeituraEntrega = "simulacao" | "sem-retorno" | "medida";

/**
 * Como ler Entregues/Lidos. Zero NÃO é "ninguém recebeu": sem o webhook de entrega do chat o sistema nunca vê entrega nem leitura.
 * Simulação: nada foi enviado. Envio real com enviados > 0 e zero entregues e lidos: o chat não devolveu retorno (nunca mostrar 0).
 */
export function leituraEntrega(k: KpisEntrega, simulado: boolean): LeituraEntrega {
  if (simulado) return "simulacao";
  if (k.sent > 0 && k.delivered === 0 && k.read === 0) return "sem-retorno";
  return "medida";
}

export type MancheteDetalhe = { tipo: "vazio" | "simulado" | "respostas"; valor: number | null };

/** O número do topo do detalhe: respostas (envio real) ou o que SERIA enviado (simulação); sem destinatários não há número. */
export function mancheteDetalhe(k: { sent: number; replied: number }, simulado: boolean, total: number): MancheteDetalhe {
  if (!(total > 0)) return { tipo: "vazio", valor: null };
  return simulado ? { tipo: "simulado", valor: k.sent } : { tipo: "respostas", valor: k.replied };
}
