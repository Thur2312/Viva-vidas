"use client";
import type { ApprovedFact, Objection } from "@/lib/types";
import { AddButton, LinesField, RemoveButton, TextField, removeAt, setAt } from "./fields";

// Objeções (como o lead diz, o que responder, o que nunca dizer) e fatos aprovados (o único texto que o agente pode afirmar).

/** Próximo id livre no formato `prefixo-N`. */
const proximoId = (prefixo: string, ids: string[]) => {
  let n = ids.length + 1;
  while (ids.includes(`${prefixo}-${n}`)) n++;
  return `${prefixo}-${n}`;
};

export function ObjecaoListEditor({ objecoes, onChange, ro }: { objecoes: Objection[]; onChange: (o: Objection[]) => void; ro: boolean }) {
  return (
    <div className="space-y-4">
      {objecoes.length === 0 && <p className="text-sm text-mute">Nenhuma objeção cadastrada.</p>}
      <ol className="space-y-4">
        {objecoes.map((o, i) => (
          <li key={i} className="rounded-[2px] border border-line bg-card p-4">
            <fieldset>
              <legend className="mb-3 flex flex-wrap items-center gap-2 text-sm">
                <span className="tabular font-mono text-mute">{String(i + 1).padStart(2, "0")}</span>
                <span className="font-semibold">{o.gatilho.trim() || "Objeção sem gatilho"}</span>
                <span className="font-mono text-xs text-mute">({o.id})</span>
              </legend>
              <TextField label="Gatilho (como o lead diz)" value={o.gatilho} onChange={(v) => onChange(setAt(objecoes, i, { gatilho: v }))} ro={ro} maxLength={500} />
              <TextField label="Resposta recomendada" className="mt-4" multiline value={o.resposta} onChange={(v) => onChange(setAt(objecoes, i, { resposta: v }))} ro={ro} maxLength={2000} />
              <div className="mt-4 flex items-end gap-3">
                <LinesField label="Nunca dizer" className="min-w-0 flex-1" value={o.nuncaDizer} onChange={(v) => onChange(setAt(objecoes, i, { nuncaDizer: v }))} ro={ro} />
                {!ro && <RemoveButton label={`Remover a objeção ${o.id}`} onClick={() => onChange(removeAt(objecoes, i))} />}
              </div>
            </fieldset>
          </li>
        ))}
      </ol>
      {!ro && (
        <AddButton onClick={() => onChange([...objecoes, { id: proximoId("obj", objecoes.map((x) => x.id)), gatilho: "", resposta: "", nuncaDizer: [] }])}>
          Adicionar objeção
        </AddButton>
      )}
    </div>
  );
}

export function FatoListEditor({ fatos, onChange, ro }: { fatos: ApprovedFact[]; onChange: (f: ApprovedFact[]) => void; ro: boolean }) {
  return (
    <div className="space-y-4">
      <p className="rounded-lg border border-brand/40 bg-brand/10 p-3 text-sm">
        {"Escreva preços como 'R$ 350 por mês' e prazos como '30 dias' — o agente só pode afirmar números que estejam aqui."}
      </p>
      {fatos.length === 0 && <p className="text-sm text-mute">Nenhum fato cadastrado.</p>}
      <ol className="divide-y divide-line border-y border-line">
        {fatos.map((f, i) => (
          <li key={i} className="grid gap-3 py-4 sm:grid-cols-[10rem_minmax(0,1fr)_auto] sm:items-end">
            <TextField label="Identificador" mono value={f.id} onChange={(v) => onChange(setAt(fatos, i, { id: v }))} ro={ro} maxLength={64} />
            <TextField label="Texto aprovado" multiline value={f.texto} onChange={(v) => onChange(setAt(fatos, i, { texto: v }))} ro={ro} maxLength={2000} />
            {!ro && <RemoveButton label={`Remover o fato ${f.id || i + 1}`} onClick={() => onChange(removeAt(fatos, i))} />}
          </li>
        ))}
      </ol>
      {!ro && <AddButton onClick={() => onChange([...fatos, { id: proximoId("fato", fatos.map((x) => x.id)), texto: "" }])}>Adicionar fato</AddButton>}
    </div>
  );
}
