import { resolveAnthropicBaseUrl } from '../shadow.service'

export interface LlmCall {
  system: string
  messages: { role: 'user' | 'assistant'; content: string }[]
  schemaName: string
  schema: object
  maxTokens?: number
}

export interface LlmResult<T> {
  data: T
  model: string
  inputTokens: number
  outputTokens: number
}

export type LlmProviderName = 'anthropic' | 'gemini' | 'none'

export interface StructuredLlm {
  readonly enabled: boolean
  readonly provider: LlmProviderName
  call<T>(c: LlmCall): Promise<LlmResult<T>>
}

/** Mensagens nunca carregam corpo de resposta nem conteúdo da requisição (podem ecoar a conversa do lead). */
export class LlmError extends Error {
  constructor(
    message: string,
    public readonly code: 'http' | 'timeout' | 'invalid_json' | 'disabled',
    public readonly status?: number,
  ) {
    super(message)
    this.name = 'LlmError'
  }
}

export interface LlmOptions {
  timeoutMs?: number
  retryDelayMs?: number
}

const DEFAULT_MAX_TOKENS = 800

function envTimeout(): number {
  const n = Number(process.env.LLM_TIMEOUT_MS)
  return Number.isFinite(n) && n > 0 ? n : 20000
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** POST com timeout (AbortController) e 1 retry em 429/5xx. Devolve o JSON da resposta. */
async function postJson(
  label: string,
  url: string,
  headers: Record<string, string>,
  body: unknown,
  opts: Required<LlmOptions>,
): Promise<any> {
  for (let attempt = 0; ; attempt++) {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs)
    try {
      let res: Response
      try {
        res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: ctrl.signal })
      } catch (e: any) {
        if (ctrl.signal.aborted || e?.name === 'AbortError') throw new LlmError(`${label} timeout`, 'timeout')
        throw new LlmError(`${label} falha de rede`, 'http')
      }
      if (res.ok) {
        try {
          return await res.json()
        } catch {
          if (ctrl.signal.aborted) throw new LlmError(`${label} timeout`, 'timeout')
          throw new LlmError(`${label} resposta não é JSON`, 'invalid_json')
        }
      }
      const retryable = res.status === 429 || res.status >= 500
      if (!retryable || attempt >= 1) throw new LlmError(`${label} ${res.status}`, 'http', res.status)
    } finally {
      clearTimeout(timer)
    }
    await sleep(opts.retryDelayMs)
  }
}

function resolveOpts(o?: LlmOptions): Required<LlmOptions> {
  return { timeoutMs: o?.timeoutMs ?? envTimeout(), retryDelayMs: o?.retryDelayMs ?? 500 }
}

export class AnthropicLlm implements StructuredLlm {
  readonly enabled = true
  readonly provider = 'anthropic' as const
  private readonly opts: Required<LlmOptions>
  constructor(
    private readonly apiKey: string,
    private readonly model = process.env.PILOT_MODEL || 'claude-sonnet-5-5',
    private readonly baseUrl = resolveAnthropicBaseUrl(process.env.ANTHROPIC_BASE_URL),
    opts?: LlmOptions,
  ) {
    this.opts = resolveOpts(opts)
  }

  async call<T>(c: LlmCall): Promise<LlmResult<T>> {
    const json = await postJson(
      'Anthropic',
      `${this.baseUrl}/v1/messages`,
      { 'content-type': 'application/json', 'x-api-key': this.apiKey, 'anthropic-version': '2023-06-01' },
      {
        model: this.model,
        max_tokens: c.maxTokens ?? DEFAULT_MAX_TOKENS,
        system: c.system,
        messages: c.messages,
        tools: [{ name: c.schemaName, description: `Registra a saída estruturada (${c.schemaName}).`, input_schema: c.schema }],
        tool_choice: { type: 'tool', name: c.schemaName },
      },
      this.opts,
    )
    const block = json?.content?.find?.((b: any) => b?.type === 'tool_use')
    if (!block || block.input === undefined || block.input === null) throw new LlmError('Anthropic sem tool_use', 'invalid_json')
    return {
      data: block.input as T,
      model: this.model,
      inputTokens: Number(json.usage?.input_tokens) || 0,
      outputTokens: Number(json.usage?.output_tokens) || 0,
    }
  }
}

