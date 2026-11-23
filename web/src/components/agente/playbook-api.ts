"use client";
// Cliente do playbook de vendas. Fala só com o BFF (/api/pilot/playbook...); nenhum token passa por aqui.
// Também guarda a lógica pura do editor: normalizar o que vem do servidor, limpar antes de salvar
// e a mesma checagem de completude do servidor (api/src/modules/pilot/brain/playbook.validate.ts),
// usada só como dica ao vivo. Quem decide na hora de ativar é sempre o servidor (lista `missing`).
import { ActionError, getJson, sendJson, type ActionMessages } from "@/lib/client";
import { DEMO } from "@/lib/flags";
import type { PlaybookData, PlaybookOverview, PlaybookVersion, Predicate, PredicateGroup, ProfileField } from "@/lib/types";

const B = "/api/pilot/playbook";

/** Limite do DTO da API (200 KiB). Conferido antes de enviar para dar uma mensagem clara. */
export const PLAYBOOK_MAX_BYTES = 200 * 1024;

// ───── Seções ─────
export const SECTION_KEYS = ["oferta", "campos", "criterios", "objecoes", "fatos", "tom", "regrasProibidas", "passagemHumano", "agenda", "cadencia"] as const;
export type SectionKey = (typeof SECTION_KEYS)[number];

export const SECTION_LABEL: Record<SectionKey, string> = {
  oferta: "Oferta",
  campos: "Campos de qualificação",
  criterios: "Critérios",
  objecoes: "Objeções",
  fatos: "Fatos aprovados",
  tom: "Tom de voz",
  regrasProibidas: "Regras proibidas",
  passagemHumano: "Passagem para uma pessoa",
  agenda: "Agenda",
  cadencia: "Cadência",
};

/** Seções sem regra de completude no servidor: contam como completas e aparecem como "opcional". */
export const OPTIONAL_SECTIONS: SectionKey[] = ["regrasProibidas"];

// ───── Modelo vazio (cópia de api/.../playbook.template.ts, usada no modo demonstração) ─────
export function emptyPlaybook(): PlaybookData {
  return {
    oferta: { descricao: "", publico: "" },
    campos: [],
    criterios: {},
    objecoes: [],
    fatos: [],
    tom: { formalidade: "", tamanho: "", emoji: "", frases: [] },
    regrasProibidas: [],
    passagemHumano: { quando: [] },
    agenda: { tiposReuniao: [], duracaoMin: 0, janelas: "", prometer: "" },
    cadencia: { maxTentativas: 0, mensagem: "" },
  };
}

const DEMO_EXEMPLOS: Record<string, string> = {
  oferta: 'Descreva o que a corretora vende, para quem, em linguagem do cliente. EXEMPLO (não ativo): "Ajudamos famílias a escolher um plano que cabe no bolso."',
  campos: 'Liste os dados a perguntar, em ordem. Dado sensível (saúde) nunca é perguntado nem obrigatório. EXEMPLO (não ativo): chave "cidade", pergunta "Em que cidade vocês moram?".',
  criterios: "Regra sobre os campos que torna o lead qualificado ou desqualificado. EXEMPLO (não ativo): qualificado = cidade preenchida.",
  objecoes: 'Para cada objeção: como o lead diz, resposta recomendada e o que nunca dizer. EXEMPLO (não ativo): gatilho "tá caro".',
  fatos: 'Texto exato que o agente pode afirmar. O que não estiver aqui vai para uma pessoa. EXEMPLO (não ativo): "Fato de exemplo".',
  tom: 'Formalidade, tamanho das mensagens, uso de emoji e frases suas. EXEMPLO (não ativo): "Oi, tudo bem?".',
  regrasProibidas: 'O que o agente nunca diz ou faz, além das regras fixas do sistema. EXEMPLO (não ativo): "Nunca prometer desconto".',
  passagemHumano: 'Quando repassar para uma pessoa. EXEMPLO (não ativo): "Quando o lead pedir para falar com humano".',
  agenda: 'Tipos de reunião, duração, janelas e o que prometer. EXEMPLO (não ativo): "Conversa de 20 minutos".',
  cadencia: "Quantas tentativas sem resposta e o que dizer (hoje: não insistir após 2 mensagens). EXEMPLO (não ativo): 2 tentativas.",
};

/** Separa a instrução do exemplo ("... EXEMPLO (não ativo): ..."). O exemplo só aparece como ajuda; nunca é salvo. */
export function splitExemplo(s: string | undefined): { instrucao: string; exemplo: string } | null {
  if (!s) return null;
  const i = s.indexOf("EXEMPLO (não ativo)");
  if (i < 0) return { instrucao: s.trim(), exemplo: "" };
  return { instrucao: s.slice(0, i).trim(), exemplo: s.slice(i + "EXEMPLO (não ativo)".length).replace(/^\s*:\s*/, "").trim() };
}

