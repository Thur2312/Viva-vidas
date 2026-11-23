import {
  AnthropicLlm,
  FakeLlm,
  GeminiLlm,
  LlmCall,
  LlmError,
  createStructuredLlm,
  toGeminiSchema,
} from './llm'

const realFetch = global.fetch

function mockFetch(responses: Array<{ status?: number; body?: any; text?: string }>) {
  const fn = jest.fn(async (_url: any, _init?: any) => {
    const r = responses.shift()
    if (!r) throw new Error('sem resposta')
    const status = r.status ?? 200
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => {
        if (r.text !== undefined) throw new Error('bad json')
        return r.body
      },
    } as any
  })
  global.fetch = fn as any
  return fn
}

const schema = {
  type: 'object',
  properties: { resposta: { type: 'string' } },
  required: ['resposta'],
}
const call: LlmCall = {
  system: 'sys',
  messages: [{ role: 'user', content: 'oi' }],
  schemaName: 'registrar',
  schema,
}

afterEach(() => {
  global.fetch = realFetch
})

describe('AnthropicLlm', () => {
  const mk = (extra: Partial<{ timeoutMs: number }> = {}) =>
    new AnthropicLlm('k-ant', 'claude-x', 'https://api.anthropic.com', { retryDelayMs: 1, timeoutMs: 1000, ...extra })

  it('envia tool forçada e lê tokens', async () => {
    const f = mockFetch([
      { body: { content: [{ type: 'tool_use', input: { resposta: 'ola' } }], usage: { input_tokens: 11, output_tokens: 7 } } },
    ])
    const r = await mk().call<{ resposta: string }>({ ...call, maxTokens: 300 })
    expect(r).toEqual({ data: { resposta: 'ola' }, model: 'claude-x', inputTokens: 11, outputTokens: 7 })
    const [url, init] = f.mock.calls[0]
    expect(url).toBe('https://api.anthropic.com/v1/messages')
    expect(init.headers['x-api-key']).toBe('k-ant')
    expect(init.headers['anthropic-version']).toBe('2023-06-01')
    const body = JSON.parse(init.body)
    expect(body.tools).toEqual([{ name: 'registrar', description: expect.any(String), input_schema: schema }])
    expect(body.tool_choice).toEqual({ type: 'tool', name: 'registrar' })
    expect(body.max_tokens).toBe(300)
    expect(body.system).toBe('sys')
  })

  it('429 uma vez e depois 200 -> sucesso com 2 fetches', async () => {
    const f = mockFetch([
      { status: 429, body: {} },
      { body: { content: [{ type: 'tool_use', input: { resposta: 'x' } }], usage: { input_tokens: 1, output_tokens: 1 } } },
    ])
    const r = await mk().call(call)
    expect(r.data).toEqual({ resposta: 'x' })
    expect(f).toHaveBeenCalledTimes(2)
  })

  it('500 duas vezes -> LlmError http 500, sem eco do corpo', async () => {
    const f = mockFetch([
      { status: 500, body: { error: 'SEGREDO-DO-LEAD' } },
      { status: 500, body: { error: 'SEGREDO-DO-LEAD' } },
    ])
    const err: any = await mk().call(call).catch((e) => e)
    expect(err).toBeInstanceOf(LlmError)
    expect(err.code).toBe('http')
    expect(err.status).toBe(500)
    expect(err.message).toBe('Anthropic 500')
    expect(err.message).not.toContain('SEGREDO')
    expect(f).toHaveBeenCalledTimes(2)
  })

  it('400 não faz retry', async () => {
    const f = mockFetch([{ status: 400, body: {} }])
    const err: any = await mk().call(call).catch((e) => e)
    expect(err.code).toBe('http')
    expect(err.status).toBe(400)
    expect(f).toHaveBeenCalledTimes(1)
  })

  it('sem tool_use -> invalid_json', async () => {
    mockFetch([{ body: { content: [{ type: 'text', text: 'x' }], usage: {} } }])
    const err: any = await mk().call(call).catch((e) => e)
    expect(err.code).toBe('invalid_json')
  })

  it('timeout -> LlmError timeout', async () => {
    global.fetch = jest.fn((_u: any, init: any) =>
      new Promise((_res, rej) => {
        init.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })))
      }),
    ) as any
    const err: any = await mk({ timeoutMs: 20 }).call(call).catch((e) => e)
    expect(err).toBeInstanceOf(LlmError)
    expect(err.code).toBe('timeout')
  })
})

