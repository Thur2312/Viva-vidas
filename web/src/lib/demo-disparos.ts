// Adaptador de DEMONSTRAÇÃO da área de Disparos: só é chamado com NEXT_PUBLIC_DEMO=true. Dados FICTÍCIOS, coerentes entre si
// (as contagens somam o total; funil e indicadores saem das mesmas contagens; a pausa automática combina com a saúde do número).
import type { Broadcast, BroadcastDetail, BroadcastList, HealthResp, RStatus, Recipient, RecipientsPage, Safety, TemplatesResp } from "@/components/disparos/api";

const ago = (days: number, hour = 10, min = 0) => {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(hour, min, 0, 0);
  return d.toISOString();
};

export const DEMO_SAFETY: Safety = { enabled: true, chat: { configured: true, missing: [] }, globalDailyCap: 1000, note: "Demonstração" };

const base = (o: Partial<Broadcast> & Pick<Broadcast, "id" | "name" | "status" | "counts" | "total" | "progress" | "createdAt">): Broadcast => ({
  objective: null, kind: "template", templateName: "retomada_contato", templateLanguage: "pt_BR", templateCategory: "MARKETING", textBody: null,
  variablesMap: { "1": { source: "lead.first_name", fallback: "tudo bem" } }, audienceFilter: { stages: ["contatado", "respondeu"] }, scheduledAt: null,
  window: { start: "09:00", end: "18:00", days: [1, 2, 3, 4, 5], timezone: "America/Sao_Paulo" }, ratePerMinute: 20, dailyCap: 200, dryRun: true,
  expectedRecipients: null, pausedReason: null, startedAt: null, finishedAt: null, ...o,
});

// Cada `counts` soma exatamente `total`.
export const DEMO_BROADCASTS: Broadcast[] = [
  base({
    id: "b0000000-0000-4000-8000-000000000002", name: "Retomada de contato: lista quente", status: "running", dryRun: false, objective: "Reativar leads que responderam e sumiram",
    total: 200, progress: 50, counts: { replied: 6, read: 20, delivered: 40, sent: 24, failed: 2, skipped: 8, queued: 60, pending: 40 },
    createdAt: ago(1, 9, 12), startedAt: ago(1, 10, 0), expectedRecipients: 200,
  }),
  base({
    id: "b0000000-0000-4000-8000-000000000003", name: "Convite: conversa sobre reajuste do plano", status: "paused", pausedReason: "saude_numero", dryRun: false,
    total: 150, progress: 30, counts: { replied: 2, read: 8, delivered: 15, sent: 20, pending: 105 },
    createdAt: ago(3, 15, 40), startedAt: ago(2, 10, 5), expectedRecipients: 150,
  }),
  base({
    id: "b0000000-0000-4000-8000-000000000001", name: "Reativação PME (teste em simulação)", status: "completed", dryRun: true, objective: "Medir o público antes do envio real",
    total: 120, progress: 100, counts: { sent: 112, skipped: 8 }, createdAt: ago(6, 11, 30), startedAt: ago(6, 14, 0), finishedAt: ago(6, 14, 8), expectedRecipients: 120,
  }),
  base({
    id: "b0000000-0000-4000-8000-000000000004", name: "Lembrete de reunião da semana", status: "draft", kind: "template", templateName: "lembrete_reuniao", templateCategory: "UTILITY",
    audienceFilter: { stages: ["reuniao"] }, total: 0, progress: 0, counts: {}, createdAt: ago(0, 8, 20),
  }),
];

export async function demoBroadcastList(): Promise<BroadcastList> {
  return { data: DEMO_BROADCASTS, safety: DEMO_SAFETY };
}

const n = (b: Broadcast, ...ks: RStatus[]) => ks.reduce((s, k) => s + (b.counts[k] ?? 0), 0);

export async function demoBroadcastDetail(id: string): Promise<BroadcastDetail> {
  const b = DEMO_BROADCASTS.find((x) => x.id === id);
  if (!b) throw new Error("não encontrado");
  // Funil acumulado: quem foi lido também foi entregue e enviado.
  const sent = n(b, "sent", "delivered", "read", "replied");
  const delivered = n(b, "delivered", "read", "replied");
  const read = n(b, "read", "replied");
  const replied = n(b, "replied");
  const converted = b.id.endsWith("2") ? 1 : 0;
  const skipped = n(b, "skipped");
  return {
    broadcast: b,
    funnel: { sent, delivered, read, replied, converted },
    kpis: { sent, delivered, read, replied, converted, failed: n(b, "failed"), skipped, optOuts: b.id.endsWith("2") ? 1 : 0 },
    errors: n(b, "failed") ? [{ code: "131026", n: 1 }, { code: "131049", n: 1 }] : [],
    skipReasons: skipped
      ? [
          { reason: "sem_consentimento", label: "Sem consentimento de marketing ativo", n: Math.ceil(skipped / 2) },
          { reason: "frequencia_7d", label: "Já recebeu marketing nos últimos 7 dias", n: Math.floor(skipped / 2) },
        ]
      : [],
    safety: DEMO_SAFETY,
    simulated: b.dryRun,
  };
}