// ───── Normalizar (o que vem do servidor pode ser parcial) e limpar (antes de salvar) ─────
const str = (v: unknown) => (typeof v === "string" ? v : "");
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : Number(v) || 0);
const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const objs = <T>(v: unknown): T[] => (Array.isArray(v) ? (v.filter((x) => x && typeof x === "object") as T[]) : []);

/** Critério sempre como grupo na raiz (o editor trabalha com "todas"/"qualquer" + itens). */
export function normalizeGroup(p: Predicate | undefined): PredicateGroup | undefined {
  if (!p || typeof p !== "object") return undefined;
  if ("campo" in p) return { all: [p] };
  const all = objs<Predicate>(p.all);
  const any = objs<Predicate>(p.any);
  if (all.length && any.length) return { all: [...all, { any }] };
  if (any.length) return { any };
  return { all };
}

/** Copia só as chaves conhecidas, com valores padrão. Ignora `exemplos` (nunca vira conteúdo). */
export function normalizePlaybook(d: Partial<PlaybookData> | null | undefined): PlaybookData {
  const x = (d ?? {}) as Partial<PlaybookData>;
  return {
    oferta: { descricao: str(x.oferta?.descricao), publico: str(x.oferta?.publico) },
    campos: objs<ProfileField>(x.campos).map((c) => ({
      chave: str(c.chave), pergunta: str(c.pergunta), porque: str(c.porque),
      obrigatorio: c.sensivel ? false : !!c.obrigatorio, ordem: num(c.ordem), sensivel: !!c.sensivel,
      ...(strs(c.valores).length ? { valores: strs(c.valores) } : {}),
    })),
    criterios: { qualificado: normalizeGroup(x.criterios?.qualificado), desqualificado: normalizeGroup(x.criterios?.desqualificado) },
    objecoes: objs<PlaybookData["objecoes"][number]>(x.objecoes).map((o) => ({ id: str(o.id), gatilho: str(o.gatilho), resposta: str(o.resposta), nuncaDizer: strs(o.nuncaDizer) })),
    fatos: objs<PlaybookData["fatos"][number]>(x.fatos).map((f) => ({ id: str(f.id), texto: str(f.texto) })),
    tom: { formalidade: str(x.tom?.formalidade), tamanho: str(x.tom?.tamanho), emoji: str(x.tom?.emoji), frases: strs(x.tom?.frases) },
    regrasProibidas: strs(x.regrasProibidas),
    passagemHumano: { quando: strs(x.passagemHumano?.quando) },
    agenda: { tiposReuniao: strs(x.agenda?.tiposReuniao), duracaoMin: num(x.agenda?.duracaoMin), janelas: str(x.agenda?.janelas), prometer: str(x.agenda?.prometer) },
    cadencia: { maxTentativas: num(x.cadencia?.maxTentativas), mensagem: str(x.cadencia?.mensagem) },
  };
}

const lines = (a: string[]) => a.map((s) => s.trim()).filter(Boolean);

const NUMERIC_OPS = new Set(["gt", "gte", "lt", "lte"]);

/** Condição: sem `valor` em presente/ausente; "1,5" vira 1.5 nos operadores numéricos; texto aparado no resto. */
function cleanPredicate(p: Predicate): Predicate {
  if ("campo" in p) {
    const campo = p.campo.trim();
    if (p.op === "presente" || p.op === "ausente") return { campo, op: p.op };
    const raw = typeof p.valor === "string" ? p.valor.trim() : p.valor;
    if (NUMERIC_OPS.has(p.op) && typeof raw === "string" && raw !== "") {
      const n = Number(raw.replace(",", "."));
      if (Number.isFinite(n)) return { campo, op: p.op, valor: n };
    }
    return { campo, op: p.op, valor: raw ?? "" };
  }
  const out: PredicateGroup = {};
  if (p.all) out.all = p.all.map(cleanPredicate);
  if (p.any) out.any = p.any.map(cleanPredicate);
  return out;
}

