"use client";
import { ArrowLeft, ArrowRight, Check, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Folio } from "@/components/folha";
import { num } from "@/lib/format";
import {
  ActionError, act, useNumberHealth, useTemplates,
  type AudienceFilter, type Preview, type VarSpec,
} from "./api";
import { btnPrimary, btnSec, field } from "./bits";
import { HealthBody } from "./NumberHealthCard";

const STEPS = ["Nome e objetivo", "Público", "Mensagem", "Agendamento", "Revisão"];
const STAGES = [
  ["contatado", "Contatado"], ["respondeu", "Respondeu"], ["qualificado", "Qualificado"], ["reuniao", "Reunião marcada"],
  ["compareceu", "Compareceu"], ["venda", "Venda"], ["perdido", "Perdido"],
] as const;
const DAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const SOURCES: [VarSpec["source"], string][] = [["lead.first_name", "Primeiro nome do lead"], ["lead.name", "Nome completo do lead"], ["custom", "Texto fixo"]];

const varCount = (body: string | null | undefined) => new Set(body?.match(/\{\{\d+\}\}/g) ?? []).size;

function useDebounced<T>(v: T, ms: number) {
  const [d, setD] = useState(v);
  useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t); }, [v, ms]);
  return d;
}

type State = {
  name: string; objective: string;
  stages: string[]; campaigns: string; scoreMin: string; scoreMax: string;
  template: string; language: string; vars: Record<string, VarSpec>;
  when: "now" | "scheduled"; scheduledAt: string; start: string; end: string; days: number[]; rate: number; cap: number; dry: boolean;
};
const INIT: State = {
  name: "", objective: "", stages: [], campaigns: "", scoreMin: "", scoreMax: "",
  template: "", language: "pt_BR", vars: {},
  when: "now", scheduledAt: "", start: "09:00", end: "18:00", days: [1, 2, 3, 4, 5], rate: 20, cap: 200, dry: true,
};

function audienceOf(s: State): AudienceFilter {
  const f: AudienceFilter = {};
  if (s.stages.length) f.stages = s.stages;
  const c = s.campaigns.split(",").map((x) => x.trim()).filter(Boolean);
  if (c.length) f.campaignIds = c;
  if (s.scoreMin !== "") f.scoreMin = Number(s.scoreMin);
  if (s.scoreMax !== "") f.scoreMax = Number(s.scoreMax);
  return f;
}

