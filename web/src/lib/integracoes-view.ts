import { num } from "./format";

// Lógica pura da tela Integrações: o que ela AFIRMA sobre a fila do CRM e as regras da agenda.

export type Linha = { label: string; value: string; sub?: string; tone?: "ok" | "warn" | "bad" };

type Fila = { pending: number; processing: number; sent: number; skipped: number; dead: number };

/**
 * Contadores da fila do CRM. Com o CRM desligado nada é enfileirado: um "0" seria verdadeiro, mas SEM significado
 * (pareceria uma medição de "nenhum erro"). Por isso vira "—", com a explicação.
 */
export function contadoresCrm(s: { enabled: boolean; queue: Fila }): Linha[] {
  const q = s.queue;
  if (!s.enabled) {
    return [
      { label: "Na fila", value: "—", sub: "CRM desligado: nada é enfileirado" },
      { label: "Enviados", value: "—" },
      { label: "Ignorados", value: "—" },
      { label: "Com falha", value: "—" },
    ];
  }
  return [
    { label: "Na fila", value: num(q.pending + q.processing) },
    { label: "Enviados", value: num(q.sent) },
    { label: "Ignorados", value: num(q.skipped) },
    { label: "Com falha", value: num(q.dead), tone: q.dead > 0 ? "bad" : undefined },
  ];
}

const DIAS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

/** [1,2,3,4,5] => "seg a sex"; [0,6] => "dom, sáb". Ignora valores fora de 0 a 6 e repetições. */
export function diasLegivel(days: number[]): string {
  const d = [...new Set(days.filter((n) => Number.isInteger(n) && n >= 0 && n <= 6))].sort((a, b) => a - b);
  if (d.length === 0) return "nenhum";
  const contigua = d.every((n, i) => i === 0 || n === d[i - 1] + 1);
  if (d.length >= 3 && contigua) return `${DIAS[d[0]]} a ${DIAS[d[d.length - 1]]}`;
  return d.map((n) => DIAS[n]).join(", ");
}

/** 120 => "2 h"; 90 => "1,5 h"; 45 => "45 min". */
export function antecedencia(min: number): string {
  return min >= 60 ? `${String(Math.round((min / 60) * 10) / 10).replace(".", ",")} h` : `${min} min`;
}

type Regras = { timezone: string; days: number[]; start: string; end: string; durationMin: number; minNoticeMin: number; horizonDays: number };

export function regrasAgenda(r: Regras): Linha[] {
  return [
    { label: "Dias", value: diasLegivel(r.days) },
    { label: "Horário", value: `${r.start} às ${r.end}` },
    { label: "Duração", value: `${r.durationMin} min` },
    { label: "Antecedência mínima", value: antecedencia(r.minNoticeMin) },
    { label: "Horizonte", value: `${r.horizonDays} dias` },
    { label: "Fuso", value: r.timezone },
  ];
}
