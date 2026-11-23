import { ShadowService } from './shadow.service'
import { SalesBrain, BrainInput } from './brain/brain'
import { FakeLlm, FakeResponse, LlmError } from './brain/llm'
import { HANDOFF_TEXT, SENSITIVE_PLACEHOLDER } from './brain/prompts'
import { testPlaybook } from './brain/fixtures/test-playbook'

const CONV = '00000000-0000-4000-8000-000000000000'

type Msg = { id: string; author: 'lead' | 'humano' | 'agente'; body: string; contains_sensitive?: boolean }

interface Scenario {
  messages: Msg[]
  lead?: Record<string, unknown>
  alreadyDrafted?: boolean
  insertConflict?: boolean
  streakRows?: boolean[]
  playbookData?: unknown
  examples?: { situation: string; lead_message: string; human_reply: string }[]
}

const RE = {
  lastLead: /FROM horizon_agent\.messages m\s+WHERE m\.conversation_id = \$1 AND m\.author = 'lead'/,
  lead: /FROM horizon_agent\.conversations c/,
  lastAny: /SELECT m\.id, m\.author FROM horizon_agent\.messages m\s+WHERE m\.conversation_id = \$1 ORDER BY/,
  already: /SELECT 1 FROM horizon_agent\.agent_drafts WHERE trigger_message_id/,
  streak: /SELECT not_understood FROM horizon_agent\.agent_drafts/,
  history: /FROM horizon_agent\.messages WHERE conversation_id = \$1 ORDER BY created_at, id/,
  playbook: /FROM horizon_agent\.playbook_versions WHERE active/,
  examples: /learned_examples/,
  insert: /INSERT INTO horizon_agent\.agent_drafts/,
  update: /UPDATE horizon_agent\.leads/,
}

function setup(s: Scenario, responses: FakeResponse[] = []) {
  const queries: { sql: string; params: any[] }[] = []
  const lead = {
    id: 'lead-1',
    name: 'Maria Oliveira',
    phone: '5583999991234',
    stage: 'respondeu',
    qualification: {},
    opt_out: false,
    anonymized_at: null,
    ...s.lead,
  }
  const rows = (r: any[]) => ({ rows: r, rowCount: r.length })
  const pg = {
    query: async (sql: string, params: any[] = []) => {
      queries.push({ sql, params })
      if (RE.lastLead.test(sql)) {
        const m = [...s.messages].reverse().find((x) => x.author === 'lead')
        return rows(m ? [{ id: m.id, body: m.body, contains_sensitive: !!m.contains_sensitive }] : [])
      }
      if (RE.lead.test(sql)) return rows([lead])
      if (RE.lastAny.test(sql)) {
        const m = s.messages[s.messages.length - 1]
        return rows(m ? [{ id: m.id, author: m.author }] : [])
      }
      if (RE.already.test(sql)) return rows(s.alreadyDrafted ? [{ '?column?': 1 }] : [])
      if (RE.streak.test(sql)) return rows((s.streakRows ?? []).map((v) => ({ not_understood: v })))
      if (RE.history.test(sql))
        return rows(
          s.messages.map((m) => ({ id: m.id, author: m.author, contains_sensitive: !!m.contains_sensitive, body: m.contains_sensitive ? null : m.body })),
        )
      if (RE.playbook.test(sql)) return rows([{ version: 3, data: s.playbookData === undefined ? structuredClone(testPlaybook) : s.playbookData }])
      if (RE.examples.test(sql)) return rows(s.examples ?? [])
      if (RE.insert.test(sql)) return rows(s.insertConflict ? [] : [{ id: '42' }])
      if (RE.update.test(sql)) return rows([])
      return rows([])
    },
  }
  const llm = new FakeLlm(responses)
  const svc = new ShadowService(pg as any, {} as any, undefined, llm)
  const of = (re: RegExp) => queries.filter((q) => re.test(q.sql))
  const indexOf = (re: RegExp) => queries.findIndex((q) => re.test(q.sql))
  return { svc, llm, queries, of, indexOf }
}

const extraction = (over: Record<string, unknown> = {}) => ({
  campos: {},
  objecao_id: null,
  pergunta_fato_id: null,
  pergunta_sem_fato: false,
  pediu_humano: false,
  nao_entendeu: false,
  ...over,
})

