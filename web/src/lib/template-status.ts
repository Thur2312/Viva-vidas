// Estados de um template do WhatsApp na Meta, com o texto em português e a cor. Uma só tradução, usada
// pela tela de Templates (Disparos) e pela tela Agente.
export const TEMPLATE_STATUS: Record<string, { label: string; tone: string }> = {
  APPROVED: { label: "Aprovado", tone: "border-ok/40 bg-ok/15 text-ok" },
  PENDING: { label: "Aguardando aprovação da Meta", tone: "border-warn/40 bg-warn/15 text-warn" },
  IN_APPEAL: { label: "Em recurso na Meta", tone: "border-warn/40 bg-warn/15 text-warn" },
  REJECTED: { label: "Reprovado", tone: "border-bad/40 bg-bad/10 text-bad" },
  PAUSED: { label: "Pausado pela Meta", tone: "border-bad/40 bg-bad/10 text-bad" },
  DISABLED: { label: "Desativado", tone: "border-bad/40 bg-bad/10 text-bad" },
  NAO_CRIADO: { label: "Ainda não criado na Meta", tone: "border-line bg-ink/[0.06] text-mute" },
};
