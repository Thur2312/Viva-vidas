import { Inject, Injectable, Logger, Optional } from '@nestjs/common'
import { PgService } from './pg.service'
import { PilotService } from './pilot.service'
import { CryptoService } from './compliance/crypto.service'
import { pseudonymize, pseudonymizeDeep, restoreLeadName } from './compliance/redaction'
import { BrainOutput, SalesBrain } from './brain/brain'
import { LlmError, StructuredLlm, createStructuredLlm, resolveAnthropicBaseUrl } from './brain/llm'
import { PlaybookData, Profile } from './brain/types'

export interface DraftContext {
  playbook: string | null
  playbookVersion: number | null
  examples: { situation: string; lead_message: string; human_reply: string }[]
  history: { author: string; body: string }[]
  summary: string | null
  lead: { name: string | null; stage: string; qualification: Record<string, unknown> }
}

export interface DraftResult {
  draft: string
  stageGuess?: string
  qualifiedGuess?: boolean
  nextAction?: string
  reasoning?: string
  model: string
}

export interface DraftProvider {
  readonly enabled: boolean
  generate(ctx: DraftContext): Promise<DraftResult>
}

/** Sem chave: não gera nada. O restante do pipeline (ingestão, comparação, métricas) segue funcionando. */
export class DisabledDraftProvider implements DraftProvider {
  readonly enabled = false
  async generate(): Promise<DraftResult> {
    throw new Error('Provedor de rascunho desativado')
  }
}

// Definida em brain/llm.ts (sem import circular); reexportada aqui para os consumidores antigos.
export { resolveAnthropicBaseUrl }

/**
 * Claude via Messages API, com tool use forçado para devolver o rascunho estruturado.
 * ATENÇÃO: ainda NÃO foi exercitado contra a API real (sem chave no ambiente de desenvolvimento).
 */
export class AnthropicDraftProvider implements DraftProvider {
  readonly enabled = true
  constructor(
    private readonly apiKey: string,
    private readonly model = process.env.PILOT_MODEL || 'claude-sonnet-5-5',
    private readonly baseUrl = resolveAnthropicBaseUrl(process.env.ANTHROPIC_BASE_URL),
  ) {}

