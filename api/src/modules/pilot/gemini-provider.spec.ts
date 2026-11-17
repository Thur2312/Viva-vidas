import { GeminiDraftProvider, AnthropicDraftProvider, DisabledDraftProvider, createDraftProvider, DraftContext } from './shadow.service'

const ctx: DraftContext = {
  playbook: 'Seja cordial.',
  playbookVersion: 3,
  examples: [],
  history: [
    { author: 'lead', body: 'Oi' },
    { author: 'humano', body: 'Olá! Como posso ajudar?' },
    { author: 'lead', body: 'Quero um plano' },
  ],
  summary: null,
  lead: { name: null, stage: 'respondeu', qualification: {} },
}

describe('GeminiDraftProvider', () => {
  const realFetch = global.fetch
  afterEach(() => { global.fetch = realFetch })

  function mockFetch(body: unknown, ok = true, status = 200) {
    const calls: { url: string; init: any }[] = []
    global.fetch = (async (url: any, init: any) => {
      calls.push({ url: String(url), init })
      return { ok, status, json: async () => body } as any
    }) as any
    return calls
  }

  it('chama generateContent com a chave no cabeçalho e devolve o rascunho estruturado', async () => {
    const calls = mockFetch({
      candidates: [{ content: { parts: [{ text: JSON.stringify({ rascunho: 'Claro! Qual seu plano atual?', etapa: 'qualificado', qualificaria: true, proxima_acao: 'perguntar_plano_atual' }) }] } }],
    })
    const r = await new GeminiDraftProvider('k-secreta', 'gemini-x').generate(ctx)
    expect(r).toMatchObject({ draft: 'Claro! Qual seu plano atual?', stageGuess: 'qualificado', qualifiedGuess: true, nextAction: 'perguntar_plano_atual', model: 'gemini-x' })

    expect(calls[0].url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-x:generateContent')
    expect(calls[0].url).not.toContain('k-secreta')
    expect(calls[0].init.headers['x-goog-api-key']).toBe('k-secreta')
    const body = JSON.parse(calls[0].init.body)
    expect(body.contents.map((c: any) => c.role)).toEqual(['user', 'model', 'user'])
    expect(body.systemInstruction.parts[0].text).toContain('PLAYBOOK (v3)')
    expect(body.generationConfig.responseMimeType).toBe('application/json')
  })

  it('ignora etapa fora da lista em vez de gravar valor inválido', async () => {
    mockFetch({ candidates: [{ content: { parts: [{ text: JSON.stringify({ rascunho: 'Oi', etapa: 'inventada', qualificaria: false, proxima_acao: 'aguardar' }) }] } }] })
    const r = await new GeminiDraftProvider('k').generate(ctx)
    expect(r.stageGuess).toBeUndefined()
  })

  it('erro HTTP não vaza o corpo da resposta', async () => {
    mockFetch({ error: { message: 'Maria Oliveira 529.982.247-25' } }, false, 429)
    await expect(new GeminiDraftProvider('k').generate(ctx)).rejects.toThrow(/^Gemini 429$/)
  })

  it('rejeita resposta vazia, sem JSON ou sem rascunho', async () => {
    mockFetch({ candidates: [] })
    await expect(new GeminiDraftProvider('k').generate(ctx)).rejects.toThrow(/sem conteúdo/)
    mockFetch({ candidates: [{ content: { parts: [{ text: 'não é json' }] } }] })
    await expect(new GeminiDraftProvider('k').generate(ctx)).rejects.toThrow(/JSON/)
    mockFetch({ candidates: [{ content: { parts: [{ text: JSON.stringify({ rascunho: '  ' }) }] } }] })
    await expect(new GeminiDraftProvider('k').generate(ctx)).rejects.toThrow(/sem rascunho/)
  })

  it('exige mensagem do lead por último', async () => {
    mockFetch({})
    await expect(new GeminiDraftProvider('k').generate({ ...ctx, history: [{ author: 'humano', body: 'oi' }] })).rejects.toThrow(/Sem mensagem do lead/)
  })
})

describe('createDraftProvider', () => {
  it('prefere Gemini quando há GEMINI_API_KEY', () => {
    expect(createDraftProvider({ GEMINI_API_KEY: 'g', ANTHROPIC_API_KEY: 'a' } as any).provider).toBeInstanceOf(GeminiDraftProvider)
  })
  it('usa Anthropic só se for a única chave ou se LLM_PROVIDER=anthropic', () => {
    expect(createDraftProvider({ ANTHROPIC_API_KEY: 'a' } as any).provider).toBeInstanceOf(AnthropicDraftProvider)
    expect(createDraftProvider({ GEMINI_API_KEY: 'g', ANTHROPIC_API_KEY: 'a', LLM_PROVIDER: 'anthropic' } as any).provider).toBeInstanceOf(AnthropicDraftProvider)
  })
  it('LLM_PROVIDER=gemini sem chave desativa (não cai na Anthropic)', () => {
    const r = createDraftProvider({ LLM_PROVIDER: 'gemini', ANTHROPIC_API_KEY: 'a' } as any)
    expect(r.provider).toBeInstanceOf(DisabledDraftProvider)
    expect(r.warn).toMatch(/GEMINI_API_KEY/)
  })
  it('sem nenhuma chave, desativa', () => {
    expect(createDraftProvider({} as any).provider).toBeInstanceOf(DisabledDraftProvider)
  })
})
