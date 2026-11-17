import { Injectable, Logger, Optional } from '@nestjs/common'
import { PgService } from './pg.service'
import { PilotService } from './pilot.service'
import { CryptoService } from './compliance/crypto.service'
import { pseudonymize, pseudonymizeDeep, restoreLeadName } from './compliance/redaction'

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

/**
 * Claude via Messages API, com tool use forçado para devolver o rascunho estruturado.
 * ATENÇÃO: ainda NÃO foi exercitado contra a API real (sem chave no ambiente de desenvolvimento).
 */
export class AnthropicDraftProvider implements DraftProvider {
  readonly enabled = true
  constructor(private readonly apiKey: string, private readonly model = process.env.PILOT_MODEL || 'claude-sonnet-5-5') {}

  async generate(ctx: DraftContext): Promise<DraftResult> {
    const system = [
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

    const messages = ctx.history.slice(-20).map((m) => ({
      role: m.author === 'lead' ? ('user' as const) : ('assistant' as const),
      content: m.body,
    }))
    // A API exige que a conversa comece e termine em 'user'.
    while (messages.length && messages[0].role !== 'user') messages.shift()
    if (!messages.length || messages[messages.length - 1].role !== 'user') throw new Error('Sem mensagem do lead para responder')

    const res = await fetch('https://api.anthropic.com/v1/messages', {
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

@Injectable()
export class ShadowService {
  private readonly log = new Logger(ShadowService.name)
  readonly provider: DraftProvider

  private readonly crypto: CryptoService

  constructor(private readonly pg: PgService, private readonly pilot: PilotService, @Optional() crypto?: CryptoService) {
    this.crypto = crypto ?? new CryptoService()
    const key = process.env.ANTHROPIC_API_KEY
    this.provider = key ? new AnthropicDraftProvider(key) : new DisabledDraftProvider()
    if (!key) this.log.warn('ANTHROPIC_API_KEY ausente: rascunhos em modo sombra desativados')
  }

  status() {
    return { enabled: this.provider.enabled, mode: 'shadow' as const }
  }

  /** Gera o rascunho para a última mensagem do lead na conversa, sem enviar nada. */
  async run(conversationId: string) {
    if (!this.provider.enabled) return { status: 'disabled' as const }
    this.crypto.assertReady()

    const last = (
      await this.pg.query(
        `SELECT m.id, m.body FROM horizon_agent.messages m
         WHERE m.conversation_id = $1 AND m.author = 'lead' ORDER BY m.created_at DESC LIMIT 1`,
        [conversationId],
      )
    ).rows[0]
    if (!last) return { status: 'no_inbound' as const }
    last.body = this.crypto.decrypt(last.body)

    const already = await this.pg.query(`SELECT 1 FROM horizon_agent.agent_drafts WHERE trigger_message_id = $1`, [last.id])
    if (already.rowCount) return { status: 'already_drafted' as const }

    const lead = (
      await this.pg.query(
        `SELECT l.name, l.phone, l.stage, l.qualification, l.opt_out, l.anonymized_at, c.summary FROM horizon_agent.conversations c
         JOIN horizon_agent.leads l ON l.id = c.lead_id WHERE c.id = $1`,
        [conversationId],
      )
    ).rows[0]
    // Titular que pediu para não ser contatado (ou já anonimizado) não tem a conversa enviada ao provedor.
    if (lead.opt_out || lead.anonymized_at) return { status: 'opt_out' as const }
    // Dado sensível (saúde, art. 11): conversa com qualquer mensagem marcada NÃO sai para o provedor de LLM.
    // Fica para o humano. A marcação é por lista de termos (pode haver falso negativo); só sinaliza, não prova ausência.
    const sensitive = await this.pg.query(
      `SELECT 1 FROM horizon_agent.messages WHERE conversation_id = $1 AND contains_sensitive LIMIT 1`,
      [conversationId],
    )
    if (sensitive.rowCount) return { status: 'sensitive_human_only' as const }
    const history = (
      await this.pg.query(`SELECT author, body FROM horizon_agent.messages WHERE conversation_id = $1 ORDER BY created_at`, [conversationId])
    ).rows.map((m) => ({ author: m.author, body: this.crypto.decrypt(m.body) }))
    const playbook = (await this.pg.query(`SELECT version, body FROM horizon_agent.playbook_versions WHERE active`)).rows[0]
    const examples = (
      await this.pg.query(
        `SELECT situation, lead_message, human_reply FROM horizon_agent.learned_examples
         WHERE approved AND NOT contains_sensitive AND fts @@ plainto_tsquery('portuguese', $1)
         ORDER BY ts_rank(fts, plainto_tsquery('portuguese', $1)) DESC LIMIT 5`,
        [last.body],
      )
    ).rows

    // Pseudonimização ANTES do provedor (transferência internacional, art. 33): nome e telefone do lead
    // viram [LEAD]/[TELEFONE], e CPF, e-mail, cartão etc. são mascarados. O provedor nunca vê identificador direto.
    const who = { name: lead.name, phone: lead.phone }
    const out = await this.provider.generate({
      playbook: playbook?.body ?? null,
      playbookVersion: playbook?.version ?? null,
      examples: examples.map((e) => ({
        situation: pseudonymize(e.situation, who),
        lead_message: pseudonymize(e.lead_message, who),
        human_reply: pseudonymize(e.human_reply, who),
      })),
      history: history.map((m) => ({ author: m.author, body: pseudonymize(m.body, who) })),
      summary: lead.summary ? pseudonymize(lead.summary, who) : null,
      lead: { name: lead.name ? '[LEAD]' : null, stage: lead.stage, qualification: pseudonymizeDeep(lead.qualification, who) },
    })
    // Localmente, devolve o primeiro nome ao rascunho para ele ser comparável com a fala real do colaborador.
    const draftText = restoreLeadName(out.draft, lead.name)

    const ins = await this.pg.query(
      `INSERT INTO horizon_agent.agent_drafts
         (conversation_id, trigger_message_id, draft_body, model, playbook_version, stage_guess, qualified_guess, next_action_guess, reasoning)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [conversationId, last.id, this.crypto.encrypt(draftText), out.model, playbook?.version ?? null, out.stageGuess ?? null, out.qualifiedGuess ?? null, out.nextAction ?? null, out.reasoning ?? null],
    )
    return { status: 'drafted' as const, draftId: Number(ins.rows[0].id) }
  }
}
