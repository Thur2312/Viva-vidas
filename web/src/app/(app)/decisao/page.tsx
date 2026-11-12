"use client";

import { useEffect, useState } from "react";
import { CircleDollarSign, Percent, Target, Wallet } from "lucide-react";
import { EmptyState, QueryBlock, Skeleton } from "@/components/Block";
import { RangePicker } from "@/components/RangePicker";
import { KpiCard, PageHeader, Panel } from "@/components/ui";
import { useConversationStats, useOverview } from "@/lib/hooks";
import { useRangeState } from "@/lib/range";
import { money, num, pct } from "@/lib/format";
import { toNum, type Overview } from "@/lib/types";
import {
  COMISSAO, CUSTO_JANELA_PADRAO, META_MENSAL, REFERENCIA, SETUP,
  caminhoParaMeta, comissao, custoPorQualificado, taxas, taxasReferencia, type Funil,
} from "@/lib/decisao";

const STORAGE = "hz_custo_janela";

function useCustoJanela() {
  const [v, setV] = useState(CUSTO_JANELA_PADRAO);
  useEffect(() => {
    try {
      const n = Number(localStorage.getItem(STORAGE));
      if (Number.isFinite(n) && n > 0 && n < 100) setV(n);
    } catch { /* armazenamento indisponível: fica o padrão */ }
  }, []);
  const set = (n: number) => {
    setV(n);
    try { localStorage.setItem(STORAGE, String(n)); } catch { /* ignora */ }
  };
  return [v, set] as const;
}

const funilDe = (o: Overview): Funil => ({
  contatos: toNum(o.funnel?.contatado),
  respondeu: toNum(o.funnel?.respondeu),
  qualificados: toNum(o.funnel?.qualificado),
  vendas: toNum(o.funnel?.venda),
});

const fmt = (v: number | null) => (v === null ? "—" : pct(v));

function Row({ label, pilot, base, hint }: { label: string; pilot: number | null; base: number | null; hint: string }) {
  const melhor = pilot !== null && base !== null && pilot > base;
  return (
    <tr className="border-t border-line">
      <th scope="row" className="py-3 pr-3 text-left font-medium">
        {label}
        <span className="block text-xs font-normal text-mute">{hint}</span>
      </th>
      <td className="tabular py-3 pr-3 text-right font-semibold">{fmt(pilot)}</td>
      <td className="tabular py-3 text-right text-mute">{fmt(base)}</td>
      <td className="py-3 pl-3 text-right text-xs">
        {pilot === null ? <span className="text-mute">sem dados</span> : melhor ? <span className="font-semibold text-ok">acima da base</span> : <span className="text-warn">na base ou abaixo</span>}
      </td>
    </tr>
  );
}

