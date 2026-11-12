import { enqueueCrmEvent } from './crm.outbox'

describe('enqueueCrmEvent', () => {
  const env = { ...process.env }
  afterEach(() => { process.env = { ...env } })
  const db = () => ({ query: jest.fn(async () => ({ rows: [], rowCount: 1 })) })

  it('desligado (sem CRM_PROVIDER) nao toca no banco', async () => {
    delete process.env.CRM_PROVIDER
    const d = db()
    await enqueueCrmEvent(d, { tenant: 't', leadId: 'L', type: 'qualificado', eventId: 1 })
    expect(d.query).not.toHaveBeenCalled()
  })

  it('ligado: grava com chave de idempotencia do evento e ignora repeticao', async () => {
    process.env.CRM_PROVIDER = 'pipedrive'
    const d = db()
    await enqueueCrmEvent(d, { tenant: 't', leadId: 'L', type: 'venda', eventId: 42, value: 1500 })
    const [sql, params] = d.query.mock.calls[0] as unknown as [string, unknown[]]
    expect(sql).toMatch(/ON CONFLICT \(idempotency_key\) DO NOTHING/)
    expect(params).toEqual(['t', 'L', 'venda', 42, 1500, 'evt:42'])
  })

  it('sem id de evento (banco nao devolveu) nao enfileira', async () => {
    process.env.CRM_PROVIDER = 'pipedrive'
    const d = db()
    await enqueueCrmEvent(d, { tenant: 't', leadId: 'L', type: 'venda', eventId: undefined })
    expect(d.query).not.toHaveBeenCalled()
  })
})
