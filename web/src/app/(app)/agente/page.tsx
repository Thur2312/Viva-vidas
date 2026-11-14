"use client";

import Link from "next/link";
import { QueryBlock, Skeleton } from "@/components/Block";
import { useNumberHealth, useTemplatesCache } from "@/components/disparos/api";
import { Folio, Marginalia, type MarginItem } from "@/components/folha";
import { useCalendarStatus, useCrmStatus } from "@/components/integracoes/api";
import { PageHeader } from "@/components/ui";
import { useVoiceStatus } from "@/components/voz/voz-api";
import { SEM_LEITURA, TOM, estadoIntegracao, estadoTemplate, faltando, leitura, type Estado } from "@/lib/agente-estados";
import { pct } from "@/lib/format";
import { useReadiness } from "@/lib/hooks";
import { playbookRef } from "@/lib/playbook";
import { STAGE_META, toNum, type Stage } from "@/lib/types";

// Tela Agente no desenho "Prontuário": seções numeradas + marginália, sem cartões.
// Cada estado vem do servidor. Onde a leitura falha, aparece "Sem leitura": nunca um estado inventado.

type Conexao = { nome: string; ref?: string; href?: string; destino?: string; monitorada: boolean; estado: Estado | null };

const chip = "inline-flex shrink-0 rounded-full border px-2.5 py-1 text-xs font-semibold";

function Selo({ estado }: { estado: Estado | null }) {
  if (!estado) return <span className={`${chip} ${TOM.mute}`} aria-busy="true">Lendo…</span>;
  return <span className={`${chip} ${TOM[estado.tom]}`}>{estado.rotulo}</span>;
}

const th = "py-2 font-mono text-[11px] font-medium uppercase tracking-wider";

