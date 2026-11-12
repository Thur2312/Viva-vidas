"use client";
import { Plus } from "lucide-react";
import { useState } from "react";
import { EmptyState, QueryBlock, Skeleton } from "@/components/Block";
import { Panel } from "@/components/ui";
import { dateTime } from "@/lib/format";
import { ActionError, act, isOwner, useAct, useTemplates, type DraftTemplate, type TemplateRow } from "./api";
import { btnGhost, btnPrimary, field } from "./bits";

const ST: Record<string, { label: string; tone: string }> = {
  APPROVED: { label: "Aprovado", tone: "border-ok/40 bg-ok/15 text-ok" },
  PENDING: { label: "Aguardando aprovação da Meta", tone: "border-warn/40 bg-warn/15 text-warn" },
  IN_APPEAL: { label: "Em recurso na Meta", tone: "border-warn/40 bg-warn/15 text-warn" },
  REJECTED: { label: "Reprovado", tone: "border-bad/40 bg-bad/10 text-bad" },
  PAUSED: { label: "Pausado pela Meta", tone: "border-bad/40 bg-bad/10 text-bad" },
  DISABLED: { label: "Desativado", tone: "border-bad/40 bg-bad/10 text-bad" },
  NAO_CRIADO: { label: "Ainda não criado na Meta", tone: "border-line bg-ink/[0.06] text-mute" },
};
const Badge = ({ s }: { s: string }) => {
  const x = ST[s] ?? { label: s, tone: "border-line bg-ink/[0.06] text-mute" };
  return <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${x.tone}`}>{x.label}</span>;
};
const CAT: Record<string, string> = { MARKETING: "Marketing", UTILITY: "Utilidade" };

function TemplateCard({ name, category, status, body, buttons, reason }: { name: string; category: string | null; status: string; body: string | null; buttons: { text: string }[]; reason?: string | null }) {
  return (
    <li className="rounded-xl border border-line bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-mono text-sm font-semibold">{name}</p>
        <div className="flex flex-wrap items-center gap-2">
          {category && <span className="rounded-full border border-line px-2.5 py-1 text-xs font-semibold text-mute">{CAT[category] ?? category}</span>}
          <Badge s={status} />
        </div>
      </div>
      {body && <p className="mt-3 whitespace-pre-wrap rounded-lg bg-ink/[0.05] p-3 text-sm">{body}</p>}
      {buttons.length > 0 && <p className="mt-2 text-xs text-mute">Botões: {buttons.map((b) => b.text).join(" · ")}</p>}
      {reason && <p className="mt-2 text-sm text-bad">Motivo da reprovação: {reason}</p>}
    </li>
  );
}

function CreateForm({ prefill, onDone }: { prefill?: DraftTemplate; onDone: () => void }) {
  const [name, setName] = useState(prefill?.name ?? "");
  const [category, setCategory] = useState<"MARKETING" | "UTILITY">(prefill?.category ?? "UTILITY");
  const [body, setBody] = useState(prefill?.bodyText ?? "");
  const [examples, setExamples] = useState((prefill?.bodyExamples ?? []).join("\n"));
  const [footer, setFooter] = useState("");
  const [quick, setQuick] = useState((prefill?.buttons ?? []).map((b) => b.text).join("\n"));
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const m = useAct((v: unknown) => act("POST", "templates", v));
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null); setOk(null);
    m.mutate(
      {
        name: name.trim(), category, bodyText: body, bodyExamples: examples.split("\n").map((s) => s.trim()).filter(Boolean),
        footerText: footer.trim() || undefined,
        buttons: quick.split("\n").map((s) => s.trim()).filter(Boolean).slice(0, 3).map((text) => ({ type: "QUICK_REPLY", text })),
      },
      { onSuccess: () => { setOk("Enviado à Meta. Agora aguarde a aprovação (pode levar de minutos a dias)."); onDone(); }, onError: (e2) => setErr(e2 instanceof ActionError ? e2.userMessage : "Falha ao criar.") },
    );
  };
  return (
    <form onSubmit={submit} className="space-y-4" aria-label="Criar template">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm font-semibold">Nome técnico
          <input className={`${field} mt-1 font-mono`} value={name} onChange={(e) => setName(e.target.value)} pattern="[a-z0-9_]+" maxLength={512} required aria-describedby="t-name" />
          <span id="t-name" className="mt-1 block text-xs font-normal text-mute">Minúsculas, números e sublinhado.</span>
        </label>
        <label className="block text-sm font-semibold">Categoria
          <select className={`${field} mt-1`} value={category} onChange={(e) => setCategory(e.target.value as "MARKETING" | "UTILITY")}>
            <option value="UTILITY">Utilidade (confirmações, lembretes de algo já combinado)</option>
            <option value="MARKETING">Marketing (retomada, oferta, convite)</option>
          </select>
        </label>
      </div>
      <label className="block text-sm font-semibold">Texto (use {"{{1}}"}, {"{{2}}"} para variáveis)
        <textarea className={`${field} mt-1 min-h-[110px] py-2`} value={body} onChange={(e) => setBody(e.target.value)} maxLength={1024} required />
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm font-semibold">Exemplos das variáveis (um por linha)
          <textarea className={`${field} mt-1 min-h-[88px] py-2`} value={examples} onChange={(e) => setExamples(e.target.value)} />
        </label>
        <label className="block text-sm font-semibold">Botões de resposta rápida (até 3, um por linha)
          <textarea className={`${field} mt-1 min-h-[88px] py-2`} value={quick} onChange={(e) => setQuick(e.target.value)} />
        </label>
      </div>
      <label className="block text-sm font-semibold">Rodapé (opcional, até 60 caracteres)
        <input className={`${field} mt-1`} value={footer} onChange={(e) => setFooter(e.target.value)} maxLength={60} />
      </label>
      {category === "MARKETING" && <p className="rounded-lg border border-brand/40 bg-brand/10 p-3 text-sm">Marketing exige aviso de saída: um botão de resposta rápida (ex.: &quot;Parar mensagens&quot;) ou, no texto, &quot;responda PARAR para sair&quot;. O servidor recusa sem isso.</p>}
      {err && <p role="alert" className="rounded-lg border border-bad/40 bg-bad/10 p-3 text-sm text-bad">{err}</p>}
      {ok && <p role="status" className="rounded-lg border border-ok/40 bg-ok/10 p-3 text-sm text-ok">{ok}</p>}
      <button type="submit" className={btnPrimary} disabled={m.isPending}>Enviar para aprovação da Meta</button>
    </form>
  );
}

export function TemplatesTab({ role }: { role?: string }) {
  const q = useTemplates();
  const [form, setForm] = useState<{ prefill?: DraftTemplate } | null>(null);
  const owner = isOwner(role);
  return (
    <QueryBlock q={q} skeleton={<Skeleton className="h-64" />}>
      {(t) => {
        const byName = new Set(t.data.map((x: TemplateRow) => x.name));
        return (
          <div className="space-y-6">
            {!t.chat.configured && (
              <p role="status" className="rounded-xl border border-warn/40 bg-warn/10 p-4 text-sm">
                <strong>Chat não configurado.</strong> Faltam {t.chat.missing.join(" e ") || "CHAT_API_URL e CHAT_BRIDGE_KEY"}. Sem o chat não dá para criar templates nem ver o status real na Meta; o que aparece abaixo vem só do que já foi sincronizado antes (nada, por enquanto).
              </p>
            )}
            {t.syncError && t.syncError !== "chat_nao_configurado" && <p role="alert" className="rounded-xl border border-bad/40 bg-bad/10 p-4 text-sm text-bad">Não foi possível sincronizar com a Meta agora ({t.syncError}). Mostrando o último status conhecido.</p>}
            <p className="text-sm text-mute">{t.syncedAt ? `Última sincronização: ${dateTime(t.syncedAt)}.` : "Nunca sincronizado."} A aprovação é da Meta; este painel não aprova nem acelera nada.</p>

            <Panel title="Modelos aprovados e em análise" hint="Status vindo da Meta, via chat">
              {t.data.length === 0 ? (
                <EmptyState title="Nenhum template sincronizado">Quando o chat estiver configurado e houver templates na conta do WhatsApp Business, eles aparecem aqui.</EmptyState>
              ) : (
                <ul className="grid gap-3 lg:grid-cols-2">
                  {t.data.map((x) => <TemplateCard key={`${x.name}-${x.language}`} name={x.name} category={x.category} status={x.status} body={x.bodyText} buttons={x.buttons} reason={x.rejectedReason} />)}
                </ul>
              )}
            </Panel>

            <Panel title="Os 5 modelos rascunhados" hint="Textos de docs/whatsapp-oficial.md, prontos para enviar à Meta">
              <ul className="grid gap-3 lg:grid-cols-2">
                {t.drafts.map((d) => (
                  <div key={d.name} className="space-y-2">
                    <TemplateCard name={d.name} category={d.category} status={d.state} body={d.bodyText} buttons={d.buttons} reason={d.rejectedReason} />
                    {d.state === "NAO_CRIADO" && !byName.has(d.name) && owner && t.chat.configured && (
                      <button type="button" className={btnGhost} onClick={() => setForm({ prefill: d })}>Criar este modelo...</button>
                    )}
                  </div>
                ))}
              </ul>
            </Panel>

            <Panel title="Criar novo template" hint={owner ? "Vai para análise da Meta" : "Somente o dono da conta cria templates"}
              action={owner && !form ? <button type="button" className={btnGhost} onClick={() => setForm({})}><Plus size={15} aria-hidden="true" />Novo template</button> : undefined}>
              {!owner ? <p className="text-sm text-mute">Seu perfil pode ver os templates, mas só o dono cria novos.</p>
                : !t.chat.configured ? <p className="text-sm text-mute">Disponível quando o chat estiver configurado.</p>
                : form ? <CreateForm key={form.prefill?.name ?? "novo"} prefill={form.prefill} onDone={() => q.refetch()} />
                : <p className="text-sm text-mute">Clique em &quot;Novo template&quot; ou escolha um dos rascunhos acima.</p>}
            </Panel>
          </div>
        );
      }}
    </QueryBlock>
  );
}
