// Marca do painel: configuração, não código. A identidade ainda não foi atribuída a um cliente (docs/design-system.md).
// Trocar nome/rodapé por NEXT_PUBLIC_BRAND_* no .env, sem tocar nos componentes.
export const brand = {
  name: process.env.NEXT_PUBLIC_BRAND_NAME || "CRM do Agente",
  short: process.env.NEXT_PUBLIC_BRAND_SHORT || "CRM",
  tagline: "Funil, conversas e agenda em um só lugar",
  description: "CRM do agente comercial por IA: funil, conversas, disparos, voz e agenda",
  footer: process.env.NEXT_PUBLIC_BRAND_FOOTER || "CRM do agente comercial",
} as const;