export function Wizard({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [s, setS] = useState<State>(INIT);
  const [id, setId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [pvErr, setPvErr] = useState<string | null>(null);
  const [pvBusy, setPvBusy] = useState(false);
  const [agree, setAgree] = useState(false);
  const [typed, setTyped] = useState("");
  const templates = useTemplates();
  const health = useNumberHealth();
  const set = <K extends keyof State>(k: K, v: State[K]) => setS((p) => ({ ...p, [k]: v }));

  const tpl = templates.data?.data.find((t) => t.name === s.template && t.language === s.language);
  const draft = templates.data?.drafts.find((d) => d.name === s.template);
  const body = tpl?.bodyText ?? draft?.bodyText ?? null;
  const category = tpl?.category ?? draft?.category ?? null;
  const status = tpl?.status ?? draft?.state ?? null;
  const approved = status === "APPROVED";
  const nVars = varCount(body);
  const realBlocked = !approved || !enabled || !health.data || health.data.verdict.state === "block";
  const dry = s.dry || realBlocked; // sem aprovação, sem interruptor ou com saúde ruim: só simulação

  // Variáveis padrão ao trocar de template
  useEffect(() => {
    if (!body) return;
    setS((p) => {
      const vars: Record<string, VarSpec> = {};
      for (let i = 1; i <= varCount(body); i++) vars[String(i)] = p.vars[String(i)] ?? { source: i === 1 ? "lead.first_name" : "custom", value: "" };
      return { ...p, vars };
    });
  }, [body]);

  const audienceKey = useDebounced(JSON.stringify([audienceOf(s), s.template, s.language, s.vars]), 500);
  const livePreview = step === 1 || step === 2 || step === 4;

  const patchBody = (st: State) => ({
    name: st.name.trim(), objective: st.objective.trim() || undefined, kind: "template", templateName: st.template || undefined, templateLanguage: st.language,
    variablesMap: st.vars, audienceFilter: audienceOf(st),
    scheduledAt: st.when === "scheduled" && st.scheduledAt ? new Date(st.scheduledAt).toISOString() : null,
    windowStart: st.start, windowEnd: st.end, windowDays: st.days, ratePerMinute: st.rate, dailyCap: st.cap, dryRun: st.dry || realBlocked,
  });

  // Prévia ao vivo (precisa do rascunho criado no passo 1)
  useEffect(() => {
    if (!id || !livePreview) return;
    let live = true;
    setPvBusy(true); setPvErr(null);
    act<Preview>("POST", `${id}/audience/preview`, {
      audienceFilter: audienceOf(s), kind: "template", templateName: s.template || undefined, templateLanguage: s.language, variablesMap: s.vars,
    }).then((p) => { if (live) setPreview(p); })
      .catch((e) => { if (live) { setPreview(null); setPvErr(e instanceof ActionError ? e.userMessage : "Não foi possível calcular o público."); } })
      .finally(() => { if (live) setPvBusy(false); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, livePreview, audienceKey]);

  const sample = useMemo(() => {
    if (!body) return null;
    return body.replace(/\{\{(\d+)\}\}/g, (_, d) => {
      const v = s.vars[d];
      if (!v) return `{{${d}}}`;
      if (v.source === "lead.name") return "Maria Souza";
      if (v.source === "lead.first_name") return "Maria";
      return v.value || `[texto ${d}]`;
    });
  }, [body, s.vars]);

  const valid = [
    s.name.trim().length >= 3,
    true,
    !!s.template && (nVars === 0 || Object.values(s.vars).every((v) => v.source !== "custom" || (v.value ?? "").trim())),
    s.days.length > 0 && s.start < s.end && s.rate >= 1 && s.cap >= 1 && (s.when === "now" || !!s.scheduledAt),
    true,
  ];

  const next = async () => {
    setError(null); setBusy(true);
    try {
      if (!id) {
        const r = await act<{ id: string }>("POST", "", patchBody(s));
        setId(r.id);
      } else if (step >= 1) {
        await act("PATCH", id, patchBody(s));
      }
      setStep((x) => Math.min(4, x + 1));
    } catch (e) {
      setError(e instanceof ActionError ? e.userMessage : "Não foi possível salvar o rascunho.");
    } finally { setBusy(false); }
  };

  const eligible = preview?.eligible ?? 0;
  const confirmOk = agree && preview !== null && eligible > 0 && typed.trim() === String(eligible);

  const launch = async () => {
    if (!id || !preview) return;
    setError(null); setBusy(true);
    try {
      await act("PATCH", id, patchBody(s));
      await act("POST", `${id}/start`, { confirm: true, expectedRecipients: preview.eligible });
      router.push(`/disparos/${id}`);
    } catch (e) {
      setError(e instanceof ActionError ? e.userMessage : "Não foi possível iniciar.");
      setBusy(false);
    }
  };

  const PreviewBox = () => (
    <div aria-live="polite" className="border-t border-line pt-5">
      <p className="text-xs font-semibold uppercase tracking-wider text-mute">Público elegível agora {pvBusy && <Loader2 size={12} className="ml-1 inline animate-spin" aria-hidden="true" />}</p>
      {pvErr ? <p role="alert" className="mt-1 text-sm text-bad">{pvErr}</p> : preview ? (
        <>
          <p className="tabular mt-1 font-mono text-3xl font-medium">{num(preview.eligible)} <span className="text-base font-normal text-mute">de {num(preview.total)} leads</span></p>
          {preview.reasons.length > 0 && (
            <ul className="mt-2 space-y-1 text-sm">
              {preview.reasons.map((r) => <li key={r.reason} className="flex justify-between gap-3"><span>{r.label}</span><span className="tabular font-semibold">{num(r.n)}</span></li>)}
            </ul>
          )}
          {preview.warnings.map((w) => <p key={w} className="mt-2 text-sm text-warn">{w}</p>)}
          <p className="mt-2 text-xs text-mute">Quem não tem opt-in de marketing ativo, pediu para sair, foi anonimizado ou recebeu marketing nos últimos 7 dias fica de fora automaticamente.</p>
        </>
      ) : <p className="mt-1 text-sm text-mute">{id ? "Calculando..." : "Salve o passo 1 para ver o público."}</p>}
    </div>
  );

  const toggleDay = (d: number) => set("days", s.days.includes(d) ? s.days.filter((x) => x !== d) : [...s.days, d].sort());

  return (
    <div className="space-y-6">
      <nav aria-label="Passos">
        <ol className="flex flex-wrap gap-x-6 gap-y-1 border-b border-line">
          {STEPS.map((t, i) => (
            <li key={t} aria-current={i === step ? "step" : undefined} className={`inline-flex min-h-[44px] items-center gap-1.5 border-b-2 text-sm ${i === step ? "border-brand-ink font-semibold text-ink" : i < step ? "border-transparent font-medium text-ok" : "border-transparent text-mute"}`}>
              {i < step && <Check size={14} aria-hidden="true" />}
              <span className="font-mono text-xs">{i + 1}</span> {t}
            </li>
          ))}
        </ol>
      </nav>

      {step === 0 && (
        <Folio n="Passo 1 de 5" className="!border-t-0 !pt-2" title="Nome e objetivo" hint="Só para a equipe se localizar. Não vai para o cliente.">
          <div className="max-w-2xl space-y-4">
            <label className="block text-sm font-semibold">Nome do disparo
              <input className={`${field} mt-1`} value={s.name} onChange={(e) => set("name", e.target.value)} maxLength={120} placeholder="Ex.: Retomada de leads de novembro" />
            </label>
            <label className="block text-sm font-semibold">Objetivo (opcional)
              <textarea className={`${field} mt-1 min-h-[88px] py-2`} value={s.objective} onChange={(e) => set("objective", e.target.value)} maxLength={500} />
            </label>
          </div>
        </Folio>
      )}

      {step === 1 && (
        <div className="grid gap-x-12 gap-y-10 lg:grid-cols-[1.4fr_1fr]">
          <Folio n="Passo 2 de 5" className="!border-t-0 !pt-2" title="Quem entra" hint="Filtros opcionais. As regras de consentimento são sempre aplicadas e não podem ser desligadas.">
            <div className="space-y-5">
              <fieldset>
                <legend className="text-sm font-semibold">Etapa do funil</legend>
                <div className="mt-2 flex flex-wrap gap-2">
                  {STAGES.map(([v, l]) => (
                    <label key={v} className={`inline-flex min-h-[44px] cursor-pointer items-center gap-2 rounded-full border px-4 text-sm ${s.stages.includes(v) ? "border-brand bg-brand/15 font-semibold" : "border-line"}`}>
                      <input type="checkbox" className="h-4 w-4" checked={s.stages.includes(v)} onChange={() => set("stages", s.stages.includes(v) ? s.stages.filter((x) => x !== v) : [...s.stages, v])} />
                      {l}
                    </label>
                  ))}
                </div>
                <p className="mt-1 text-xs text-mute">Sem seleção = todas as etapas.</p>
              </fieldset>
              <label className="block text-sm font-semibold">Campanha (ids separados por vírgula)
                <input className={`${field} mt-1`} value={s.campaigns} onChange={(e) => set("campaigns", e.target.value)} placeholder="Opcional" />
              </label>
              <div className="grid grid-cols-2 gap-4">
                <label className="block text-sm font-semibold">Score mínimo
                  <input className={`${field} mt-1`} type="number" min={0} max={100} value={s.scoreMin} onChange={(e) => set("scoreMin", e.target.value)} />
                </label>
                <label className="block text-sm font-semibold">Score máximo
                  <input className={`${field} mt-1`} type="number" min={0} max={100} value={s.scoreMax} onChange={(e) => set("scoreMax", e.target.value)} />
                </label>
              </div>
              <div className="rounded-lg border border-line p-3 text-sm">
                <p className="font-semibold">Consentimento (obrigatório, fixo)</p>
                <p className="mt-1 text-mute">Marketing: consentimento de marketing ativo com origem registrada. Utilidade: consentimento de atendimento ativo. Sempre fora: opt-out, anonimizados, telefone inválido.</p>
              </div>
            </div>
          </Folio>
          <PreviewBox />
        </div>
      )}

      {step === 2 && (
        <div className="grid gap-x-12 gap-y-10 lg:grid-cols-[1.4fr_1fr]">
          <Folio n="Passo 3 de 5" className="!border-t-0 !pt-2" title="Mensagem" hint="Só templates aprovados pela Meta enviam de verdade. Os demais servem para simulação.">
            <div className="space-y-5">
              {templates.isPending ? <p className="text-sm text-mute">Carregando templates...</p> : templates.isError ? <p role="alert" className="text-sm text-bad">Não foi possível carregar os templates.</p> : (
                <>
                  {!templates.data.chat.configured && <p role="status" className="rounded-lg border border-warn/40 bg-warn/10 p-3 text-sm">Chat não configurado: nenhum template aprovado está disponível. Você pode simular com os rascunhos.</p>}
                  <fieldset>
                    <legend className="text-sm font-semibold">Template</legend>
                    <div className="mt-2 space-y-2">
                      {[
                        ...templates.data.data.map((t) => ({ name: t.name, language: t.language, status: t.status, category: t.category })),
                        ...templates.data.drafts.filter((d) => d.state === "NAO_CRIADO").map((d) => ({ name: d.name, language: "pt_BR", status: "NAO_CRIADO", category: d.category })),
                      ].map((t) => (
                        <label key={`${t.name}-${t.language}`} className={`flex min-h-[44px] cursor-pointer items-center gap-3 rounded-lg border p-3 text-sm ${s.template === t.name ? "border-brand bg-brand/10" : "border-line"}`}>
                          <input type="radio" name="tpl" checked={s.template === t.name} onChange={() => { set("template", t.name); set("language", t.language); }} />
                          <span className="font-mono font-semibold">{t.name}</span>
                          <span className="text-xs text-mute">{t.category === "MARKETING" ? "Marketing" : "Utilidade"} · {t.status === "APPROVED" ? "Aprovado" : t.status === "NAO_CRIADO" ? "Só simulação (não criado na Meta)" : `${t.status}: só simulação`}</span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                  {nVars > 0 && (
                    <fieldset>
                      <legend className="text-sm font-semibold">Variáveis do texto</legend>
                      <div className="mt-2 space-y-3">
                        {Array.from({ length: nVars }, (_, i) => String(i + 1)).map((k) => {
                          const v = s.vars[k] ?? { source: "custom" as const, value: "" };
                          return (
                            <div key={k} className="grid items-end gap-3 sm:grid-cols-[auto_1fr_1fr]">
                              <span className="font-mono text-sm font-semibold sm:pb-3">{`{{${k}}}`}</span>
                              <label className="block text-xs font-semibold text-mute">Vem de
                                <select className={`${field} mt-1 text-ink`} value={v.source} onChange={(e) => set("vars", { ...s.vars, [k]: { ...v, source: e.target.value as VarSpec["source"] } })}>
                                  {SOURCES.map(([val, l]) => <option key={val} value={val}>{l}</option>)}
                                </select>
                              </label>
                              <label className="block text-xs font-semibold text-mute">{v.source === "custom" ? "Texto" : "Se o lead não tiver nome"}
                                <input className={`${field} mt-1 text-ink`} maxLength={60} value={(v.source === "custom" ? v.value : v.fallback) ?? ""}
                                  onChange={(e) => set("vars", { ...s.vars, [k]: v.source === "custom" ? { ...v, value: e.target.value } : { ...v, fallback: e.target.value } })} />
                              </label>
                            </div>
                          );
                        })}
                      </div>
                      <p className="mt-2 text-xs text-mute">Lead sem valor para a variável é pulado (nunca vai &quot;em branco&quot;).</p>
                    </fieldset>
                  )}
                </>
              )}
            </div>
          </Folio>
          <div className="space-y-4">
            <div className="border-t border-line pt-5">
              <p className="text-xs font-semibold uppercase tracking-wider text-mute">Como o lead vai ver (exemplo)</p>
              {sample ? <p className="mt-2 whitespace-pre-wrap rounded-2xl rounded-tl-sm bg-card p-3 text-sm shadow-sm">{sample}</p> : <p className="mt-2 text-sm text-mute">Escolha um template.</p>}
              {status && <p className="mt-2 text-xs text-mute">Status: {approved ? "aprovado, pode enviar de verdade" : "ainda não aprovado: apenas simulação"}.</p>}
            </div>
            <PreviewBox />
          </div>
        </div>
      )}

      {step === 3 && (
        <Folio n="Passo 4 de 5" className="!border-t-0 !pt-2" title="Agendamento e limites" hint="Mais devagar é mais seguro para a qualidade do número.">
          <div className="max-w-2xl space-y-5">
            <fieldset>
              <legend className="text-sm font-semibold">Quando</legend>
              <div className="mt-2 flex flex-wrap gap-3">
                {(["now", "scheduled"] as const).map((w) => (
                  <label key={w} className={`inline-flex min-h-[44px] cursor-pointer items-center gap-2 rounded-full border px-4 text-sm ${s.when === w ? "border-brand bg-brand/15 font-semibold" : "border-line"}`}>
                    <input type="radio" name="when" checked={s.when === w} onChange={() => set("when", w)} />{w === "now" ? "Começar assim que iniciar" : "Agendar"}
                  </label>
                ))}
              </div>
              {s.when === "scheduled" && <label className="mt-3 block text-sm font-semibold">Data e hora<input type="datetime-local" className={`${field} mt-1 max-w-xs`} value={s.scheduledAt} onChange={(e) => set("scheduledAt", e.target.value)} /></label>}
            </fieldset>
            <fieldset>
              <legend className="text-sm font-semibold">Janela de envio (horário de Brasília)</legend>
              <div className="mt-2 flex flex-wrap items-end gap-4">
                <label className="text-xs font-semibold text-mute">Das<input type="time" className={`${field} mt-1 w-32 text-ink`} value={s.start} onChange={(e) => set("start", e.target.value)} /></label>
                <label className="text-xs font-semibold text-mute">Até<input type="time" className={`${field} mt-1 w-32 text-ink`} value={s.end} onChange={(e) => set("end", e.target.value)} /></label>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {DAYS.map((d, i) => (
                  <label key={d} className={`inline-flex min-h-[44px] min-w-[44px] cursor-pointer items-center justify-center rounded-full border px-3 text-sm ${s.days.includes(i) ? "border-brand bg-brand/15 font-semibold" : "border-line"}`}>
                    <input type="checkbox" className="sr-only" checked={s.days.includes(i)} onChange={() => toggleDay(i)} />{d}
                  </label>
                ))}
              </div>
              <p className="mt-2 text-xs text-mute">Padrão: 9h às 18h, segunda a sexta. Confirmar com o jurídico e a regra da Anatel antes de mudar. Fora da janela nada é enviado.</p>
              {s.start >= s.end && <p role="alert" className="mt-1 text-sm text-bad">O início precisa ser antes do fim.</p>}
            </fieldset>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block text-sm font-semibold">Mensagens por minuto (máx. 60)
                <input type="number" min={1} max={60} className={`${field} mt-1`} value={s.rate} onChange={(e) => set("rate", Math.max(1, Math.min(60, Number(e.target.value) || 1)))} />
              </label>
              <label className="block text-sm font-semibold">Teto por dia
                <input type="number" min={1} max={1000} className={`${field} mt-1`} value={s.cap} onChange={(e) => set("cap", Math.max(1, Math.min(1000, Number(e.target.value) || 1)))} />
              </label>
            </div>
            {health.data?.latest?.dailyLimit != null && <p className="text-xs text-mute">O limite real do número é de {num(health.data.latest.dailyLimit)} por dia: o teto efetivo nunca passa disso.</p>}
            <div className="rounded-lg border border-brand/40 bg-brand/10 p-4">
              <label className="flex min-h-[44px] cursor-pointer items-start gap-3 text-sm">
                <input type="checkbox" className="mt-1 h-5 w-5" checked={dry} disabled={realBlocked} onChange={(e) => set("dry", e.target.checked)} />
                <span><strong>Simulação (dry-run)</strong>: registra o que SERIA enviado, sem chamar o WhatsApp. Ligada por padrão.
                  {realBlocked && <span className="mt-1 block text-warn">Obrigatória agora: {!enabled ? "o interruptor geral de envio está desligado" : !approved ? "o template não está aprovado" : health.data?.verdict.state === "block" ? "a saúde do número bloqueia envios reais" : "faltam dados de saúde do número"}.</span>}
                </span>
              </label>
            </div>
          </div>
        </Folio>
      )}

      {step === 4 && (
        <div className="grid gap-x-12 gap-y-10 lg:grid-cols-[1.3fr_1fr]">
          <Folio n="Passo 5 de 5" className="!border-t-0 !pt-2" title="Revisão" hint="Confira tudo. Depois de iniciar, só dá para pausar ou cancelar.">
            <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              <div><dt className="text-xs font-semibold uppercase tracking-wider text-mute">Nome</dt><dd className="font-semibold">{s.name}</dd></div>
              <div><dt className="text-xs font-semibold uppercase tracking-wider text-mute">Modo</dt><dd className="font-semibold">{dry ? "SIMULAÇÃO (nada é enviado)" : "ENVIO REAL"}</dd></div>
              <div><dt className="text-xs font-semibold uppercase tracking-wider text-mute">Template</dt><dd className="font-mono">{s.template} ({category === "MARKETING" ? "marketing" : "utilidade"})</dd></div>
              <div><dt className="text-xs font-semibold uppercase tracking-wider text-mute">Quando</dt><dd>{s.when === "now" ? "Ao iniciar" : new Date(s.scheduledAt).toLocaleString("pt-BR")}</dd></div>
              <div><dt className="text-xs font-semibold uppercase tracking-wider text-mute">Janela</dt><dd>{s.start} às {s.end}, {s.days.map((d) => DAYS[d]).join(", ")}</dd></div>
              <div><dt className="text-xs font-semibold uppercase tracking-wider text-mute">Vazão</dt><dd>{s.rate}/min, teto {num(s.cap)}/dia</dd></div>
            </dl>
            {sample && <p className="mt-4 whitespace-pre-wrap rounded-lg bg-ink/[0.05] p-3 text-sm">{sample}</p>}
            <div className="mt-5"><PreviewBox /></div>
            <div className="mt-5 space-y-4 border-t border-line pt-5">
              <label className="flex min-h-[44px] cursor-pointer items-start gap-3 text-sm">
                <input type="checkbox" className="mt-1 h-5 w-5" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
                <span>Confirmo que os destinatários têm opt-in registrado, que o texto respeita as regras do WhatsApp e que quem pedir para sair não receberá mais nada.</span>
              </label>
              <label className="block text-sm font-semibold">Para confirmar, digite o número de destinatários ({preview ? num(eligible) : "..."})
                <input inputMode="numeric" className={`${field} mt-1 max-w-[180px]`} value={typed} onChange={(e) => setTyped(e.target.value)} aria-invalid={typed !== "" && typed.trim() !== String(eligible)} />
              </label>
              {preview && eligible === 0 && <p role="alert" className="text-sm text-bad">Nenhum destinatário elegível: ajuste o público.</p>}
            </div>
          </Folio>
          <section aria-labelledby="saude-wiz" className="border-t border-line pt-5">
            <h2 id="saude-wiz" className="font-display text-xl leading-tight">Saúde do número</h2>
            <p className="mb-3 mt-1 text-sm text-mute">Disparo real só com o número saudável</p>
            {health.data ? <HealthBody h={health.data} compact /> : <p className="text-sm text-mute">Carregando...</p>}
          </section>
        </div>
      )}

      {error && <p role="alert" className="rounded-lg border border-bad/40 bg-bad/10 p-3 text-sm text-bad">{error}</p>}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <button type="button" className={btnSec} onClick={() => (step === 0 ? router.push("/disparos") : setStep(step - 1))} disabled={busy}>
          <ArrowLeft size={16} aria-hidden="true" />{step === 0 ? "Cancelar" : "Voltar"}
        </button>
        {step < 4 ? (
          <button type="button" className={btnPrimary} disabled={!valid[step] || busy} onClick={next}>
            {busy && <Loader2 size={15} className="animate-spin" aria-hidden="true" />}Continuar<ArrowRight size={16} aria-hidden="true" />
          </button>
        ) : (
          <button type="button" className={btnPrimary} disabled={!confirmOk || busy} onClick={launch}>
            {busy && <Loader2 size={15} className="animate-spin" aria-hidden="true" />}{dry ? "Iniciar simulação" : "Iniciar disparo real"}
          </button>
        )}
      </div>
    </div>
  );
}
