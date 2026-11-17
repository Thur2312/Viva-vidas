import { ChatTurn, ReplyGenerator } from '../agent.types'
import { sseData } from './stream-utils'

type FetchLike = (url: string, init?: any) => Promise<any>

export const VOICE_SYSTEM_PROMPT = [
  'Você é um assistente virtual de atendimento por telefone de uma corretora de planos de saúde, falando em português do Brasil.',
  'Fale como numa ligação: no máximo duas frases curtas, sem listas, sem emojis, sem markdown, sem símbolos.',
  'Se perguntarem, diga com naturalidade que é um assistente virtual.',
  'Nunca peça nem comente dados de saúde do cliente; se ele tocar nesse assunto ou pedir uma pessoa, diga que vai chamar um atendente humano.',
  'Não invente preços, coberturas nem prazos: se não souber, diga que um atendente confirma.',
].join(' ')

export class GeminiNotConfiguredError extends Error {
  constructor() { super('Gemini não configurado: GEMINI_API_KEY') }
}

export interface GeminiVoiceOptions {
  model?: string
  systemPrompt?: string
  maxOutputTokens?: number
  temperature?: number
}

/**
 * Resposta em streaming do Gemini (`streamGenerateContent?alt=sse`) para o agente de voz.
 * UNTESTED contra o provedor real: escrito contra a documentação pública e testado só com `fetch` falso.
 * Transferência internacional (LGPD art. 33): o texto sai do Brasil; o chamador só deve enviar texto que passou
 * pelo `TextGate` (sem dado sensível) e sem identificação do lead.
 */
export class GeminiReplyGenerator implements ReplyGenerator {
  constructor(private readonly fetchImpl: FetchLike = (u, i) => fetch(u, i), private readonly opts: GeminiVoiceOptions = {}) {}

  private key(): string { return (process.env.GEMINI_API_KEY ?? '').trim() }
  private model(): string { return this.opts.model || (process.env.VOICE_LLM_MODEL ?? '').trim() || (process.env.PILOT_MODEL ?? '').trim() || 'gemini-2.5-flash' }

  async *stream({ history, userText, signal }: { history: ChatTurn[]; userText: string; signal: AbortSignal }): AsyncIterable<string> {
    const key = this.key()
    if (!key) throw new GeminiNotConfiguredError()
    const model = this.model()
    const contents = [
      ...history.map((t) => ({ role: t.role === 'agente' ? 'model' : 'user', parts: [{ text: t.text }] })),
      { role: 'user', parts: [{ text: userText }] },
    ]
    const generationConfig: Record<string, unknown> = {
      temperature: this.opts.temperature ?? 0.4,
      maxOutputTokens: this.opts.maxOutputTokens ?? 160,
    }
    // Família 2.5: desliga o "pensar" (custa centenas de ms antes do primeiro token). Outras famílias usam outro parâmetro.
    if (/2\.5/.test(model)) generationConfig.thinkingConfig = { thinkingBudget: 0 }

    const res = await this.fetchImpl(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: this.opts.systemPrompt ?? VOICE_SYSTEM_PROMPT }] },
          contents,
          generationConfig,
        }),
        signal,
      },
    )
    // Nunca repetir o corpo do erro: pode ecoar trechos da conversa.
    if (!res.ok) throw new Error(`Gemini respondeu HTTP ${res.status}`)

    for await (const data of sseData(res.body)) {
      if (signal.aborted) return
      let json: any
      try { json = JSON.parse(data) } catch { continue }
      const parts = json?.candidates?.[0]?.content?.parts
      if (!Array.isArray(parts)) continue
      const text = parts.map((p: any) => (typeof p?.text === 'string' ? p.text : '')).join('')
      if (text) yield text
    }
  }
}
