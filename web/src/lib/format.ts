const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const int = new Intl.NumberFormat("pt-BR");

export const money = (v: number) => brl.format(v);
export const num = (v: number) => int.format(v);
export const pct = (v: number) =>
  `${(v * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
export const ratio = (a: number, b: number) => (b === 0 ? 0 : a / b);
export const perUnit = (total: number, count: number) => (count === 0 ? null : total / count);

const rtf = new Intl.RelativeTimeFormat("pt-BR", { numeric: "auto" });
export function relTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const s = Math.round((t - Date.now()) / 1000);
  const a = Math.abs(s);
  if (a < 60) return "agora";
  if (a < 3600) return rtf.format(Math.round(s / 60), "minute");
  if (a < 86400) return rtf.format(Math.round(s / 3600), "hour");
  return rtf.format(Math.round(s / 86400), "day");
}
export const dateTime = (iso: unknown): string => {
  if (typeof iso !== "string") return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
};