/** Converte JSON Schema padrão para o formato do Gemini (tipos em maiúsculas), recursivamente. */
export function toGeminiSchema(schema: any): any {
  if (!schema || typeof schema !== 'object') return schema
  const out: any = {}
  if (typeof schema.type === 'string') out.type = schema.type.toUpperCase()
  if (schema.description !== undefined) out.description = schema.description
  if (schema.enum !== undefined) out.enum = schema.enum
  if (schema.nullable !== undefined) out.nullable = schema.nullable
  if (schema.required !== undefined) out.required = schema.required
  if (schema.properties && typeof schema.properties === 'object') {
    out.properties = Object.fromEntries(Object.entries(schema.properties).map(([k, v]) => [k, toGeminiSchema(v)]))
  }
  if (schema.items !== undefined) out.items = toGeminiSchema(schema.items)
  return out
}

export class GeminiLlm implements StructuredLlm {
  readonly enabled = true
  readonly provider = 'gemini' as const
  private readonly opts: Required<LlmOptions>
  constructor(
    private readonly apiKey: string,
    private readonly model = process.env.PILOT_MODEL || 'gemini-2.5-flash',
    private readonly baseUrl = 'https://generativelanguage.googleapis.com',
    opts?: LlmOptions,
  ) {
    this.opts = resolveOpts(opts)
  }

  async call<T>(c: LlmCall): Promise<LlmResult<T>> {
    const json = await postJson(
      'Gemini',
      `${this.baseUrl}/v1beta/models/${encodeURIComponent(this.model)}:generateContent`,
      // Chave no cabeçalho (não na URL), para não cair em log de proxy/acesso.
      { 'content-type': 'application/json', 'x-goog-api-key': this.apiKey },
      {
        systemInstruction: { parts: [{ text: c.system }] },
        contents: c.messages.map((m) => ({ role: m.role === 'user' ? 'user' : 'model', parts: [{ text: m.content }] })),
        generationConfig: {
          maxOutputTokens: c.maxTokens ?? DEFAULT_MAX_TOKENS,
          temperature: 0.4,
          responseMimeType: 'application/json',
          responseSchema: toGeminiSchema(c.schema),
        },
      },
      this.opts,
    )
    const text = json?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text ?? '').join('')
    if (!text) throw new LlmError('Gemini sem conteúdo', 'invalid_json')
    let data: T
    try {
      data = JSON.parse(text)
    } catch {
      throw new LlmError('Gemini resposta não é JSON válido', 'invalid_json')
    }
    return {
      data,
      model: this.model,
      inputTokens: Number(json.usageMetadata?.promptTokenCount) || 0,
      outputTokens: Number(json.usageMetadata?.candidatesTokenCount) || 0,
    }
  }
}

class DisabledLlm implements StructuredLlm {
  readonly enabled = false
  readonly provider = 'none' as const
  async call<T>(_c: LlmCall): Promise<LlmResult<T>> {
    throw new LlmError('LLM desativado (sem chave configurada)', 'disabled')
  }
}

/** Mesma regra de createDraftProvider: LLM_PROVIDER força; senão Gemini, depois Anthropic, senão desativado. */
export function createStructuredLlm(env: NodeJS.ProcessEnv = process.env): StructuredLlm {
  const choice = (env.LLM_PROVIDER || '').trim().toLowerCase()
  const gemini = env.GEMINI_API_KEY
  const anthropic = env.ANTHROPIC_API_KEY
  if (choice === 'gemini' || (!choice && gemini)) return gemini ? new GeminiLlm(gemini) : new DisabledLlm()
  if (choice === 'anthropic' || (!choice && anthropic)) return anthropic ? new AnthropicLlm(anthropic) : new DisabledLlm()
  return new DisabledLlm()
}

export type FakeResponse = unknown | ((c: LlmCall) => unknown) | Error

/** Dublê para testes: fila de respostas, registra cada chamada. */
export class FakeLlm implements StructuredLlm {
  readonly enabled = true
  readonly provider = 'none' as const
  readonly calls: LlmCall[] = []
  private readonly queue: FakeResponse[]
  constructor(responses: FakeResponse[]) {
    this.queue = [...responses]
  }

  async call<T>(c: LlmCall): Promise<LlmResult<T>> {
    this.calls.push(c)
    if (!this.queue.length) throw new Error('FakeLlm: respostas esgotadas')
    const next = this.queue.shift()
    if (next instanceof Error) throw next
    const data = typeof next === 'function' ? (next as (c: LlmCall) => unknown)(c) : next
    return { data: data as T, model: 'fake', inputTokens: 10, outputTokens: 5 }
  }
}
