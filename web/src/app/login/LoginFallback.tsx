// Mesma composição da cena 3D (o funil), em SVG estático: usada sem WebGL, em celular fraco e com prefers-reduced-motion.
const RINGS = 6;
const KEEP = [1, 0.7, 0.5, 0.7, 0.8, 0.7];
const CUM = KEEP.reduce<number[]>((a, k) => [...a, (a.at(-1) ?? 1) * k], []);
const R_TOP = 170;
const R_BOT = 26;
const CX = 260;
const radius = (t: number) => R_BOT + (R_TOP - R_BOT) * Math.pow(1 - t, 1.6);
const cy = (t: number) => 56 + t * 270;
// Math.pow/cos/sin podem diferir na última casa entre o Node (servidor) e o navegador: toda coordenada sai arredondada,
// senão a hidratação do React acusa diferença nos atributos do SVG.
const q = (n: number) => n.toFixed(1);
const alive = (t: number) => {
  const x = t * (RINGS - 1);
  const i = Math.floor(x);
  return CUM[i] + (CUM[Math.min(RINGS - 1, i + 1)] - CUM[i]) * (x - i);
};

// Pontos determinísticos (mesma imagem em toda renderização, sem hidratação divergente).
function dots() {
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const out: { x: number; y: number; r: number; c: string }[] = [];
  for (let i = 0; i < 420; i++) {
    const t = rnd(), a = rnd() * Math.PI * 2, s = rnd();
    if (s > alive(t)) continue;
    const rad = radius(t) * (0.72 + rnd() * 0.28);
    const c = t > 0.8 ? "rgb(var(--sinal))" : t > 0.35 ? "rgb(var(--limao))" : "rgb(var(--osso))";
    out.push({ x: CX + Math.cos(a) * rad, y: cy(t) + Math.sin(a) * rad * 0.28, r: 1.1 + t * 1.6, c });
  }
  return out;
}
const DOTS = dots();

export function LoginFallback({ className = "" }: { className?: string }) {
  const rings = Array.from({ length: RINGS }, (_, k) => k / (RINGS - 1));
  return (
    <svg viewBox="0 0 520 400" className={className} aria-hidden="true" fill="none" preserveAspectRatio="xMidYMid meet">
      {[-1, 1].map((side) => (
        <path key={side} d={rings.map((t, i) => `${i ? "L" : "M"}${q(CX + side * radius(t))} ${q(cy(t))}`).join(" ")} stroke="rgb(var(--limao))" strokeOpacity="0.18" strokeWidth="1" />
      ))}
      {rings.map((t, k) => (
        <ellipse key={k} cx={CX} cy={q(cy(t))} rx={q(radius(t))} ry={q(radius(t) * 0.28)} stroke={k === RINGS - 1 ? "rgb(var(--sinal))" : "rgb(var(--limao))"} strokeOpacity={k === RINGS - 1 ? 0.8 : 0.35} strokeWidth="1.2" />
      ))}
      {DOTS.map((p, i) => <circle key={i} cx={q(p.x)} cy={q(p.y)} r={p.r.toFixed(1)} fill={p.c} fillOpacity="0.85" />)}
    </svg>
  );
}
