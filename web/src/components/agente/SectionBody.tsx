"use client";
import type { PlaybookData, PredicateGroup } from "@/lib/types";
import { CampoListEditor } from "./CampoListEditor";
import { LinesField, NumberField, TextField } from "./fields";
import { FatoListEditor, ObjecaoListEditor } from "./ObjecaoListEditor";
import type { SectionKey } from "./playbook-api";
import { PredicateEditor } from "./PredicateEditor";

// Conteúdo de cada uma das 10 seções do playbook. `set` recebe a função que produz o próximo playbook.

type Props = { k: SectionKey; d: PlaybookData; set: (fn: (d: PlaybookData) => PlaybookData) => void; ro: boolean };

export function SectionBody({ k, d, set, ro }: Props) {
  switch (k) {
    case "oferta":
      return (
        <div className="grid gap-4">
          <TextField label="O que a corretora vende" multiline value={d.oferta.descricao} ro={ro} maxLength={2000} onChange={(v) => set((x) => ({ ...x, oferta: { ...x.oferta, descricao: v } }))} />
          <TextField label="Para quem (público)" value={d.oferta.publico} ro={ro} maxLength={500} onChange={(v) => set((x) => ({ ...x, oferta: { ...x.oferta, publico: v } }))} />
        </div>
      );
    case "campos":
      return <CampoListEditor campos={d.campos} ro={ro} onChange={(c) => set((x) => ({ ...x, campos: c }))} />;
    case "criterios":
      return (
        <div className="space-y-8">
          {d.campos.every((c) => !c.chave.trim()) && <p className="text-sm text-mute">Cadastre os campos de qualificação primeiro: as condições usam as chaves deles.</p>}
          <PredicateEditor
            title="Qualificado" hint="Quando o lead está pronto para a reunião." campos={d.campos} ro={ro}
            value={d.criterios.qualificado as PredicateGroup | undefined}
            onChange={(g) => set((x) => ({ ...x, criterios: { ...x.criterios, qualificado: g } }))}
          />
          <PredicateEditor
            title="Desqualificado" opcional hint="Quando o agente para de conduzir a venda." campos={d.campos} ro={ro}
            value={d.criterios.desqualificado as PredicateGroup | undefined}
            onChange={(g) => set((x) => ({ ...x, criterios: { ...x.criterios, desqualificado: g } }))}
          />
        </div>
      );
    case "objecoes":
      return <ObjecaoListEditor objecoes={d.objecoes} ro={ro} onChange={(o) => set((x) => ({ ...x, objecoes: o }))} />;
    case "fatos":
      return <FatoListEditor fatos={d.fatos} ro={ro} onChange={(f) => set((x) => ({ ...x, fatos: f }))} />;
    case "tom":
      return (
        <div className="grid gap-4 sm:grid-cols-3">
          <TextField label="Formalidade" value={d.tom.formalidade} ro={ro} maxLength={200} hint="Ex.: informal, trata por você." onChange={(v) => set((x) => ({ ...x, tom: { ...x.tom, formalidade: v } }))} />
          <TextField label="Tamanho das mensagens" value={d.tom.tamanho} ro={ro} maxLength={200} onChange={(v) => set((x) => ({ ...x, tom: { ...x.tom, tamanho: v } }))} />
          <TextField label="Emoji" value={d.tom.emoji} ro={ro} maxLength={200} onChange={(v) => set((x) => ({ ...x, tom: { ...x.tom, emoji: v } }))} />
          <LinesField label="Frases da casa" className="sm:col-span-3" value={d.tom.frases} ro={ro} onChange={(v) => set((x) => ({ ...x, tom: { ...x.tom, frases: v } }))} />
        </div>
      );
    case "regrasProibidas":
      return <LinesField label="O agente nunca diz ou faz" value={d.regrasProibidas} ro={ro} hint="Somam-se às regras fixas do sistema." onChange={(v) => set((x) => ({ ...x, regrasProibidas: v }))} />;
    case "passagemHumano":
      return <LinesField label="Repassar para uma pessoa quando" value={d.passagemHumano.quando} ro={ro} onChange={(v) => set((x) => ({ ...x, passagemHumano: { quando: v } }))} />;
    case "agenda":
      return (
        <div className="grid gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <LinesField label="Tipos de reunião" value={d.agenda.tiposReuniao} ro={ro} onChange={(v) => set((x) => ({ ...x, agenda: { ...x.agenda, tiposReuniao: v } }))} />
          <NumberField label="Duração (minutos)" value={d.agenda.duracaoMin} ro={ro} min={0} max={480} onChange={(v) => set((x) => ({ ...x, agenda: { ...x.agenda, duracaoMin: v } }))} />
          <TextField label="Janelas de horário" className="sm:col-span-2" value={d.agenda.janelas} ro={ro} maxLength={500} hint="Ex.: dias úteis, das 9h às 18h." onChange={(v) => set((x) => ({ ...x, agenda: { ...x.agenda, janelas: v } }))} />
          <TextField label="O que prometer" className="sm:col-span-2" multiline value={d.agenda.prometer} ro={ro} maxLength={1000} onChange={(v) => set((x) => ({ ...x, agenda: { ...x.agenda, prometer: v } }))} />
        </div>
      );
    case "cadencia":
      return (
        <div className="grid gap-4">
          <NumberField label="Máximo de tentativas sem resposta" value={d.cadencia.maxTentativas} ro={ro} min={0} max={20} onChange={(v) => set((x) => ({ ...x, cadencia: { ...x.cadencia, maxTentativas: v } }))} />
          <TextField label="Mensagem de retomada" multiline value={d.cadencia.mensagem} ro={ro} maxLength={1000} onChange={(v) => set((x) => ({ ...x, cadencia: { ...x.cadencia, mensagem: v } }))} />
        </div>
      );
  }
}