/** Antes de salvar: tira linhas vazias das listas e espaços das chaves. Nunca inclui `exemplos`. */
export function cleanPlaybook(d: PlaybookData): PlaybookData {
  // Critérios mantêm a forma (até um grupo vazio): o servidor aponta "está vazio" na hora de ativar.
  const criterios: PlaybookData["criterios"] = {};
  if (d.criterios.qualificado) criterios.qualificado = cleanPredicate(d.criterios.qualificado);
  if (d.criterios.desqualificado) criterios.desqualificado = cleanPredicate(d.criterios.desqualificado);
  return {
    oferta: { descricao: d.oferta.descricao.trim(), publico: d.oferta.publico.trim() },
    campos: d.campos.map((c) => {
      const valores = lines(c.valores ?? []);
      return {
        chave: c.chave.trim(), pergunta: c.pergunta.trim(), porque: c.porque.trim(),
        obrigatorio: c.sensivel ? false : c.obrigatorio, ordem: Number.isFinite(c.ordem) ? c.ordem : 0, sensivel: c.sensivel,
        ...(valores.length ? { valores } : {}),
      };
    }),
    criterios,
    objecoes: d.objecoes.map((o) => ({ id: o.id.trim(), gatilho: o.gatilho.trim(), resposta: o.resposta.trim(), nuncaDizer: lines(o.nuncaDizer) })),
    fatos: d.fatos.map((f) => ({ id: f.id.trim(), texto: f.texto.trim() })),
    tom: { formalidade: d.tom.formalidade.trim(), tamanho: d.tom.tamanho.trim(), emoji: d.tom.emoji.trim(), frases: lines(d.tom.frases) },
    regrasProibidas: lines(d.regrasProibidas),
    passagemHumano: { quando: lines(d.passagemHumano.quando) },
    agenda: { tiposReuniao: lines(d.agenda.tiposReuniao), duracaoMin: d.agenda.duracaoMin, janelas: d.agenda.janelas.trim(), prometer: d.agenda.prometer.trim() },
    cadencia: { maxTentativas: d.cadencia.maxTentativas, mensagem: d.cadencia.mensagem.trim() },
  };
}

export const jsonBytes = (v: unknown) => new Blob([JSON.stringify(v)]).size;

// ───── Completude (mesmas regras e textos do servidor; aqui só como dica ao vivo) ─────
const vazio = (s: string | undefined) => !s || s.trim() === "";

function predicateErrors(p: Predicate, chaves: Set<string>, rotulo: string, out: string[]) {
  if ("campo" in p) {
    if (!chaves.has(p.campo)) out.push(`criterios: ${rotulo} usa campo inexistente (${p.campo})`);
    return;
  }
  const filhos = [...(p.all ?? []), ...(p.any ?? [])];
  if (filhos.length === 0) out.push(`criterios: ${rotulo} está vazio`);
  for (const f of filhos) predicateErrors(f, chaves, rotulo, out);
}

export function checkPlaybook(d: PlaybookData): string[] {
  const missing: string[] = [];
  if (vazio(d.oferta?.descricao)) missing.push("oferta: descreva o que a corretora vende");
  if (vazio(d.oferta?.publico)) missing.push("oferta: informe o público");

  const campos = d.campos ?? [];
  if (campos.length === 0) missing.push("campos: cadastre ao menos um campo de qualificação");
  const vistas = new Set<string>();
  const duplicadas = new Set<string>();
  for (const c of campos) {
    if (vazio(c.chave)) missing.push("campos: há campo sem chave");
    else if (vistas.has(c.chave)) duplicadas.add(c.chave);
    vistas.add(c.chave);
    if (!c.sensivel && vazio(c.pergunta)) missing.push(`campos: falta a pergunta (${c.chave})`);
    if (c.sensivel && c.obrigatorio) missing.push(`campos: campo sensível não pode ser obrigatório (${c.chave})`);
  }
  for (const k of duplicadas) missing.push(`campos: chave duplicada (${k})`);
  if (campos.length > 0 && !campos.some((c) => c.obrigatorio && !c.sensivel)) missing.push("campos: marque ao menos um campo obrigatório");

  const chaves = new Set(campos.map((c) => c.chave));
  if (!d.criterios?.qualificado) missing.push("criterios: defina quando o lead é qualificado");
  else predicateErrors(d.criterios.qualificado, chaves, "qualificado", missing);
  if (d.criterios?.desqualificado) predicateErrors(d.criterios.desqualificado, chaves, "desqualificado", missing);

  const objecoes = d.objecoes ?? [];
  if (objecoes.length === 0) missing.push("objecoes: cadastre ao menos uma objeção");
  for (const o of objecoes) if (vazio(o.gatilho) || vazio(o.resposta)) missing.push(`objecoes: preencha gatilho e resposta (${o.id})`);

  const fatos = d.fatos ?? [];
  if (fatos.length === 0) missing.push("fatos: cadastre ao menos um fato aprovado");
  for (const f of fatos) if (vazio(f.texto)) missing.push(`fatos: texto vazio (${f.id})`);

  if (vazio(d.tom?.formalidade)) missing.push("tom: informe a formalidade");
  if ((d.passagemHumano?.quando ?? []).length === 0) missing.push("passagemHumano: informe quando repassar para uma pessoa");
  if ((d.agenda?.tiposReuniao ?? []).length === 0) missing.push("agenda: informe os tipos de reunião");
  if (!(d.agenda?.duracaoMin > 0)) missing.push("agenda: informe a duração da reunião");
  if (!(d.cadencia?.maxTentativas > 0)) missing.push("cadencia: informe o número de tentativas");
  return missing;
}

