import { PipedriveAdapter } from './pipedrive.adapter'
import { CrmApiError } from './crm.types'

const ok = (data: unknown) => ({ ok: true, status: 200, json: async () => ({ success: true, data }) })
const fail = (status: number) => ({ ok: false, status, json: async () => ({ success: false, error: 'telefone 5583999991234' }) })

describe('PipedriveAdapter (fetch simulado: NAO fala com o Pipedrive real)', () => {
  const env = { ...process.env }
  let calls: { url: string; init: any }[]
  const mock = (...responses: any[]) => {
    calls = []
    global.fetch = jest.fn(async (url: any, init: any) => { calls.push({ url: String(url), init }); return responses.shift() }) as any
  }
  beforeEach(() => { process.env.PIPEDRIVE_DOMAIN = 'alberto'; process.env.PIPEDRIVE_API_TOKEN = 'tok-secreto' })
  afterAll(() => { process.env = env })

  it('status lista o que falta e recusa dominio fora do padrao (nada de host arbitrario)', () => {
    delete process.env.PIPEDRIVE_API_TOKEN
    expect(new PipedriveAdapter().status()).toEqual({ provider: 'pipedrive', configured: false, missing: ['PIPEDRIVE_API_TOKEN'] })
    process.env.PIPEDRIVE_DOMAIN = 'evil.com/x?'
    expect(new PipedriveAdapter().status().missing).toContain('PIPEDRIVE_DOMAIN')
  })

  it('manda o token no cabecalho, nunca na URL, e usa o dominio configurado', async () => {
    mock(ok({ id: 55 }))
    await new PipedriveAdapter().createPerson({ name: 'Maria', phone: '+5583999991234' })
    expect(calls[0].url).toBe('https://alberto.pipedrive.com/api/v1/persons')
    expect(calls[0].url).not.toContain('tok-secreto')
    expect(calls[0].init.headers['x-api-token']).toBe('tok-secreto')
    expect(JSON.parse(calls[0].init.body)).toMatchObject({ name: 'Maria', phone: [{ value: '+5583999991234', primary: true }] })
  })

  it('acha pessoa pelo telefone e devolve null quando nao ha', async () => {
    mock(ok({ items: [{ item: { id: 7 } }] }), ok({ items: [] }))
    const a = new PipedriveAdapter()
    expect(await a.findPersonByPhone('+5583999991234')).toBe(7)
    expect(await a.findPersonByPhone('+5583000000000')).toBeNull()
  })

  it('cria negocio com etapa e valor em BRL e atualiza so o que veio', async () => {
    mock(ok({ id: 90 }), ok({}), ok({}))
    const a = new PipedriveAdapter()
    expect(await a.createDeal(7, { title: 'WhatsApp · Maria', stageId: 12, value: 2000 })).toBe(90)
    expect(JSON.parse(calls[0].init.body)).toMatchObject({ person_id: 7, stage_id: 12, value: 2000, currency: 'BRL' })
    await a.updateDeal(90, { status: 'won' })
    expect(JSON.parse(calls[1].init.body)).toEqual({ status: 'won' })
    await a.updateDeal(90, {}) // nada a enviar: nao chama a API
    expect(calls).toHaveLength(2)
  })

  it('erro de API vira CrmApiError sem o corpo da resposta (pode ter dado pessoal)', async () => {
    mock(fail(401))
    const e = await new PipedriveAdapter().createPerson({ name: 'A', phone: '1' }).catch((x) => x)
    expect(e).toBeInstanceOf(CrmApiError)
    expect(e.status).toBe(401)
    expect(e.message).not.toMatch(/5583/)
  })

  it('rede fora do ar vira status 0 (nova tentativa)', async () => {
    global.fetch = jest.fn(async () => { throw new Error('ECONNRESET 5583999991234') }) as any
    const e = await new PipedriveAdapter().findOpenDeal(7).catch((x) => x)
    expect(e.status).toBe(0)
    expect(e.message).not.toMatch(/5583/)
  })

  it('apagar pessoa que ja nao existe (404) conta como feito; outros erros sobem', async () => {
    mock(fail(404), fail(500))
    const a = new PipedriveAdapter()
    await expect(a.deletePerson(7)).resolves.toBeUndefined()
    await expect(a.deletePerson(7)).rejects.toBeInstanceOf(CrmApiError)
  })

  it('sem configuracao nao chama a rede', async () => {
    delete process.env.PIPEDRIVE_API_TOKEN
    mock()
    await expect(new PipedriveAdapter().findPersonByPhone('1')).rejects.toBeInstanceOf(CrmApiError)
    expect(calls).toHaveLength(0)
  })
})
