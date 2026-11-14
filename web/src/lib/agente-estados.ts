import type { UseQueryResult } from "@tanstack/react-query";
import { TEMPLATE_STATUS } from "./template-status";

// Lógica pura da tela Agente: decide o que o painel AFIRMA sobre cada conexão e template.
// Regra: onde não há leitura (carregando ou falha), nunca se inventa um estado.

export type Tom = "ok" | "warn" | "mute";
export type Estado = { tom: Tom; rotulo: string; detalhe?: string };
export type Linha = { tom: string; rotulo: string; detalhe?: string };

export const TOM: Record<Tom, string> = {
  ok: "border-ok/40 bg-ok/15 text-ok",
  warn: "border-warn/40 bg-warn/15 text-warn",
  mute: "border-line bg-ink/[0.06] text-mute",
};
export const SEM_LEITURA: Estado = { tom: "mute", rotulo: "Sem leitura" };

/** Uma consulta vira estado: carregando (null), falha (sem leitura) ou o que `ler` decidir. */
export function leitura<T>(q: Pick<UseQueryResult<T>, "isPending" | "isError" | "data">, ler: (d: T) => Estado): Estado | null {
  if (q.isPending) return null;
  if (q.isError || q.data === undefined) return SEM_LEITURA;
  return ler(q.data);
}

export const faltando = (missing: string[]) => (missing.length ? `Falta: ${missing.join(", ")}` : undefined);

/** CRM e agenda: desligado (nada pedido), falta configurar (pedido, mas incompleto) ou ligado. */
export function estadoIntegracao(d: { enabled: boolean; configured: boolean; missing: string[] }, extra?: string): Estado {
  if (!d.enabled) return { tom: "mute", rotulo: "Desligado", detalhe: faltando(d.missing) };
  if (!d.configured) return { tom: "warn", rotulo: "Falta configurar", detalhe: faltando(d.missing) };
  return { tom: "ok", rotulo: "Ligado", detalhe: extra };
}

type TemplatesLidos = { chat: { configured: boolean }; data: { name: string; status: string; rejectedReason: string | null }[] };

/** Template planejado × o que a Meta realmente tem. null = carregando. */
export function estadoTemplate(nome: string, q: Pick<UseQueryResult<TemplatesLidos>, "isPending" | "isError" | "data">): Linha | null {
  if (q.isPending) return null;
  if (q.isError || !q.data) return { tom: TOM.mute, rotulo: "Sem leitura" };
  const real = q.data.data.find((t) => t.name === nome);
  if (real) {
    const x = TEMPLATE_STATUS[real.status];
    return { tom: x?.tone ?? TOM.mute, rotulo: x?.label ?? real.status, detalhe: real.status === "REJECTED" ? (real.rejectedReason ?? undefined) : undefined };
  }
  if (!q.data.chat.configured) return { tom: TOM.mute, rotulo: "Sem leitura: chat não configurado" };
  return { tom: TEMPLATE_STATUS.NAO_CRIADO.tone, rotulo: TEMPLATE_STATUS.NAO_CRIADO.label };
}
