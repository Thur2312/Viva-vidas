import { ChatGatewayService } from './chat-gateway.service'

const ENV = ['CHAT_API_URL', 'CHAT_BRIDGE_KEY', 'CHAT_CONNECTION_ID'] as const
const saved: Record<string, string | undefined> = {}
beforeEach(() => { for (const k of ENV) { saved[k] = process.env[k]; delete process.env[k] } })
afterEach(() => { for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] } jest.restoreAllMocks() })

describe('ChatGatewayService.startConnection', () => {
  it('sem chat configurado falha fechado e não chama a rede', async () => {
    const spy = jest.spyOn(global, 'fetch' as any)
    expect(await new ChatGatewayService().startConnection()).toEqual({ ok: false, error: 'chat_nao_configurado' })
    expect(spy).not.toHaveBeenCalled()
  })

  it('chama POST /pilot-bridge/connection/start com a chave e o id da conexão', async () => {
    process.env.CHAT_API_URL = 'https://chat.exemplo.com/'
    process.env.CHAT_BRIDGE_KEY = 'chave-ponte'
    process.env.CHAT_CONNECTION_ID = '1'
    const spy = jest.spyOn(global, 'fetch' as any).mockResolvedValue({ ok: true, json: async () => ({ id: 1, status: 'OPENING', started: true }) } as any)
    const r = await new ChatGatewayService().startConnection()
    expect(r).toEqual({ ok: true, data: { id: 1, status: 'OPENING', started: true } })
    const [url, init] = spy.mock.calls[0] as any
    expect(url).toBe('https://chat.exemplo.com/pilot-bridge/connection/start')
    expect(init.method).toBe('POST')
    expect(init.headers['x-pilot-key']).toBe('chave-ponte')
    expect(JSON.parse(init.body)).toEqual({ connectionId: '1' })
  })

  it('chat fora do ar vira chat_indisponivel, sem lançar', async () => {
    process.env.CHAT_API_URL = 'https://chat.exemplo.com'
    process.env.CHAT_BRIDGE_KEY = 'k'
    jest.spyOn(global, 'fetch' as any).mockResolvedValue({ ok: false, status: 502 } as any)
    expect(await new ChatGatewayService().startConnection()).toEqual({ ok: false, error: 'chat_indisponivel' })
  })
})
