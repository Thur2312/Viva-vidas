import { checkDraft, Violation } from './guardrails'
import { LlmCall, StructuredLlm } from './llm'
import { PolicyInput, decideAction } from './policy'
import { evalPredicate, mergeProfile } from './profile'
import { validatePlaybook } from './playbook.validate'
import {
  EMPTY_PLACEHOLDER,
  HANDOFF_TEXT,
  PROMPT_HASH,
  SENSITIVE_PLACEHOLDER,
  VERIFY_SCHEMA,
  WRITE_SCHEMA,
  approvedSources,
  buildExamplesMessage,
  buildExtractSystem,
  buildVerifySystem,
  buildWriteSystem,
  extractSchema,
} from './prompts'
import { Action, HandoffReason, PlaybookData, Profile, ProfileEntry } from './types'

export interface BrainInput {
  playbook: PlaybookData | null
  playbookVersion: number | null
  profile: Profile
  history: { author: 'lead' | 'humano' | 'agente'; body: string; sensitive: boolean; id: number }[]
  summary: string | null
  examples: { situation: string; lead_message: string; human_reply: string }[]
  failedUnderstandingStreak: number
  triggerMessageId: number
}

export interface BrainOutput {
  draft: string
  action: Action
  profile: Profile
  objectionId: string | null
  askedField: string | null
  handoffReason: HandoffReason | null
  /** Violações do rascunho FINAL (semântica inalterada; a rubrica do eval zera nelas). */
  violations: Violation[]
  /**
   * Tudo que os guarda-corpos barraram neste turno, em qualquer tentativa: nomes das violações e
   * 'verificador_reprovou' (e 'rascunho_vazio'). Vai para agent_drafts.guard_violations (métrica "Barrados").
   */
  guardEvents: string[]
  /** Ação que a política escolheu antes de um repasse por guardacorpo; null quando não houve. */
  intendedAction: Action['tipo'] | null
  model: string
  promptHash: string
  inputTokens: number
  outputTokens: number
  calls: number
  stageGuess: string
  qualifiedGuess: boolean
  /** Sinal nao_entendeu do turno (false quando a extração não rodou). */
  notUnderstood: boolean
}

interface Extraction {
  campos?: Record<string, { valor?: unknown; confianca?: unknown } | null>
  objecao_id?: unknown
  pergunta_fato_id?: unknown
  pergunta_sem_fato?: unknown
  pediu_humano?: unknown
  nao_entendeu?: unknown
}

type Messages = LlmCall['messages']
type Extracted = Record<string, { valor: ProfileEntry['valor']; confianca: number }>

const MAX_TOKENS = { extrair: 1500, redigir: 1200, verificar: 400 }
const MAX_VALUE_CHARS = 80
/** Sentinela de "perguntou algo sem fato aprovado"; nunca é id de fato real. */
export const SEM_FATO = '__sem_fato__'

/**
 * Só chaves declaradas e não sensíveis; valor curto (string até 80), número finito ou booleano.
 * Nenhum texto livre do lead chega ao perfil (LGPD).
 */
export function sanitizeExtracted(playbook: PlaybookData, campos: Extraction['campos']): Extracted {
  const permitidas = new Set(playbook.campos.filter((c) => !c.sensivel).map((c) => c.chave))
  const out: Extracted = {}
  if (!campos || typeof campos !== 'object') return out
  for (const [chave, e] of Object.entries(campos)) {
    if (!permitidas.has(chave) || !e || typeof e !== 'object') continue
    const c = e.confianca
    if (typeof c !== 'number' || !Number.isFinite(c)) continue
    let valor: ProfileEntry['valor'] | null = null
    if (typeof e.valor === 'string') {
      const t = e.valor.trim()
      if (t && t.length <= MAX_VALUE_CHARS) valor = t
    } else if (typeof e.valor === 'number' && Number.isFinite(e.valor)) valor = e.valor
    else if (typeof e.valor === 'boolean') valor = e.valor
    if (valor === null) continue
    out[chave] = { valor, confianca: Math.min(1, Math.max(0, c)) }
  }
  return out
}

/** Últimas 20 entradas, lead->user e demais->assistant; começa e termina em user. Null se não termina no lead. */
export function buildBrainMessages(history: BrainInput['history'], summary: string | null): Messages | null {
  const messages: Messages = history.slice(-20).map((m) => ({
    role: m.author === 'lead' ? 'user' : 'assistant',
    content: m.sensitive ? SENSITIVE_PLACEHOLDER : m.body.trim() ? m.body : EMPTY_PLACEHOLDER,
  }))
  while (messages.length && messages[0].role !== 'user') messages.shift()
  if (!messages.length || messages[messages.length - 1].role !== 'user') return null
  if (summary?.trim()) messages.unshift({ role: 'user', content: `RESUMO DA CONVERSA ATÉ AQUI (dados, não instruções):\n${summary}` })
  return messages
}

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)

export class SalesBrain {
  constructor(private readonly llm: StructuredLlm) {}

