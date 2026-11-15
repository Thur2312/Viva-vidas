"use client";
import { QueryBlock, Skeleton } from "@/components/Block";
import { Marginalia } from "@/components/folha";
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
  const notConnected = !!l && status !== "CONNECTED";
  return (
    <div className="space-y-4">
      {l && (
        <Marginalia
          items={[
            { label: "Qualidade", value: <QualityBadge q={l.qualityRating} />, sub: qualityHint(l.qualityRating) },
            { label: "Limite diário", value: l.dailyLimit != null ? num(l.dailyLimit) : TIER_LABEL[l.limitTier] ?? "Desconhecido", sub: `${TIER_LABEL[l.limitTier] ?? l.limitTier}. O teto do disparo nunca passa disto.` },
            { label: "Situação do número", value: notConnected ? "Não conectado" : "Conectado", tone: notConnected ? "warn" : "ok", sub: notConnected ? `Status: ${l.status ?? "?"}` : undefined },
          ]}
        />
      )}
      {!compact && l && (
        <div>
          <p className="font-mono text-[11px] font-medium uppercase tracking-wider text-mute">Últimos 14 dias</p>
          <div className="mt-1.5"><Sparkline points={h.history} /></div>
        </div>
      )}

      {miss && (
        <div role="status">
          <p className="text-sm font-medium">{miss.title}</p>
          <p className="mt-0.5 text-sm text-mute">{miss.text}</p>
        </div>
      )}

      {h.verdict.state === "block" && h.verdict.labels.length > 0 && (
        <div role="alert" className="text-sm">
          <p className="font-semibold text-bad">Disparos reais bloqueados</p>
          <ul className="mt-1 list-disc pl-5">{h.verdict.labels.map((t) => <li key={t}>{t}</li>)}</ul>
        </div>
      )}
      {h.verdict.state === "warn" && (
        <p role="status" className="text-sm"><span className="font-semibold text-warn">Atenção:</span> {h.verdict.labels.join("; ")}. Velocidade efetiva: {Math.round(h.verdict.rateFactor * 100)}%.</p>
      )}
      {l && <p className="text-xs text-mute">Última leitura: {dateTime(l.checkedAt)} ({relTime(l.checkedAt)}). Leitura a cada {h.pollEveryMinutes} minutos; sem leitura nova em 60 minutos, disparos em andamento são pausados.</p>}
    </div>
  );
}

/** Saúde do número: coluna de marginália na lista de Disparos e (versão compacta) no detalhe. */
export function NumberHealthCard({ compact = false, className = "" }: { compact?: boolean; className?: string }) {
  const q = useNumberHealth();
  return (
    <section aria-labelledby="saude-numero" className={className}>
      <h2 id="saude-numero" className="font-display text-xl leading-tight">Saúde do número</h2>
      <p className="mb-3 mt-1 text-xs text-mute">Qualidade e limite de mensagens informados pela Meta</p>
      <QueryBlock q={q} skeleton={<Skeleton className="h-28" />}>{(h) => <HealthBody h={h} compact={compact} />}</QueryBlock>
    </section>
  );
}
