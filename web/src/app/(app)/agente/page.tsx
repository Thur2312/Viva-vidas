"use client";

import { QueryBlock, Skeleton } from "@/components/Block";
import { PageHeader, Panel } from "@/components/ui";
import { useReadiness } from "@/lib/hooks";
import { pct } from "@/lib/format";
import { playbookRef } from "@/lib/playbook";
import { STAGE_META, toNum, type Stage } from "@/lib/types";

const pendente = <span className="shrink-0 rounded-full bg-warn/10 px-2.5 py-1 text-xs font-semibold text-warn">Pendente</span>;

export default function Agente() {
  const rd = useReadiness();

  return (
    <>
      <PageHeader eyebrow="Agente" title="Playbook, conexões e templates">
        Tudo o que o agente precisa para trabalhar. O que ainda não está ligado aparece como pendente, sem estimativas.
      </PageHeader>

      <div className="rise grid gap-6 lg:grid-cols-2">
        <Panel title="Aprendizado em modo sombra" hint="Lido do servidor. É o único estado desta página que vem de dados reais.">
          <QueryBlock q={rd} skeleton={<Skeleton className="h-40" />}>
            {(r) => (
              <div>
                <p className="mb-3 flex items-center justify-between gap-3 text-sm">
                  <span className="font-semibold">Modo sombra{r.shadow.mode ? ` (${r.shadow.mode})` : ""}</span>
                  {r.shadow.enabled ? <span className="rounded-full bg-ok/15 px-2.5 py-1 text-xs font-semibold text-ok">Ativo</span> : pendente}
                </p>
                {!r.shadow.enabled ? (
                  <p className="text-sm text-mute">Aprendizado em modo sombra aguardando a chave do provedor de IA.</p>
                ) : r.stages.length === 0 ? (
                  <p className="text-sm text-mute">Ativo, mas ainda sem rascunhos comparados.</p>
                ) : (
                  <ul className="space-y-1.5 text-sm">
                    {r.stages.map((s) => (
                      <li key={s.stage} className="flex justify-between gap-3">
                        <span>{STAGE_META[s.stage as Stage]?.nome ?? s.stage}</span>
                        <span className="tabular font-semibold">{s.usable_rate === null ? "sem dados" : `${pct(toNum(s.usable_rate))} aproveitáveis`}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </QueryBlock>
        </Panel>

        <Panel title="Conexões" hint="Nenhuma integração externa foi confirmada por este painel.">
          <ul className="space-y-3 text-sm">
            {playbookRef.ferramentas.map((f) => (
              <li key={f.nome} className="flex items-start justify-between gap-4 border-b border-line/70 pb-3 last:border-0 last:pb-0">
                <div>
                  <p className="font-semibold">{f.nome}</p>
                  <p className="text-mute">{f.detalhe}</p>
                </div>
                {pendente}
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      <div className="rise mt-6 grid gap-6 lg:grid-cols-2">
        <Panel title="Playbook" hint="Texto de referência do projeto. Ainda não sincronizado com o agente.">
          <p className="mb-3 text-sm font-semibold">Regras já combinadas</p>
          <ul className="space-y-2.5 text-sm">
            {playbookRef.ajustes.map((a) => (
              <li key={a} className="flex gap-3">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-brand" aria-hidden="true" />
                {a}
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title="Templates do WhatsApp" hint="Só podem ser enviados para aprovação da Meta quando o número da API oficial estiver ativo.">
          <ul className="grid gap-3 sm:grid-cols-2">
            {playbookRef.templates.map((t) => (
              <li key={t.nome} className="rounded-xl border border-line p-4">
                <p className="break-all font-mono text-sm font-semibold">{t.nome}</p>
                <div className="mt-2 flex items-center justify-between text-xs">
                  <span className="text-mute">{t.categoria}</span>
                  <span className="rounded-full bg-warn/10 px-2.5 py-1 font-semibold text-warn">Pendente</span>
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </>
  );
}