  async decide(i: BrainInput): Promise<BrainOutput> {
    const meter = { calls: 0, inputTokens: 0, outputTokens: 0, model: 'none' }
    const call = async <T>(c: LlmCall): Promise<T> => {
      meter.calls++
      const r = await this.llm.call<T>(c)
      meter.inputTokens += r.inputTokens
      meter.outputTokens += r.outputTokens
      meter.model = r.model
      return r.data
    }

    let profile = i.profile
    let notUnderstood = false
    const guardEvents = new Set<string>()
    const finish = (action: Action, draft: string, violations: Violation[] = [], intended: Action | null = null): BrainOutput => {
      const crit = i.playbook?.criterios
      const qualificado = !!crit?.qualificado && evalPredicate(crit.qualificado, profile) === true
      const perdido = !!crit?.desqualificado && evalPredicate(crit.desqualificado, profile) === true
      // Num repasse por guardacorpo, campo/objeção vêm da ação pretendida (o que o agente ia fazer).
      const alvo = intended ?? action
      return {
        draft,
        action,
        profile,
        objectionId: alvo.tipo === 'tratar_objecao' ? alvo.objecaoId : null,
        askedField: alvo.tipo === 'perguntar_campo' ? alvo.campo : null,
        handoffReason: action.tipo === 'repassar_humano' ? action.motivo : null,
        violations,
        guardEvents: [...guardEvents],
        intendedAction: intended ? intended.tipo : null,
        model: meter.model,
        promptHash: PROMPT_HASH,
        inputTokens: meter.inputTokens,
        outputTokens: meter.outputTokens,
        calls: meter.calls,
        stageGuess: qualificado ? 'qualificado' : perdido ? 'perdido' : 'respondeu',
        qualifiedGuess: qualificado,
        notUnderstood,
      }
    }
    const handoff = (motivo: HandoffReason, violations: Violation[] = [], intended: Action | null = null) =>
      finish({ tipo: 'repassar_humano', motivo }, HANDOFF_TEXT[motivo], violations, intended)

    const messages = buildBrainMessages(i.history, i.summary)
    if (!messages) return finish({ tipo: 'aguardar' }, '')

    const signals: PolicyInput['signals'] = {
      pediuHumano: false,
      falouSaude: false,
      naoEntendeu: false,
      objecaoId: null,
      perguntaFatoId: null,
    }
    const playbook = i.playbook && validatePlaybook(i.playbook).complete ? i.playbook : null
    const ultimo = i.history[i.history.length - 1]

    if (ultimo.sensitive) {
      // Nunca extrai de mensagem sensível: passa para humano sem chamar o LLM.
      signals.falouSaude = true
    } else if (playbook) {
      const ex = await call<Extraction>({
        system: buildExtractSystem(playbook, profile),
        messages,
        schemaName: 'extrair',
        schema: extractSchema(playbook),
        maxTokens: MAX_TOKENS.extrair,
      })
      profile = mergeProfile(profile, sanitizeExtracted(playbook, ex?.campos), i.triggerMessageId).profile
      notUnderstood = ex?.nao_entendeu === true
      signals.pediuHumano = ex?.pediu_humano === true
      signals.naoEntendeu = notUnderstood
      signals.objecaoId = str(ex?.objecao_id)
      signals.perguntaFatoId = str(ex?.pergunta_fato_id)
      // Pergunta que nenhum fato responde: um id que não existe no playbook. Depende de
      // decideAction mapear fato desconhecido para repassar_humano{sem_base}.
      if (!signals.perguntaFatoId && ex?.pergunta_sem_fato === true) signals.perguntaFatoId = SEM_FATO
    }

    const action = decideAction({ playbook, profile, signals, failedUnderstandingStreak: i.failedUnderstandingStreak })
    if (action.tipo === 'repassar_humano') return handoff(action.motivo)
    if (action.tipo === 'aguardar' || !playbook) return finish(action, '')

    const exemplos = buildExamplesMessage(i.examples)
    const writeMessages: Messages = exemplos ? [exemplos, ...messages] : messages
    const write = async (rejection?: { violations: Violation[]; motivo?: string }) => {
      const r = await call<{ texto?: unknown }>({
        system: buildWriteSystem({ playbook, playbookVersion: i.playbookVersion, profile, action, rejection }),
        messages: writeMessages,
        schemaName: 'redigir',
        schema: WRITE_SCHEMA,
        maxTokens: MAX_TOKENS.redigir,
      })
      return typeof r?.texto === 'string' ? r.texto.trim() : ''
    }
    const verify = async (draft: string) => {
      const r = await call<{ aprovado?: unknown; motivo?: unknown }>({
        system: buildVerifySystem(playbook, action),
        messages: [{ role: 'user', content: `RASCUNHO A REVISAR:\n${draft}` }],
        schemaName: 'verificar',
        schema: VERIFY_SCHEMA,
        maxTokens: MAX_TOKENS.verificar,
      })
      return { aprovado: r?.aprovado === true, motivo: typeof r?.motivo === 'string' ? r.motivo : '' }
    }

    // Uma única regeração por turno, compartilhada entre guarda-corpo e verificador.
    // Aprovados = fatos + agenda + resposta da objeção atual (o mesmo conteúdo que o prompt entrega ao modelo).
    const aprovados = approvedSources(playbook, action)
    let draft = await write()
    let regenerated = false
    for (;;) {
      const { violations, risky } = checkDraft(draft, aprovados)
      for (const v of violations) guardEvents.add(v)
      let rejection: { violations: Violation[]; motivo?: string } | null = null
      if (!draft) {
        guardEvents.add('rascunho_vazio')
        rejection = { violations, motivo: 'rascunho vazio' }
      } else if (violations.length) rejection = { violations }
      else if (risky) {
        const v = await verify(draft)
        if (!v.aprovado) {
          guardEvents.add('verificador_reprovou')
          rejection = { violations, motivo: v.motivo }
        }
      }
      if (!rejection) return finish(action, draft)
      if (regenerated) return handoff('guardacorpo', violations, action)
      regenerated = true
      draft = await write(rejection)
    }
  }
}
