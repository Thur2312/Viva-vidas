import { ChatGatewayService } from './chat-gateway.service'

const ENV = ['CHAT_API_URL', 'CHAT_BRIDGE_KEY', 'CHAT_CONNECTION_ID'] as const
const saved: Record<string, string | undefined> = {}
const dados = { phoneNumberId: '123456789012', wabaId: '987654321098', accessToken: 'EAAG' + 'x'.repeat(40), name: 'Oficial' }

beforeEach(() => { for (const k of ENV) { saved[k] = process.env[k]; delete process.env[k] } })
afterEach(() => { for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] } jest.restoreAllMocks() })

describe('ChatGatewayService.connectOfficial', () => {
  it('sem chat configurado falha fechado e não chama a rede', async () => {
    const spy = jest.spyOn(global, 'fetch' as any)
    expect(await new ChatGatewayService().connectOfficial(dados)).toEqual({ ok: false, error: 'chat_nao_configurado' })
    expect(spy).not.toHaveBeenCalled()
  })

  it('envia ao chat com a chave da ponte e devolve só id/status/created (nunca o token)', async () => {
    process.env.CHAT_API_URL = 'https://chat.exemplo.com/'
    process.env.CHAT_BRIDGE_KEY = 'chave-ponte'
    const spy = jest.spyOn(global, 'fetch' as any).mockResolvedValue({ ok: true, json: async () => ({ id: 2, status: 'CONNECTED', created: true }) } as any)
    const r = await new ChatGatewayService().connectOfficial(dados)
    expect(r).toEqual({ ok: true, data: { id: 2, status: 'CONNECTED', created: true } })
    const [url, init] = spy.mock.calls[0] as any
    expect(url).toBe('https://chat.exemplo.com/pilot-bridge/connection/official')
    expect(init.headers['x-pilot-key']).toBe('chave-ponte')
    expect(JSON.parse(init.body)).toMatchObject({ phoneNumberId: dados.phoneNumberId, wabaId: dados.wabaId })
    expect(JSON.stringify(r)).not.toContain('EAAG')
  })

  it('credencial recusada pela Meta, dado inválido e chat fora do ar viram códigos distintos', async () => {
    process.env.CHAT_API_URL = 'https://chat.exemplo.com'
    process.env.CHAT_BRIDGE_KEY = 'k'
    const svc = new ChatGatewayService()
    const f = jest.spyOn(global, 'fetch' as any)
    f.mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({ error: 'credenciais_invalidas' }) } as any)
    expect(await svc.connectOfficial(dados)).toEqual({ ok: false, error: 'credenciais_invalidas' })
    f.mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({ error: 'dados_invalidos', fields: ['wabaId'] }) } as any)
    expect(await svc.connectOfficial(dados)).toEqual({ ok: false, error: 'dados_invalidos' })
    f.mockResolvedValueOnce({ ok: false, status: 502 } as any)
    expect(await svc.connectOfficial(dados)).toEqual({ ok: false, error: 'chat_indisponivel' })
    f.mockRejectedValueOnce(new Error('rede'))
    expect(await svc.connectOfficial(dados)).toEqual({ ok: false, error: 'chat_indisponivel' })
  })
})
