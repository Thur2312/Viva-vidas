import { UnauthorizedException } from '@nestjs/common'
import { PilotKeyGuard, pilotSignature } from './pilot-key.guard'

const KEY = 'k'.repeat(40)
const ctx = (headers: Record<string, string>, rawBody?: Buffer): any => {
  const req = { headers, rawBody }
  return { req, switchToHttp: () => ({ getRequest: () => req }) }
}
const now = () => String(Math.floor(Date.now() / 1000))

describe('PilotKeyGuard', () => {
  const guard = new PilotKeyGuard()
  const old = { ...process.env }
  beforeEach(() => { process.env.PILOT_API_KEY = KEY; delete process.env.PILOT_SIGNING_REQUIRED })
  afterAll(() => { process.env = old })

  it('so a chave basta enquanto a assinatura nao e obrigatoria', () => {
    expect(guard.canActivate(ctx({ 'x-pilot-key': KEY }))).toBe(true)
    expect(() => guard.canActivate(ctx({ 'x-pilot-key': 'errada' }))).toThrow(UnauthorizedException)
    delete process.env.PILOT_API_KEY
    expect(() => guard.canActivate(ctx({ 'x-pilot-key': KEY }))).toThrow(UnauthorizedException)
  })

  describe('com PILOT_SIGNING_REQUIRED=true', () => {
    beforeEach(() => { process.env.PILOT_SIGNING_REQUIRED = 'true' })
    const body = Buffer.from('{"phone":"5583"}')
    const signed = (ts: string, b = body) => ctx({ 'x-pilot-key': KEY, 'x-pilot-timestamp': ts, 'x-pilot-signature': pilotSignature(KEY, ts, b) }, b)

    it('aceita assinatura valida e recente', () => {
      expect(guard.canActivate(signed(now()))).toBe(true)
    })
    it('recusa sem assinatura, com corpo adulterado, com chave certa mas sem assinatura e com timestamp velho', () => {
      expect(() => guard.canActivate(ctx({ 'x-pilot-key': KEY }, body))).toThrow(UnauthorizedException)
      const ts = now()
      const c = signed(ts)
      c.req.rawBody = Buffer.from('{"phone":"outro"}')
      expect(() => guard.canActivate(c)).toThrow(UnauthorizedException)
      expect(() => guard.canActivate(signed(String(Number(now()) - 3600)))).toThrow(UnauthorizedException) // replay
    })
    it('recusa quando o corpo cru nao foi capturado', () => {
      const ts = now()
      expect(() => guard.canActivate(ctx({ 'x-pilot-key': KEY, 'x-pilot-timestamp': ts, 'x-pilot-signature': pilotSignature(KEY, ts, body) }))).toThrow(UnauthorizedException)
    })
  })
})
