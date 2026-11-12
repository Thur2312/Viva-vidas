"use client";
import { QueryBlock, Skeleton } from "@/components/Block";
import { Panel } from "@/components/ui";
import { dateTime, num, relTime } from "@/lib/format";
import { useNumberHealth, type HealthResp } from "./api";
import { QualityBadge, Sparkline, TIER_LABEL, qualityHint } from "./bits";

/** Por que não há leitura: estados honestos, sem valores inventados. */
function missingState(h: HealthResp): { title: string; text: string } | null {
  if (!h.chat.configured) return { title: "Chat não configurado", text: `Faltam ${h.chat.missing.join(" e ") || "CHAT_API_URL e CHAT_BRIDGE_KEY"}. Sem o chat, a qualidade do número não pode ser lida e nenhum envio real é liberado.` };
  if (h.lastError === "sem_permissao" || h.lastError === "token_expirado")
    return { title: "Sem permissão na Meta", text: h.lastError === "token_expirado" ? "O token do WhatsApp Business expirou. Gere um novo no Meta Business e atualize a conexão no chat." : "O token não tem permissão para ler o número (whatsapp_business_management). Ajuste as permissões no Meta Business." };
  if (h.lastError) return { title: "Leitura indisponível", text: `Não foi possível ler a qualidade agora (${h.lastError}). Sem leitura recente, disparos reais ficam bloqueados.` };
  if (!h.latest) return { title: "Aguardando número ativo", text: "Ainda não há nenhuma leitura. A leitura roda a cada 15 minutos quando o chat está configurado e o envio real está habilitado." };
  return null;
}

export function HealthBody({ h, compact = false }: { h: HealthResp; compact?: boolean }) {
  const miss = missingState(h);
  const l = h.latest;
  const status = (l?.status ?? "").toUpperCase();
  const notConnected = l && status !== "CONNECTED";
  return (
    <div className="space-y-4">
      {l ? (
        <div className="flex flex-wrap items-start gap-x-8 gap-y-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-mute">Qualidade</p>
            <div className="mt-1.5"><QualityBadge q={l.qualityRating} /></div>
            <p className="mt-1.5 max-w-[240px] text-xs text-mute">{qualityHint(l.qualityRating)}</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-mute">Limite diário</p>
            <p className="tabular mt-1.5 font-display text-xl font-semibold">{l.dailyLimit != null ? num(l.dailyLimit) : TIER_LABEL[l.limitTier] ?? "Desconhecido"}</p>
            <p className="text-xs text-mute">{TIER_LABEL[l.limitTier] ?? l.limitTier}. O teto do disparo nunca passa disto.</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-mute">Situação do número</p>
            <p className={`mt-1.5 text-sm font-semibold ${notConnected ? "text-warn" : "text-ok"}`}>{notConnected ? `Não conectado (${l.status ?? "?"})` : "Conectado"}</p>
          </div>
          {!compact && (
            <div className="min-w-[200px]">
              <p className="text-xs font-semibold uppercase tracking-wider text-mute">Últimos 14 dias</p>
              <div className="mt-1.5"><Sparkline points={h.history} /></div>
            </div>
          )}
        </div>
      ) : null}

      {miss && (
        <div role="status" className="rounded-lg border border-line bg-ink/[0.04] p-3">
          <p className="text-sm font-semibold">{miss.title}</p>
          <p className="mt-0.5 text-sm text-mute">{miss.text}</p>
        </div>
      )}

      {h.verdict.state === "block" && h.verdict.labels.length > 0 && (
        <div role="alert" className="rounded-lg border border-bad/40 bg-bad/10 p-3 text-sm">
          <p className="font-semibold text-bad">Disparos reais bloqueados</p>
          <ul className="mt-1 list-disc pl-5">{h.verdict.labels.map((t) => <li key={t}>{t}</li>)}</ul>
        </div>
      )}
      {h.verdict.state === "warn" && (
        <p role="status" className="rounded-lg border border-warn/40 bg-warn/10 p-3 text-sm">Atenção: {h.verdict.labels.join("; ")}. Velocidade efetiva: {Math.round(h.verdict.rateFactor * 100)}%.</p>
      )}
      {l && <p className="text-xs text-mute">Última leitura: {dateTime(l.checkedAt)} ({relTime(l.checkedAt)}). Leitura a cada {h.pollEveryMinutes} minutos; sem leitura nova em 60 minutos, disparos em andamento são pausados.</p>}
    </div>
  );
}

/** Cartão no topo da página de Disparos e (versão compacta) na revisão do assistente. */
export function NumberHealthCard({ compact = false }: { compact?: boolean }) {
  const q = useNumberHealth();
  return (
    <Panel title="Saúde do número" hint="Qualidade e limite de mensagens informados pela Meta" className="mb-6">
      <QueryBlock q={q} skeleton={<Skeleton className="h-28" />}>{(h) => <HealthBody h={h} compact={compact} />}</QueryBlock>
    </Panel>
  );
}