/** "campos: falta a pergunta (x)" -> { section: "campos", text: "falta a pergunta (x)" }. */
export function parseMissing(m: string): { section: SectionKey | null; text: string } {
  const i = m.indexOf(": ");
  const k = i > 0 ? m.slice(0, i) : "";
  return (SECTION_KEYS as readonly string[]).includes(k) ? { section: k as SectionKey, text: m.slice(i + 2) } : { section: null, text: m };
}

// ───── Chamadas ─────
const MESSAGES: ActionMessages = {
  network: "Sem conexão com o servidor. Nada foi salvo.",
  fallback: "Não foi possível concluir a ação.",
  byStatus: {
    400: "Algum campo não é válido. Confira e tente de novo.",
    403: "Só o dono da conta pode editar ou ativar o playbook.",
    404: "Versão não encontrada.",
    409: "Esta versão não é mais um rascunho. Atualize a página e crie uma nova versão a partir dela.",
    413: "O playbook passou do tamanho máximo (200 KB).",
    422: "O playbook ainda está incompleto.",
    429: "Muitas ações em pouco tempo. Aguarde um instante.",
  },
};

// Demonstração: um rascunho guardado só na memória da aba. Nada vai para o servidor.
const demoStore: { versions: PlaybookVersion[] } = {
  versions: [{ version: 1, status: "rascunho", source: "manual", created_at: new Date().toISOString(), notes: null, data: emptyPlaybook() }],
};
const demoTemplate = (): PlaybookData => ({ ...emptyPlaybook(), exemplos: DEMO_EXEMPLOS });

export function fetchPlaybook(signal?: AbortSignal): Promise<PlaybookOverview> {
  if (DEMO) {
    const act = demoStore.versions.find((v) => v.status === "ativo");
    return Promise.resolve({
      active: act ? { version: act.version, data: act.data ?? emptyPlaybook(), status: act.status } : null,
      versions: [...demoStore.versions].sort((a, b) => b.version - a.version).map(({ version, status, source, created_at }) => ({ version, status, source, created_at })),
      template: demoTemplate(),
    });
  }
  return getJson<PlaybookOverview>(B, signal);
}

export function fetchPlaybookVersion(version: number, signal?: AbortSignal): Promise<PlaybookVersion> {
  if (DEMO) {
    const v = demoStore.versions.find((x) => x.version === version);
    return v ? Promise.resolve(structuredClone(v)) : Promise.reject(new ActionError(404, "not_found", "Versão não encontrada."));
  }
  return getJson<PlaybookVersion>(`${B}/${version}`, signal);
}

export type SaveInput = { version?: number; data?: PlaybookData; notes?: string; fromVersion?: number };

/** Sem `version`: cria uma versão nova (POST). Com `version`: atualiza o rascunho (PUT). */
export function savePlaybook(v: SaveInput): Promise<{ version: number }> {
  if (DEMO) {
    if (v.version) {
      const cur = demoStore.versions.find((x) => x.version === v.version);
      if (cur) Object.assign(cur, { data: v.data ?? cur.data, notes: v.notes ?? cur.notes });
      return Promise.resolve({ version: v.version });
    }
    const from = v.fromVersion ? demoStore.versions.find((x) => x.version === v.fromVersion)?.data : undefined;
    const version = Math.max(0, ...demoStore.versions.map((x) => x.version)) + 1;
    demoStore.versions.push({ version, status: "rascunho", source: "manual", created_at: new Date().toISOString(), notes: v.notes ?? null, data: structuredClone(v.data ?? from ?? emptyPlaybook()) });
    return Promise.resolve({ version });
  }
  if (v.version) return sendJson<{ version: number }>("PUT", `${B}/${v.version}`, { data: v.data, notes: v.notes }, MESSAGES);
  const body = v.data ? { data: v.data, notes: v.notes } : { fromVersion: v.fromVersion, notes: v.notes };
  return sendJson<{ version: number }>("POST", B, body, MESSAGES);
}

export function activatePlaybook(version: number): Promise<{ version: number; status: string }> {
  if (DEMO) {
    const cur = demoStore.versions.find((x) => x.version === version);
    const missing = checkPlaybook(normalizePlaybook(cur?.data));
    if (missing.length) return Promise.reject(new ActionError(422, "playbook_incompleto", `Playbook incompleto: ${missing.length} pendência(s).`, missing));
    for (const x of demoStore.versions) if (x.status === "ativo") x.status = "arquivado";
    if (cur) cur.status = "ativo";
    return Promise.resolve({ version, status: "ativo" });
  }
  return sendJson("POST", `${B}/${version}/activate`, {}, MESSAGES);
}