  async generate(ctx: DraftContext): Promise<DraftResult> {
    const system = buildSystemPrompt(ctx)
    const messages = buildMessages(ctx)

    const res = await fetch(`${this.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': this.apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 800,
        system,
        messages,
        tools: [
          {
            name: 'registrar_rascunho',
            description: 'Registra o rascunho de resposta e a leitura do agente sobre o lead.',
            input_schema: {
              type: 'object',
              properties: {
                rascunho: { type: 'string', description: 'Texto da resposta que seria enviada ao lead' },
                etapa: { type: 'string', enum: ['contatado', 'respondeu', 'qualificado', 'reuniao', 'compareceu', 'venda', 'perdido'] },
                qualificaria: { type: 'boolean', description: 'O agente qualificaria este lead agora?' },
                proxima_acao: { type: 'string', description: 'perguntar_plano_atual, propor_horario, repassar_humano, aguardar...' },
                raciocinio: { type: 'string' },
              },
              required: ['rascunho', 'etapa', 'qualificaria', 'proxima_acao'],
            },
          },
        ],
        tool_choice: { type: 'tool', name: 'registrar_rascunho' },
      }),
    })
    // Não repete o corpo da resposta de erro: ele pode ecoar trechos da conversa.
    if (!res.ok) throw new Error(`Anthropic ${res.status}`)
    const json: any = await res.json()
    const block = json.content?.find((b: any) => b.type === 'tool_use')
    if (!block) throw new Error('Resposta sem tool_use')
    const i = block.input
    return { draft: i.rascunho, stageGuess: i.etapa, qualifiedGuess: i.qualificaria, nextAction: i.proxima_acao, reasoning: i.raciocinio, model: this.model }
  }
}

/** Prompt de sistema comum a todos os provedores. */
export function buildSystemPrompt(ctx: DraftContext): string {
  return [
    'Você é o agente comercial de uma corretora de planos de saúde, em MODO SOMBRA: nada que você escreve é enviado.',
    'Escreva como o colaborador humano escreveria, seguindo o playbook e os exemplos reais abaixo. Mensagens curtas e naturais, uma pergunta por vez.',
    'Nunca invente preços, coberturas ou prazos. Se não houver base segura, a próxima ação é repassar ao humano.',
    ctx.playbook ? `PLAYBOOK (v${ctx.playbookVersion}):\n${ctx.playbook}` : 'PLAYBOOK: ainda não definido.',
    ctx.examples.length
      ? 'EXEMPLOS REAIS APROVADOS:\n' +
        ctx.examples.map((e, i) => `${i + 1}. Situação: ${e.situation}\n   Lead: ${e.lead_message}\n   Colaborador: ${e.human_reply}`).join('\n')
      : '',
    ctx.summary ? `RESUMO DA CONVERSA ATÉ AQUI:\n${ctx.summary}` : '',
  ].filter(Boolean).join('\n\n')
}

/** Últimas 20 mensagens; a conversa precisa começar e terminar em 'user' (o lead). */
export function buildMessages(ctx: DraftContext): { role: 'user' | 'assistant'; content: string }[] {
  const messages = ctx.history.slice(-20).map((m) => ({
    role: m.author === 'lead' ? ('user' as const) : ('assistant' as const),
    content: m.body,
  }))
  while (messages.length && messages[0].role !== 'user') messages.shift()
  if (!messages.length || messages[messages.length - 1].role !== 'user') throw new Error('Sem mensagem do lead para responder')
  return messages
}

const STAGES = ['contatado', 'respondeu', 'qualificado', 'reuniao', 'compareceu', 'venda', 'perdido']

/**
 * Gemini via generateContent, com saída JSON estruturada (responseSchema).
 * Chave em GEMINI_API_KEY; modelo em PILOT_MODEL. O conteúdo já chega pseudonimizado (ver ShadowService.run).
 */
export class GeminiDraftProvider implements DraftProvider {
  readonly enabled = true
  constructor(
    private readonly apiKey: string,
    private readonly model = process.env.PILOT_MODEL || 'gemini-2.5-flash',
    private readonly baseUrl = 'https://generativelanguage.googleapis.com',
  ) {}

  async generate(ctx: DraftContext): Promise<DraftResult> {
    const system = buildSystemPrompt(ctx)
    const messages = buildMessages(ctx)
    const url = `${this.baseUrl}/v1beta/models/${encodeURIComponent(this.model)}:generateContent`
    const res = await fetch(url, {
      method: 'POST',
      // Chave no cabeçalho (não na URL), para não cair em log de proxy/acesso.
      headers: { 'content-type': 'application/json', 'x-goog-api-key': this.apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: messages.map((m) => ({ role: m.role === 'user' ? 'user' : 'model', parts: [{ text: m.content }] })),
        generationConfig: {
          maxOutputTokens: 800,
          temperature: 0.4,
          responseMimeType: 'application/json',
          responseSchema: {
            type: 'OBJECT',
            properties: {
              rascunho: { type: 'STRING', description: 'Texto da resposta que seria enviada ao lead' },
              etapa: { type: 'STRING', enum: STAGES },
              qualificaria: { type: 'BOOLEAN', description: 'O agente qualificaria este lead agora?' },
              proxima_acao: { type: 'STRING', description: 'perguntar_plano_atual, propor_horario, repassar_humano, aguardar...' },
              raciocinio: { type: 'STRING' },
            },
            required: ['rascunho', 'etapa', 'qualificaria', 'proxima_acao'],
          },
        },
      }),
    })
    // Não repete o corpo da resposta de erro: ele pode ecoar trechos da conversa.
    if (!res.ok) throw new Error(`Gemini ${res.status}`)
    const json: any = await res.json()
    const text = json.candidates?.[0]?.content?.parts?.map((p: any) => p.text ?? '').join('')
    if (!text) throw new Error('Resposta do Gemini sem conteúdo')
    let i: any
    try { i = JSON.parse(text) } catch { throw new Error('Resposta do Gemini não é JSON válido') }
    if (typeof i.rascunho !== 'string' || !i.rascunho.trim()) throw new Error('Resposta do Gemini sem rascunho')
    return {
      draft: i.rascunho,
      stageGuess: STAGES.includes(i.etapa) ? i.etapa : undefined,
      qualifiedGuess: typeof i.qualificaria === 'boolean' ? i.qualificaria : undefined,
      nextAction: typeof i.proxima_acao === 'string' ? i.proxima_acao : undefined,
      reasoning: typeof i.raciocinio === 'string' ? i.raciocinio : undefined,
      model: this.model,
    }
  }
}

/**
 * Escolhe o provedor. LLM_PROVIDER=gemini|anthropic força a escolha; sem ele, Gemini se houver
 * GEMINI_API_KEY, senão Anthropic se houver ANTHROPIC_API_KEY, senão desativado.
 */
export function createDraftProvider(env: NodeJS.ProcessEnv = process.env): { provider: DraftProvider; warn?: string } {
  const choice = (env.LLM_PROVIDER || '').trim().toLowerCase()
  const gemini = env.GEMINI_API_KEY
  const anthropic = env.ANTHROPIC_API_KEY
  if (choice === 'gemini' || (!choice && gemini)) {
    return gemini
      ? { provider: new GeminiDraftProvider(gemini) }
      : { provider: new DisabledDraftProvider(), warn: 'LLM_PROVIDER=gemini sem GEMINI_API_KEY: rascunhos em modo sombra desativados' }
  }
  if (choice === 'anthropic' || (!choice && anthropic)) {
    return anthropic
      ? { provider: new AnthropicDraftProvider(anthropic) }
      : { provider: new DisabledDraftProvider(), warn: 'LLM_PROVIDER=anthropic sem ANTHROPIC_API_KEY: rascunhos em modo sombra desativados' }
  }
  return { provider: new DisabledDraftProvider(), warn: 'Nenhuma chave de LLM (GEMINI_API_KEY/ANTHROPIC_API_KEY): rascunhos em modo sombra desativados' }
}

/** Token opcional de DI para trocar o LLM estruturado (testes). Sem provider registrado, cai em createStructuredLlm(). */
export const STRUCTURED_LLM = 'STRUCTURED_LLM'

/** Quantas decisões recentes bastam para medir a sequência de "não entendi" (a política repassa com 2). */
const STREAK_LOOKBACK = 10

export type ShadowRunResult =
  | { status: 'drafted'; draftId: number }
  | { status: 'disabled' | 'no_inbound' | 'already_drafted' | 'opt_out' | 'stale' | 'llm_error' }

const isPlainObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

@Injectable()
export class ShadowService {
  private readonly log = new Logger(ShadowService.name)
  private readonly crypto: CryptoService
  private readonly llm: StructuredLlm
  private readonly brain: SalesBrain

  constructor(
    private readonly pg: PgService,
    private readonly pilot: PilotService,
    @Optional() crypto?: CryptoService,
    @Optional() @Inject(STRUCTURED_LLM) llm?: StructuredLlm,
  ) {
    this.crypto = crypto ?? new CryptoService()
    this.llm = llm ?? createStructuredLlm()
    this.brain = new SalesBrain(this.llm)
    if (!this.llm.enabled) this.log.warn('Nenhuma chave de LLM utilizável (GEMINI_API_KEY/ANTHROPIC_API_KEY): rascunhos em modo sombra desativados')
  }

  status() {
    return { enabled: this.llm.enabled, mode: 'shadow' as const, provider: this.llm.provider }
  }

  /** Gera o rascunho para a última mensagem do lead na conversa, sem enviar nada. */
  async run(conversationId: string): Promise<ShadowRunResult> {
    if (!this.llm.enabled) return { status: 'disabled' }
    this.crypto.assertReady()

    const last = (
      await this.pg.query(
        `SELECT m.id, m.body, m.contains_sensitive FROM horizon_agent.messages m
         WHERE m.conversation_id = $1 AND m.author = 'lead' ORDER BY m.created_at DESC, m.id DESC LIMIT 1`,
        [conversationId],
      )
    ).rows[0]
    if (!last) return { status: 'no_inbound' }
    const triggerId = Number(last.id)

    const lead = (
      await this.pg.query(
        `SELECT l.id, l.name, l.phone, l.stage, l.qualification, l.opt_out, l.anonymized_at FROM horizon_agent.conversations c
         JOIN horizon_agent.leads l ON l.id = c.lead_id WHERE c.id = $1`,
        [conversationId],
      )
    ).rows[0]
    // Titular que pediu para não ser contatado (ou já anonimizado) não tem a conversa enviada ao provedor.
    if (!lead || lead.opt_out || lead.anonymized_at) return { status: 'opt_out' }

    // Rascunho obsoleto: se alguém (humano/agente) já falou depois do lead, não há o que rascunhar.
    const newest = (
      await this.pg.query(
        `SELECT m.id, m.author FROM horizon_agent.messages m
         WHERE m.conversation_id = $1 ORDER BY m.created_at DESC, m.id DESC LIMIT 1`,
        [conversationId],
      )
    ).rows[0]
    if (!newest || Number(newest.id) !== triggerId) return { status: 'stale' }

    // Atalho barato antes de gastar LLM; a garantia real contra corrida é o ON CONFLICT do INSERT abaixo.
    const already = await this.pg.query(`SELECT 1 FROM horizon_agent.agent_drafts WHERE trigger_message_id = $1`, [triggerId])
    if (already.rowCount) return { status: 'already_drafted' }

    // Não existe mais o bloqueio permanente "sensitive_human_only" (ver design do cérebro de vendas): mensagens
    // sensíveis viram marcador no cérebro e, se a última do lead for sensível, o turno é repassado a um humano.
    // O corpo sensível nem é lido do banco aqui: só a posição dele na conversa.
    const history = (
      await this.pg.query(
        `SELECT id, author, contains_sensitive, CASE WHEN contains_sensitive THEN NULL ELSE body END AS body
         FROM horizon_agent.messages WHERE conversation_id = $1 ORDER BY created_at, id`,
        [conversationId],
      )
    ).rows

    const streakRows = (
      await this.pg.query(
        `SELECT not_understood FROM horizon_agent.agent_drafts
         WHERE conversation_id = $1 ORDER BY created_at DESC, id DESC LIMIT ${STREAK_LOOKBACK}`,
        [conversationId],
      )
    ).rows
    let failedUnderstandingStreak = 0
    for (const r of streakRows) {
      if (r.not_understood !== true) break
      failedUnderstandingStreak++
    }

    const playbook = (await this.pg.query(`SELECT version, data FROM horizon_agent.playbook_versions WHERE active`)).rows[0]
    const examples = last.contains_sensitive
      ? []
      : (
          await this.pg.query(
            `SELECT situation, lead_message, human_reply FROM horizon_agent.learned_examples
             WHERE approved AND NOT contains_sensitive AND fts @@ plainto_tsquery('portuguese', $1)
             ORDER BY ts_rank(fts, plainto_tsquery('portuguese', $1)) DESC LIMIT 5`,
            [this.crypto.decrypt(last.body)],
          )
        ).rows

    const qualification = isPlainObject(lead.qualification) ? lead.qualification : {}
    const storedProfile = (isPlainObject(qualification.perfil) ? qualification.perfil : {}) as Profile

    // Pseudonimização ANTES do provedor (transferência internacional, art. 33): nome e telefone do lead
    // viram [LEAD]/[TELEFONE], e CPF, e-mail, cartão etc. são mascarados. O provedor nunca vê identificador direto.
    const who = { name: lead.name, phone: lead.phone }
    const profileIn = pseudonymizeDeep(storedProfile, who)
    let out: BrainOutput
    try {
      out = await this.brain.decide({
        playbook: (playbook?.data ?? null) as PlaybookData | null,
        playbookVersion: playbook?.version ?? null,
        profile: profileIn,
        history: history.map((m) => ({
          author: m.author,
          id: Number(m.id),
          sensitive: m.contains_sensitive === true,
          // Sensível: corpo vazio; o cérebro troca pelo marcador e mantém a ordem da conversa.
          body: m.contains_sensitive ? '' : pseudonymize(this.crypto.decrypt(m.body), who),
        })),
        // conversations.summary ainda não é escrito por ninguém; e o cérebro o repassa literalmente ao LLM,
        // então um resumo futuro poderia levar conteúdo sensível. Até haver um resumo seguro, não se envia.
        summary: null,
        examples: examples.map((e) => ({
          situation: pseudonymize(e.situation, who),
          lead_message: pseudonymize(e.lead_message, who),
          human_reply: pseudonymize(e.human_reply, who),
        })),
        failedUnderstandingStreak,
        triggerMessageId: triggerId,
      })
    } catch (e) {
      if (e instanceof LlmError) {
        // Só código/status: nunca a mensagem da conversa nem o corpo da resposta do provedor.
        this.log.warn(`LlmError code=${e.code} status=${e.status ?? '-'}`)
        return { status: 'llm_error' }
      }
      throw e
    }
    // Localmente, devolve o primeiro nome ao rascunho para ele ser comparável com a fala real do colaborador.
    const draftText = restoreLeadName(out.draft, lead.name)

    // Rascunho vazio (ação 'aguardar') também é gravado, para dedupe e telemetria.
    // Consumidores (painel, comparação com a resposta humana) devem ignorar rascunhos vazios.
    const ins = await this.pg.query(
      `INSERT INTO horizon_agent.agent_drafts
         (conversation_id, trigger_message_id, draft_body, model, playbook_version, stage_guess, qualified_guess, next_action_guess,
          action, objection_id, asked_field, handoff_reason, guard_violations, prompt_hash, input_tokens, output_tokens, calls, not_understood)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$15,$16,$17,$18)
       ON CONFLICT (trigger_message_id) DO NOTHING RETURNING id`,
      [
        conversationId, triggerId, this.crypto.encrypt(draftText), out.model, playbook?.version ?? null, out.stageGuess, out.qualifiedGuess,
        out.action.tipo, out.action.tipo, out.objectionId, out.askedField, out.handoffReason, JSON.stringify(out.violations), out.promptHash,
        out.inputTokens, out.outputTokens, out.calls, out.notUnderstood,
      ],
    )
    if (!ins.rows.length) return { status: 'already_drafted' }

    // Só as entradas que o cérebro mudou (comparadas ao que ele recebeu): não regrava entradas antigas com a
    // versão pseudonimizada. Entradas guardam valor curto, confiança e msgId; nunca texto livre do lead.
    const changed: Profile = {}
    for (const [k, v] of Object.entries(out.profile)) {
      if (JSON.stringify(v) !== JSON.stringify(profileIn[k])) changed[k] = v
    }
    if (Object.keys(changed).length) {
      await this.pg.query(
        `UPDATE horizon_agent.leads
         SET qualification = qualification || jsonb_build_object('perfil', coalesce(qualification->'perfil','{}'::jsonb) || $2::jsonb)
         WHERE id = $1`,
        [lead.id, JSON.stringify(changed)],
      )
    }
    return { status: 'drafted', draftId: Number(ins.rows[0].id) }
  }
}
