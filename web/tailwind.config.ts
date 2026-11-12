import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: "rgb(var(--brand) / <alpha-value>)",
        "brand-ink": "rgb(var(--brand-ink) / <alpha-value>)",
        deep: "rgb(var(--deep) / <alpha-value>)",
        paper: "rgb(var(--paper) / <alpha-value>)",
        card: "rgb(var(--card) / <alpha-value>)",
        line: "rgb(var(--line) / <alpha-value>)",
        ink: "rgb(var(--ink) / <alpha-value>)",
        mute: "rgb(var(--mute) / <alpha-value>)",
        ok: "rgb(var(--ok) / <alpha-value>)",
        warn: "rgb(var(--warn) / <alpha-value>)",
        bad: "rgb(var(--bad) / <alpha-value>)",
        "on-brand": "rgb(var(--on-brand) / <alpha-value>)",
        sinal: "rgb(var(--sinal) / <alpha-value>)",
        menta: "rgb(var(--menta) / <alpha-value>)",
        bubble: "rgb(var(--bubble) / <alpha-value>)",
        petroleo: "rgb(var(--petroleo) / <alpha-value>)",
        limao: "rgb(var(--limao) / <alpha-value>)",
        osso: "rgb(var(--osso) / <alpha-value>)",
      },
      // Cantos menos "bolha": dados e painéis quase secos, ação com 10px, pílula só onde já era pílula.
      borderRadius: { md: "4px", lg: "8px", xl: "6px" },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        // Mesma família da interface: "display" e "mono" são só nomes de papel (título e número), não fontes diferentes.
        display: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-sans)", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};
export default config;