describe('GeminiLlm', () => {
  const mk = () => new GeminiLlm('k-gem', 'gemini-x', 'https://generativelanguage.googleapis.com', { retryDelayMs: 1, timeoutMs: 1000 })

  it('envia responseSchema em maiúsculas, chave no header, e lê tokens', async () => {
    const f = mockFetch([
      {
        body: {
          candidates: [{ content: { parts: [{ text: '{"resposta":"oi"}' }] } }],
          usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 9 },
        },
      },
    ])
    const r = await mk().call(call)
    expect(r).toEqual({ data: { resposta: 'oi' }, model: 'gemini-x', inputTokens: 20, outputTokens: 9 })
    const [url, init] = f.mock.calls[0]
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-x:generateContent')
    expect(String(url)).not.toContain('k-gem')
    expect(init.headers['x-goog-api-key']).toBe('k-gem')
    const body = JSON.parse(init.body)
    expect(body.generationConfig.responseMimeType).toBe('application/json')
    expect(body.generationConfig.responseSchema.type).toBe('OBJECT')
    expect(body.generationConfig.responseSchema.properties.resposta.type).toBe('STRING')
    expect(body.systemInstruction.parts[0].text).toBe('sys')
    expect(body.contents[0]).toEqual({ role: 'user', parts: [{ text: 'oi' }] })
  })

  it('texto não-JSON -> invalid_json', async () => {
    mockFetch([{ body: { candidates: [{ content: { parts: [{ text: 'não é json' }] } }] } }])
    const err: any = await mk().call(call).catch((e) => e)
    expect(err.code).toBe('invalid_json')
  })

  it('503 duas vezes -> http 503 com mensagem sem corpo', async () => {
    mockFetch([
      { status: 503, body: { error: 'SEGREDO' } },
      { status: 503, body: { error: 'SEGREDO' } },
    ])
    const err: any = await mk().call(call).catch((e) => e)
    expect(err.code).toBe('http')
    expect(err.status).toBe(503)
    expect(err.message).toBe('Gemini 503')
  })
})

describe('toGeminiSchema', () => {
  it('converte recursivamente', () => {
    const out = toGeminiSchema({
      type: 'object',
      properties: {
        a: { type: 'string', enum: ['x', 'y'], description: 'd' },
        b: { type: 'array', items: { type: 'object', properties: { n: { type: 'integer' } }, required: ['n'] } },
        c: { type: 'number', nullable: true },
        d: { type: 'boolean' },
      },
      required: ['a'],
    })
    expect(out).toEqual({
      type: 'OBJECT',
      properties: {
        a: { type: 'STRING', enum: ['x', 'y'], description: 'd' },
        b: { type: 'ARRAY', items: { type: 'OBJECT', properties: { n: { type: 'INTEGER' } }, required: ['n'] } },
        c: { type: 'NUMBER', nullable: true },
        d: { type: 'BOOLEAN' },
      },
      required: ['a'],
    })
  })
})

describe('createStructuredLlm', () => {
  it('seleção por provedor', () => {
    expect(createStructuredLlm({ LLM_PROVIDER: 'gemini', GEMINI_API_KEY: 'g', ANTHROPIC_API_KEY: 'a' }).provider).toBe('gemini')
    expect(createStructuredLlm({ LLM_PROVIDER: 'anthropic', GEMINI_API_KEY: 'g', ANTHROPIC_API_KEY: 'a' }).provider).toBe('anthropic')
    expect(createStructuredLlm({ GEMINI_API_KEY: 'g', ANTHROPIC_API_KEY: 'a' }).provider).toBe('gemini')
    expect(createStructuredLlm({ ANTHROPIC_API_KEY: 'a' }).provider).toBe('anthropic')
  })

  it('sem chave: desativado e call lança disabled', async () => {
    const llm = createStructuredLlm({})
    expect(llm.enabled).toBe(false)
    expect(llm.provider).toBe('none')
    const err: any = await llm.call(call).catch((e) => e)
    expect(err).toBeInstanceOf(LlmError)
    expect(err.code).toBe('disabled')
    expect(createStructuredLlm({ LLM_PROVIDER: 'gemini' }).enabled).toBe(false)
  })
})

describe('FakeLlm', () => {
  it('registra chamadas, aceita objeto/função/Error e esgota', async () => {
    const llm = new FakeLlm([{ a: 1 }, (c: LlmCall) => ({ echo: c.schemaName }), new Error('boom')])
    expect(await llm.call(call)).toEqual({ data: { a: 1 }, model: 'fake', inputTokens: 10, outputTokens: 5 })
    expect((await llm.call(call)).data).toEqual({ echo: 'registrar' })
    await expect(llm.call(call)).rejects.toThrow('boom')
    await expect(llm.call(call)).rejects.toThrow(/esgot/i)
    expect(llm.calls).toHaveLength(4)
    expect(llm.enabled).toBe(true)
  })
})

describe('grafo de imports', () => {
  it('llm.ts não carrega shadow.service (sem import circular nem grafo Nest/pg no eval)', () => {
    jest.isolateModules(() => {
      jest.doMock('../shadow.service', () => {
        throw new Error('llm.ts não deve importar shadow.service')
      })
      const m = require('./llm')
      expect(m.resolveAnthropicBaseUrl('http://example.com')).toBe('https://api.anthropic.com')
      expect(m.resolveAnthropicBaseUrl('https://gw.local/')).toBe('https://gw.local')
    })
    jest.dontMock('../shadow.service')
  })

  it('shadow.service continua reexportando resolveAnthropicBaseUrl', () => {
    const shadow = require('../shadow.service')
    const llm = require('./llm')
    expect(shadow.resolveAnthropicBaseUrl).toBe(llm.resolveAnthropicBaseUrl)
  })
})