// Colunas do INSERT, na ordem dos parâmetros de ShadowService.run.
const COLS = [
  'conversation_id', 'trigger_message_id', 'draft_body', 'model', 'playbook_version', 'stage_guess', 'qualified_guess',
  'next_action_guess', 'action', 'objection_id', 'asked_field', 'handoff_reason', 'guard_violations', 'prompt_hash',
  'input_tokens', 'output_tokens', 'calls', 'not_understood', 'intended_action',
]
const inserted = (params: any[]) => Object.fromEntries(COLS.map((c, i) => [c, params[i]]))

describe('ShadowService com o cérebro de vendas', () => {
  afterEach(() => jest.restoreAllMocks())

  it('mensagem sensível antiga não bloqueia mais: rascunha, e o corpo sensível não chega ao LLM', async () => {
    const t = setup(
      {
        messages: [
          { id: '1', author: 'lead', body: 'tenho diabetes', contains_sensitive: true },
          { id: '2', author: 'humano', body: 'Entendi, obrigado' },
          { id: '3', author: 'lead', body: 'Moro em Recife' },
        ],
      },
      [extraction({ campos: { cidade: { valor: 'Recife', confianca: 0.9 } } }), { texto: 'Oi [LEAD], vocês já têm plano hoje?' }],
    )
    const r = await t.svc.run(CONV)
    expect(r).toEqual({ status: 'drafted', draftId: 42 })
    const sent = JSON.stringify(t.llm.calls)
    expect(sent).not.toMatch(/diabetes/)
    expect(sent).toContain(SENSITIVE_PLACEHOLDER)
    const row = inserted(t.of(RE.insert)[0].params)
    expect(row.trigger_message_id).toBe(3)
    expect(row.draft_body).toBe('Oi Maria, vocês já têm plano hoje?')
    expect(row.action).toBe('perguntar_campo')
    expect(row.asked_field).toBe('plano_atual')
    expect(row.handoff_reason).toBeNull()
    expect(row.playbook_version).toBe(3)
    expect(row.calls).toBe(2)
    expect(row.not_understood).toBe(false)
    expect(JSON.parse(row.guard_violations)).toEqual([])
    expect(t.of(RE.insert)[0].sql).toMatch(/ON CONFLICT \(trigger_message_id\) DO NOTHING/)
  })

  it('I3: grava guardEvents em guard_violations e a ação pretendida em intended_action', async () => {
    const t = setup(
      { messages: [{ id: '3', author: 'lead', body: 'tá caro' }] },
      [extraction({ objecao_id: 'preco' }), { texto: 'Te dou R$ 99 por mês.' }, { texto: 'Sem problema, cobre tudo!' }],
    )
    expect(await t.svc.run(CONV)).toEqual({ status: 'drafted', draftId: 42 })
    const q = t.of(RE.insert)[0]
    expect(q.params).toHaveLength(COLS.length)
    expect(q.sql).toContain('$' + COLS.length + ')')
    expect(q.sql).not.toContain('$' + (COLS.length + 1))
    const row = inserted(q.params)
    expect(row.action).toBe('repassar_humano')
    expect(row.handoff_reason).toBe('guardacorpo')
    expect(row.intended_action).toBe('tratar_objecao')
    expect(row.objection_id).toBe('preco')
    expect(JSON.parse(row.guard_violations)).toEqual(['valor_nao_aprovado', 'cobertura_nao_aprovada'])
  })

  it('I3: regeração limpa ainda registra o evento em guard_violations; intended_action null', async () => {
    const t = setup(
      { messages: [{ id: '3', author: 'lead', body: 'oi' }] },
      [extraction(), { texto: 'Fica R$ 99 por mês. Quantas pessoas?' }, { texto: 'Vocês já têm plano hoje?' }],
    )
    await t.svc.run(CONV)
    const row = inserted(t.of(RE.insert)[0].params)
    expect(row.action).toBe('perguntar_campo')
    expect(JSON.parse(row.guard_violations)).toEqual(['valor_nao_aprovado'])
    expect(row.intended_action).toBeNull()
  })

  it('perfil alterado é gravado com jsonb_build_object, só depois do INSERT bem-sucedido', async () => {
    const t = setup(
      {
        messages: [{ id: '3', author: 'lead', body: 'Moro em Recife' }],
        lead: { qualification: { outro: 1, perfil: { plano_atual: { valor: 'sim', confianca: 0.9, msgId: '1' } } } },
      },
      [extraction({ campos: { cidade: { valor: 'Recife', confianca: 0.9 } } }), { texto: 'Quantas pessoas entrariam no plano?' }],
    )
    await t.svc.run(CONV)
    const ups = t.of(RE.update)
    expect(ups).toHaveLength(1)
    expect(ups[0].sql).toContain(
      `qualification = qualification || jsonb_build_object('perfil', coalesce(qualification->'perfil','{}'::jsonb) || $2::jsonb)`,
    )
    expect(ups[0].params[0]).toBe('lead-1')
    const perfil = JSON.parse(ups[0].params[1])
    expect(perfil.cidade).toEqual({ valor: 'Recife', confianca: 0.9, msgId: '3' })
    expect(t.indexOf(RE.update)).toBeGreaterThan(t.indexOf(RE.insert))
  })

  it('última mensagem do lead sensível: rascunho de passagem saude, 0 chamadas ao LLM, perfil intacto', async () => {
    const t = setup({ messages: [{ id: '1', author: 'lead', body: 'oi' }, { id: '2', author: 'lead', body: 'tenho diabetes', contains_sensitive: true }] })
    const r = await t.svc.run(CONV)
    expect(r).toEqual({ status: 'drafted', draftId: 42 })
    expect(t.llm.calls).toHaveLength(0)
    const row = inserted(t.of(RE.insert)[0].params)
    expect(row.action).toBe('repassar_humano')
    expect(row.handoff_reason).toBe('saude')
    expect(row.draft_body).toBe(HANDOFF_TEXT.saude)
    expect(t.of(RE.update)).toHaveLength(0)
    // a busca de exemplos não usa o texto sensível
    expect(t.of(RE.examples)).toHaveLength(0)
  })

  it('última mensagem da conversa é do humano: stale, sem LLM e sem INSERT', async () => {
    const t = setup({ messages: [{ id: '1', author: 'lead', body: 'oi' }, { id: '2', author: 'humano', body: 'Olá!' }] })
    expect(await t.svc.run(CONV)).toEqual({ status: 'stale' })
    expect(t.llm.calls).toHaveLength(0)
    expect(t.of(RE.insert)).toHaveLength(0)
  })

  it('já rascunhado (SELECT): already_drafted antes de chamar o LLM', async () => {
    const t = setup({ messages: [{ id: '1', author: 'lead', body: 'oi' }], alreadyDrafted: true })
    expect(await t.svc.run(CONV)).toEqual({ status: 'already_drafted' })
    expect(t.llm.calls).toHaveLength(0)
    expect(t.of(RE.insert)).toHaveLength(0)
  })

  it('INSERT em conflito (0 linhas): already_drafted e nenhum UPDATE de perfil', async () => {
    const t = setup(
      { messages: [{ id: '3', author: 'lead', body: 'Moro em Recife' }], insertConflict: true },
      [extraction({ campos: { cidade: { valor: 'Recife', confianca: 0.9 } } }), { texto: 'Vocês já têm plano hoje?' }],
    )
    expect(await t.svc.run(CONV)).toEqual({ status: 'already_drafted' })
    expect(t.of(RE.insert)).toHaveLength(1)
    expect(t.of(RE.update)).toHaveLength(0)
  })

  it('LlmError: llm_error, nenhum INSERT nem UPDATE, log sem conteúdo da conversa', async () => {
    const t = setup({ messages: [{ id: '3', author: 'lead', body: 'Moro em Recife, sou Maria Oliveira' }] }, [new LlmError('Gemini 503', 'http', 503)])
    const log = (t.svc as any).log
    const spies = ['log', 'warn', 'error', 'debug'].map((k) => jest.spyOn(log, k).mockImplementation(() => undefined))
    expect(await t.svc.run(CONV)).toEqual({ status: 'llm_error' })
    expect(t.of(RE.insert)).toHaveLength(0)
    expect(t.of(RE.update)).toHaveLength(0)
    const logged = JSON.stringify(spies.flatMap((s) => s.mock.calls))
    expect(logged).toContain('http')
    expect(logged).toContain('503')
    expect(logged).not.toMatch(/Recife|Maria|Oliveira/)
  })

  it('erro inesperado (não LlmError) propaga', async () => {
    const t = setup({ messages: [{ id: '3', author: 'lead', body: 'oi' }] }, [new Error('bug')])
    await expect(t.svc.run(CONV)).rejects.toThrow('bug')
  })

  it.each([
    ['opt_out', { opt_out: true }],
    ['anonimizado', { anonymized_at: new Date().toISOString() }],
  ])('lead %s não chama o provedor', async (_n, lead) => {
    const t = setup({ messages: [{ id: '1', author: 'lead', body: 'oi' }], lead })
    expect(await t.svc.run(CONV)).toEqual({ status: 'opt_out' })
    expect(t.llm.calls).toHaveLength(0)
    expect(t.of(RE.insert)).toHaveLength(0)
  })

  it('sem mensagem do lead: no_inbound', async () => {
    const t = setup({ messages: [{ id: '1', author: 'humano', body: 'Olá' }] })
    expect(await t.svc.run(CONV)).toEqual({ status: 'no_inbound' })
  })

  it('provedor desativado: disabled, e status() informa o provedor', async () => {
    const pg = { query: jest.fn() }
    const off = { enabled: false, provider: 'none' as const, call: jest.fn() }
    const svc = new ShadowService(pg as any, {} as any, undefined, off)
    expect(await svc.run(CONV)).toEqual({ status: 'disabled' })
    expect(pg.query).not.toHaveBeenCalled()
    expect(svc.status()).toEqual({ enabled: false, mode: 'shadow', provider: 'none' })
    const on = { enabled: true, provider: 'gemini' as const, call: jest.fn() }
    expect(new ShadowService(pg as any, {} as any, undefined, on).status()).toEqual({ enabled: true, mode: 'shadow', provider: 'gemini' })
  })

  it('streak: duas linhas not_understood=true seguidas => repassa nao_entendeu com o sinal do turno', async () => {
    const decide = jest.spyOn(SalesBrain.prototype, 'decide')
    const t = setup(
      { messages: [{ id: '5', author: 'lead', body: 'asdf qwer' }], streakRows: [true, true, false] },
      [extraction({ nao_entendeu: true })],
    )
    expect(await t.svc.run(CONV)).toEqual({ status: 'drafted', draftId: 42 })
    expect((decide.mock.calls[0][0] as BrainInput).failedUnderstandingStreak).toBe(2)
    const row = inserted(t.of(RE.insert)[0].params)
    expect(row.handoff_reason).toBe('nao_entendeu')
    expect(row.not_understood).toBe(true)
    expect(t.of(RE.streak)[0].sql).toMatch(/ORDER BY created_at DESC, id DESC/)
    expect(t.of(RE.streak)[0].params).toEqual([CONV])
  })

  it('streak: linha mais recente not_understood=false => streak 0, segue rascunhando', async () => {
    const decide = jest.spyOn(SalesBrain.prototype, 'decide')
    const t = setup(
      { messages: [{ id: '5', author: 'lead', body: 'asdf qwer' }], streakRows: [false, true, true] },
      [extraction({ nao_entendeu: true }), { texto: 'Vocês já têm plano hoje?' }],
    )
    await t.svc.run(CONV)
    expect((decide.mock.calls[0][0] as BrainInput).failedUnderstandingStreak).toBe(0)
    const row = inserted(t.of(RE.insert)[0].params)
    expect(row.action).toBe('perguntar_campo')
    expect(row.not_understood).toBe(true)
  })

  it('rascunho vazio (aguardar) ainda é gravado para dedupe/telemetria e devolve drafted', async () => {
    const t = setup(
      { messages: [{ id: '6', author: 'lead', body: 'na verdade ninguém' }] },
      [extraction({ campos: { vidas: { valor: 0, confianca: 0.9 } } })],
    )
    expect(await t.svc.run(CONV)).toEqual({ status: 'drafted', draftId: 42 })
    const row = inserted(t.of(RE.insert)[0].params)
    expect(row.draft_body).toBe('')
    expect(row.action).toBe('aguardar')
  })

  it('resumo não é enviado ao cérebro (summary: null)', async () => {
    const decide = jest.spyOn(SalesBrain.prototype, 'decide')
    const t = setup(
      { messages: [{ id: '3', author: 'lead', body: 'oi' }], lead: { summary: 'Maria Oliveira tem diabetes' } },
      [extraction(), { texto: 'Vocês já têm plano hoje?' }],
    )
    await t.svc.run(CONV)
    expect((decide.mock.calls[0][0] as BrainInput).summary).toBeNull()
    expect(JSON.stringify(t.llm.calls)).not.toMatch(/RESUMO|diabetes/)
  })

  it('playbook legado sem data: playbook null => passagem playbook_incompleto sem LLM', async () => {
    const decide = jest.spyOn(SalesBrain.prototype, 'decide')
    const t = setup({ messages: [{ id: '3', author: 'lead', body: 'oi' }], playbookData: null })
    expect(await t.svc.run(CONV)).toEqual({ status: 'drafted', draftId: 42 })
    expect((decide.mock.calls[0][0] as BrainInput).playbook).toBeNull()
    expect(t.llm.calls).toHaveLength(0)
    expect(inserted(t.of(RE.insert)[0].params).handoff_reason).toBe('playbook_incompleto')
  })
})