const NOMES = ["Ana", "Bruno", "Carla", "Diego", "Elisa", "Fábio", "Gabriela", "Hugo", "Iara", "João", "Karen", "Lucas", "Marina", "Nelson", "Olívia", "Paulo", "Quitéria", "Rafael", "Sônia", "Tiago"];

export async function demoRecipients(id: string, status: string, page: number): Promise<RecipientsPage> {
  const b = DEMO_BROADCASTS.find((x) => x.id === id);
  const order: RStatus[] = ["replied", "read", "delivered", "sent", "failed", "skipped", "queued", "pending"];
  const all: Recipient[] = [];
  let i = 0;
  for (const st of order) {
    for (let k = 0; k < (b?.counts[st] ?? 0); k++, i++) {
      const sentAt = ["pending", "queued", "skipped"].includes(st) ? null : ago(1, 10, (i * 3) % 60);
      all.push({
        id: i + 1, leadId: `demo-lead-${i + 1}`, firstName: NOMES[i % NOMES.length], phone: `(83) 9****-${String(1000 + ((i * 37) % 9000))}`, status: st,
        skipReason: st === "skipped" ? (k % 2 ? "frequencia_7d" : "sem_consentimento") : null,
        skipLabel: st === "skipped" ? (k % 2 ? "Já recebeu marketing nos últimos 7 dias" : "Sem consentimento de marketing ativo") : null,
        errorCode: st === "failed" ? "131026" : null, attempts: st === "pending" || st === "queued" ? 0 : 1,
        sentAt, deliveredAt: ["delivered", "read", "replied"].includes(st) ? sentAt : null, readAt: ["read", "replied"].includes(st) ? sentAt : null,
        repliedAt: st === "replied" ? sentAt : null, convertedAt: null,
      });
    }
  }
  const rows = status ? all.filter((r) => r.status === status) : all;
  const pageSize = 15;
  return { data: rows.slice((page - 1) * pageSize, page * pageSize), meta: { page, pageSize, totalItems: rows.length, totalPages: Math.max(1, Math.ceil(rows.length / pageSize)) } };
}

export async function demoHealth(): Promise<HealthResp> {
  const q = ["GREEN", "GREEN", "GREEN", "GREEN", "GREEN", "GREEN", "GREEN", "GREEN", "GREEN", "YELLOW", "GREEN", "YELLOW", "YELLOW", "YELLOW"] as const;
  return {
    chat: { configured: true, missing: [] },
    latest: { checkedAt: ago(0, new Date().getHours(), 0), qualityRating: "YELLOW", limitTier: "TIER_1K", dailyLimit: 1000, status: "CONNECTED", accountReviewStatus: "APPROVED" },
    history: q.map((r, i) => ({ checkedAt: ago(13 - i, 12), qualityRating: r, limitTier: "TIER_1K", dailyLimit: 1000, status: "CONNECTED" })),
    verdict: { state: "warn", reasons: ["quality_yellow"], labels: ["Qualidade amarela"], rateFactor: 0.5, dailyLimit: 1000 },
    lastError: null,
    autoPaused: [{ id: "b0000000-0000-4000-8000-000000000003", name: "Convite: conversa sobre reajuste do plano" }],
    pollEveryMinutes: 15,
  };
}

export async function demoTemplates(): Promise<TemplatesResp> {
  const row = (name: string, category: "UTILITY" | "MARKETING", status: string, rejectedReason: string | null = null) => ({
    name, language: "pt_BR", category, status, rejectedReason, bodyText: "Olá {{1}}, tudo bem? (texto de demonstração)", footerText: category === "MARKETING" ? "Responda PARAR para sair" : null,
    buttons: [], syncedAt: ago(0, 8, 0),
  });
  return {
    chat: { configured: true, missing: [] }, syncedAt: ago(0, 8, 0), syncError: null, drafts: [],
    data: [
      row("confirmacao_reuniao", "UTILITY", "APPROVED"),
      row("lembrete_reuniao", "UTILITY", "APPROVED"),
      row("remarcar_reuniao", "UTILITY", "PENDING"),
      row("retomada_contato", "MARKETING", "APPROVED"),
      row("abertura_contato_optin", "MARKETING", "REJECTED", "O texto parece promocional demais para a categoria escolhida."),
    ],
  };
}
