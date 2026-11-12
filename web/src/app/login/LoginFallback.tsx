// Mesma composição da cena 3D, em SVG estático: usada sem WebGL, em celular fraco e com prefers-reduced-motion.
export function LoginFallback({ className = "" }: { className?: string }) {
  const layers = [0, 1, 2, 3, 4];
  return (
    <svg viewBox="0 0 520 400" className={className} aria-hidden="true" fill="none" strokeLinejoin="round" preserveAspectRatio="xMidYMid meet">
      {layers.map((i) => {
        const y = 250 - i * 38;
        const top = i === 4;
        return (
          <g key={i} className="layer-breathe" style={{ animationDelay: `${i * 0.35}s` }}>
            <path d={`M260 ${y} 440 ${y + 62} 260 ${y + 124} 80 ${y + 62}Z`} fill="rgb(var(--menta) / 0.14)" stroke={top ? "rgb(var(--sinal))" : "rgb(var(--limao))"} strokeWidth={top ? 2.4 : 1.6} opacity={top ? 1 : 0.85} />
          </g>
        );
      })}
      <path d="M40 330H150l12-6 10 6h30l10-22 12 48 12-40 10 16h50l10-6 10 6H480" stroke="rgb(var(--sinal))" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}