export default function Decisao() {
  const [range, setRange] = useRangeState("30d");
  const ov = useOverview(range);
  const st = useConversationStats(range);
  const [janela, setJanela] = useCustoJanela();
  const janelas = st.data?.conversas_ativas ?? 0;

  return (
    <>
      <PageHeader eyebrow="Reunião do dia 20" title="Os números para decidir">
        O que o piloto custou, o que entregou e o que falta para chegar na meta. Sem promessa: tudo calculado dos dados reais do período.
      </PageHeader>

      <div className="mb-6"><RangePicker value={range} onChange={setRange} /></div>

      <QueryBlock q={ov} skeleton={<div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-28" />)}</div>}>
        {(o) => {
          const f = funilDe(o);
          const invest = toNum(o.investido);
          const receita = toNum(o.receita);
          const c = custoPorQualificado(invest, janelas, janela, f.qualificados);
          const com = comissao(receita);
          return (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <KpiCard variant="primary" title="Custo por qualificado" value={c.porQualificado === null ? "—" : money(c.porQualificado)} icon={<CircleDollarSign size={18} />}
                sub={`${money(c.total)} em ${num(f.qualificados)} qualificados`}
                tip="Anúncios + janelas de conversa do WhatsApp (estimadas). Tokens de IA e voz ainda não são registrados, então o custo real é um pouco maior." />
              <KpiCard title="Vendas pelo agente" value={num(f.vendas)} icon={<Target size={18} />} sub={`${money(receita)} vendidos no período`} tip="Base de cálculo dos 30% da proposta." />
              <KpiCard variant="success" title={`Comissão de ${pct(COMISSAO)}`} value={money(com)} icon={<Percent size={18} />} sub="sobre o que foi vendido" tip="A regra de atribuição de venda ainda será fechada em contrato." />
              <KpiCard title="Setup" value={money(SETUP)} icon={<Wallet size={18} />} sub={receita > 0 ? `Comissão cobre ${pct(Math.min(1, com / SETUP))} do setup` : "Sem vendas ainda"} tip="Duas parcelas de R$ 2.500. A data da segunda parcela precisa estar por escrito." />
            </div>
          );
        }}
      </QueryBlock>

      <div className="mt-6 grid gap-6 xl:grid-cols-5">
        <Panel className="rise xl:col-span-3" title="Piloto contra a base atual" hint="A base é o funil que o Alberto tinha antes do agente. Se o piloto não supera a base, o agente ainda não está provando valor.">
          <QueryBlock q={ov} skeleton={<Skeleton className="h-56" />} isEmpty={(o) => toNum(o.funnel?.contatado) === 0} empty={<EmptyState title="Sem contatos no período">Quando o agente começar a contatar leads, a comparação aparece aqui.</EmptyState>}>
            {(o) => {
              const p = taxas(funilDe(o));
              const b = taxasReferencia();
              return (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[460px] text-sm">
                    <thead>
                      <tr className="text-xs uppercase tracking-wider text-mute">
                        <th scope="col" className="pb-2 text-left font-semibold">Etapa</th>
                        <th scope="col" className="pb-2 text-right font-semibold">Piloto</th>
                        <th scope="col" className="pb-2 text-right font-semibold">Base atual</th>
                        <th scope="col" className="pb-2 text-right font-semibold">Leitura</th>
                      </tr>
                    </thead>
                    <tbody>
                      <Row label="Respondeu" pilot={p.resposta} base={b.resposta} hint="de quem recebeu a primeira mensagem" />
                      <Row label="Qualificado" pilot={p.qualificacao} base={b.qualificacao} hint="de quem respondeu" />
                      <Row label="Venda" pilot={p.fechamento} base={b.fechamento} hint="de quem foi qualificado" />
                      <Row label="Contato → venda" pilot={p.contatoVenda} base={b.contatoVenda} hint="o número que decide a meta" />
                    </tbody>
                  </table>
                  <p className="mt-3 text-xs text-mute">
                    Base: ~{num(REFERENCIA.contatos)} contatos, ~{num(REFERENCIA.conversas)} conversas, ~{num(REFERENCIA.qualificados)} qualificados e {REFERENCIA.vendas} vendas ({money(REFERENCIA.receita)}), valores informados na proposta.
                    Lote pequeno de piloto varia muito: com poucas vendas, não conclua nada só pela taxa.
                  </p>
                </div>
              );
            }}
          </QueryBlock>
        </Panel>

        <Panel className="rise xl:col-span-2" title="Caminho até a meta" hint={`Meta: ${money(META_MENSAL)} por mês em vendas novas.`}>
          <QueryBlock q={ov} skeleton={<Skeleton className="h-56" />}>
            {(o) => {
              const f = funilDe(o);
              const receita = toNum(o.receita);
              const ticket = f.vendas > 0 ? receita / f.vendas : null;
              if (ticket === null) {
                return <EmptyState title="Ainda sem vendas no período">O ticket médio sai das vendas registradas. Sem venda, qualquer projeção seria chute, então não mostramos.</EmptyState>;
              }
              const k = caminhoParaMeta(META_MENSAL, ticket, taxas(f).contatoVenda);
              return (
                <dl className="space-y-3 text-sm">
                  <div className="flex justify-between gap-3"><dt className="text-mute">Ticket médio observado</dt><dd className="tabular font-semibold">{money(ticket)}</dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-mute">Vendas por mês para a meta</dt><dd className="tabular font-semibold">{num(k.vendas ?? 0)}</dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-mute">Contatos por mês nesse ritmo</dt><dd className="tabular font-semibold">{k.contatos === null ? "—" : num(k.contatos)}</dd></div>
                  <p className="rounded-lg bg-warn/10 p-3 text-xs text-warn">Projeção com {num(f.vendas)} {f.vendas === 1 ? "venda" : "vendas"}: use para ordem de grandeza, não como promessa ao cliente.</p>
                </dl>
              );
            }}
          </QueryBlock>
        </Panel>
      </div>

      <Panel className="rise mt-6" title="Custo das mensagens" hint="O setup não cobre mensagens do WhatsApp. Ajuste ao valor da sua fatura da Meta.">
        <div className="flex flex-wrap items-end gap-4">
          <label className="text-sm">
            <span className="mb-1 block font-medium">Custo por janela de conversa (R$)</span>
            <input type="number" min={0.01} max={50} step={0.01} value={janela} onChange={(e) => { const n = Number(e.target.value); if (n > 0 && n < 100) setJanela(n); }}
              className="tabular min-h-[44px] w-36 rounded-lg border border-line bg-card px-3" />
          </label>
          <p className="pb-2 text-sm text-mute">
            {num(janelas)} conversas ativas × {money(janela)} ≈ <strong className="tabular text-ink">{money(janelas * janela)}</strong> (estimado)
          </p>
        </div>
        <p className="mt-3 text-xs text-mute">Não medidos ainda: tokens da IA e minutos de voz. Quando forem registrados na API, entram aqui sem mudar esta tela.</p>
      </Panel>
    </>
  );
}