export default function Agente() {
  const rd = useReadiness();
  const crm = useCrmStatus();
  const agenda = useCalendarStatus();
  const voz = useVoiceStatus();
  const chat = useNumberHealth();
  const tpl = useTemplatesCache();

  const notaDe = (nome?: string) => playbookRef.ferramentas.find((f) => f.nome === nome)?.detalhe;

  const conexoes: Conexao[] = [
    {
      nome: "WhatsApp (chat)", ref: "WhatsApp (API oficial)", href: "/disparos", destino: "Disparos", monitorada: true,
      estado: leitura(chat, (h) =>
        !h.chat.configured ? { tom: "warn", rotulo: "Falta configurar", detalhe: faltando(h.chat.missing) }
        : h.lastError ? { tom: "warn", rotulo: "Configurado, última leitura falhou", detalhe: h.lastError }
        : { tom: "ok", rotulo: "Configurado" }),
    },
    {
      nome: "Pipedrive (CRM)", ref: "Pipedrive", href: "/integracoes", destino: "Integrações", monitorada: true,
      estado: leitura(crm, (d) => estadoIntegracao(d, d.queue.dead > 0 ? `${d.queue.dead} item(ns) com falha na fila` : undefined)),
    },
    {
      nome: "Google Agenda", ref: "Google Agenda", href: "/integracoes", destino: "Integrações", monitorada: true,
      estado: leitura(agenda, (d) => estadoIntegracao(d)),
    },
    {
      nome: "Telefonia (voz)", href: "/voz", destino: "Voz", monitorada: true,
      estado: leitura(voz, (v) =>
        v.telephony.ready ? { tom: "ok", rotulo: "Pronta" }
        : v.telephony.configured ? { tom: "warn", rotulo: "Configurada, ainda não pronta" }
        : { tom: "warn", rotulo: "Falta configurar", detalhe: faltando(v.telephony.missing) }),
    },
    {
      nome: "Provedor de IA (modo sombra)",
      monitorada: true,
      estado: leitura(rd, (r) =>
        r.shadow.enabled ? { tom: "ok", rotulo: "Ativo", detalhe: r.shadow.mode ? `modo ${r.shadow.mode}` : undefined }
        : { tom: "warn", rotulo: "Aguardando a chave do provedor de IA" }),
    },
    // Sem leitura de verdade no piloto: aparece só com a nota do projeto, sem inventar estado.
    { nome: "Meta Ads", ref: "Meta Ads", href: "/origem", destino: "Origem e anúncios", monitorada: false, estado: SEM_LEITURA },
  ];

  // ───── Marginália: resumo das leituras ─────
  const monitoradas = conexoes.filter((c) => c.monitorada);
  const lidas = monitoradas.filter((c) => c.estado !== null);
  const ligadas = lidas.filter((c) => c.estado?.tom === "ok").length;
  const semLeitura = lidas.filter((c) => c.estado === SEM_LEITURA).length;
  const carregandoConexoes = lidas.length < monitoradas.length;

  const planejados = playbookRef.templates;
  const aprovados = tpl.data ? planejados.filter((t) => tpl.data.data.find((r) => r.name === t.nome)?.status === "APPROVED").length : 0;

  const resumo: MarginItem[] = [
    {
      label: "Conexões ligadas",
      value: carregandoConexoes ? "—" : `${ligadas} de ${monitoradas.length}`,
      tone: carregandoConexoes ? undefined : ligadas === monitoradas.length ? "ok" : "warn",
      sub: `Meta Ads não é monitorado${semLeitura ? ` · ${semLeitura} sem leitura` : ""}`,
    },
    {
      label: "Templates aprovados",
      value: tpl.isPending ? "—" : tpl.isError ? "sem leitura" : `${aprovados} de ${planejados.length}`,
      tone: tpl.data ? (aprovados === planejados.length ? "ok" : "warn") : undefined,
      sub: "Os planejados no playbook, cruzados com a Meta",
    },
    {
      label: "Modo sombra",
      value: rd.isPending ? "—" : rd.data ? (rd.data.shadow.enabled ? "Ativo" : "Pendente") : "sem leitura",
      tone: rd.data ? (rd.data.shadow.enabled ? "ok" : "warn") : undefined,
      sub: rd.data?.shadow.mode ? `modo ${rd.data.shadow.mode}` : undefined,
    },
  ];

  return (
    <>
      <PageHeader eyebrow="Agente" title="Playbook, conexões e templates">
        Tudo o que o agente precisa para trabalhar. O que ainda não está ligado aparece como pendente; onde não há leitura, aparece &ldquo;sem leitura&rdquo;, sem estimativas.
      </PageHeader>

      <div className="grid gap-x-14 gap-y-12 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-12">
          <Folio n="01" title="Aprendizado em modo sombra" hint="O agente rascunha respostas sem enviar nada. Aqui, cada rascunho é comparado com o que a equipe de fato escreveu. Lido do servidor.">
            <QueryBlock q={rd} skeleton={<Skeleton className="h-40" />}>
              {(r) =>
                !r.shadow.enabled ? (
                  <p className="text-sm text-mute">Aprendizado em modo sombra aguardando a chave do provedor de IA. Quando ela for configurada, esta tabela mostra, por etapa, quantos rascunhos foram comparados com a resposta real.</p>
                ) : r.stages.length === 0 ? (
                  <p className="text-sm text-mute">Ativo, mas ainda sem rascunhos comparados.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <caption className="sr-only">Rascunhos do agente comparados com a resposta humana, por etapa do funil</caption>
                      <thead>
                        <tr className="border-b border-line text-mute">
                          <th scope="col" className={`${th} pr-4 text-left`}>Etapa</th>
                          <th scope="col" className={`${th} px-4 text-right`}>Rascunhos</th>
                          <th scope="col" className={`${th} px-4 text-right`}>Comparados</th>
                          <th scope="col" className={`${th} px-4 text-right`}>Similaridade</th>
                          <th scope="col" className={`${th} pl-4 text-right`}>Aproveitáveis</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-line">
                        {r.stages.map((s) => (
                          <tr key={s.stage}>
                            <th scope="row" className="py-2.5 pr-4 text-left font-normal">{STAGE_META[s.stage as Stage]?.nome ?? s.stage}</th>
                            <td className="tabular px-4 py-2.5 text-right font-mono">{toNum(s.drafts)}</td>
                            <td className="tabular px-4 py-2.5 text-right font-mono">{toNum(s.compared)}</td>
                            <td className="tabular px-4 py-2.5 text-right font-mono">{s.avg_similarity === null ? "sem dados" : pct(toNum(s.avg_similarity))}</td>
                            <td className="tabular pl-4 py-2.5 text-right font-mono font-semibold">{s.usable_rate === null ? "sem dados" : pct(toNum(s.usable_rate))}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )
              }
            </QueryBlock>
          </Folio>

          <Folio n="02" title="Conexões" hint="Estado lido do servidor. Cada linha leva à tela onde se configura.">
            <ul className="divide-y divide-line border-y border-line">
              {conexoes.map((c) => {
                const nota = notaDe(c.ref);
                return (
                  <li key={c.nome} className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-4 gap-y-1 py-3">
                    <div className="min-w-0">
                      <p className="font-medium">{c.nome}</p>
                      {c.estado?.detalhe && <p className="mt-0.5 break-words text-sm text-mute">{c.estado.detalhe}</p>}
                      {nota && c.estado?.tom !== "ok" && <p className="mt-0.5 text-xs text-mute">Nota do projeto: {nota}</p>}
                      {c.href && (
                        <Link href={c.href} className="mt-1 inline-flex min-h-[44px] items-center text-sm font-medium text-brand-ink underline underline-offset-2">
                          Ver em {c.destino}
                        </Link>
                      )}
                    </div>
                    <Selo estado={c.estado} />
                  </li>
                );
              })}
            </ul>
          </Folio>

          <Folio n="03" title="Playbook" hint="Texto de referência do projeto. Ainda não sincronizado com o agente.">
            <ol className="divide-y divide-line border-y border-line">
              {playbookRef.ajustes.map((a, i) => (
                <li key={a} className="grid grid-cols-[2rem_minmax(0,1fr)] gap-x-3 py-3 text-sm">
                  <span className="tabular font-mono text-mute" aria-hidden="true">{String(i + 1).padStart(2, "0")}</span>
                  <span>{a}</span>
                </li>
              ))}
            </ol>
          </Folio>

          <Folio n="04" title="Templates do WhatsApp" hint="Os templates planejados no playbook, cruzados com o que a Meta já tem. Lido do que o servidor sincronizou.">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">Templates planejados e o estado de cada um na Meta</caption>
                <thead>
                  <tr className="border-b border-line text-mute">
                    <th scope="col" className={`${th} pr-4 text-left`}>Template</th>
                    <th scope="col" className={`${th} px-4 text-left`}>Categoria</th>
                    <th scope="col" className={`${th} pl-4 text-right`}>Estado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {planejados.map((t) => {
                    const e = estadoTemplate(t.nome, tpl);
                    return (
                      <tr key={t.nome}>
                        <th scope="row" className="break-all py-2.5 pr-4 text-left font-mono font-semibold">{t.nome}</th>
                        <td className="px-4 py-2.5 text-mute">{t.categoria}</td>
                        <td className="py-2.5 pl-4 text-right">
                          {e ? <span className={`${chip} ${e.tom}`}>{e.rotulo}</span> : <span className={`${chip} ${TOM.mute}`} aria-busy="true">Lendo…</span>}
                          {e?.detalhe && <p className="mt-1 text-xs text-mute">{e.detalhe}</p>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Folio>
        </div>

        <aside className="min-w-0" aria-label="Resumo das leituras">
          <h2 className="mb-3 font-display text-xl leading-tight">Resumo</h2>
          <Marginalia items={resumo} />
        </aside>
      </div>
    </>
  );
}
