// Marca do painel: configuração, não código. A identidade ainda não foi atribuída a um cliente (docs/design-system.md).
// Trocar nome/rodapé por NEXT_PUBLIC_BRAND_* no .env, sem tocar nos componentes.
export const brand = {
  name: process.env.NEXT_PUBLIC_BRAND_NAME || "CRM do Agente",
  short: process.env.NEXT_PUBLIC_BRAND_SHORT || "CRM",
  tagline: "Funil, conversas e agenda em um só lugar",
  description: "CRM do agente comercial por IA: funil, conversas, disparos, voz e agenda",
  footer: process.env.NEXT_PUBLIC_BRAND_FOOTER || "CRM do agente comercial",
  /** Como falar com quem administra o painel (opcional): e-mail, telefone ou nome. Aparece em "Esqueci a senha". */
  support: process.env.NEXT_PUBLIC_SUPPORT_CONTACT || "",
} as const;
