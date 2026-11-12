import { randomBytes } from 'crypto'
import { CryptoService } from './crypto.service'
import { ConsentService } from './consent.service'
import { sanitizeDetails } from './audit.service'

const key = () => randomBytes(32).toString('base64')

describe('CryptoService', () => {
  const saved = { ...process.env }
  afterEach(() => { process.env = { ...saved } })

  it('cifra e decifra, com IV diferente a cada vez', () => {
    process.env.PILOT_DATA_KEY = key()
    const c = new CryptoService()
    const a = c.encrypt('Tenho diabetes e pago R$ 1900')
    const b = c.encrypt('Tenho diabetes e pago R$ 1900')
    expect(a).toMatch(/^enc:v1:/)
    expect(a).not.toContain('diabetes')
    expect(a).not.toBe(b)
    expect(c.decrypt(a)).toBe('Tenho diabetes e pago R$ 1900')
  })

  it('detecta adulteração (GCM) e chave errada', () => {
    process.env.PILOT_DATA_KEY = key()
    const c = new CryptoService()
    const enc = c.encrypt('segredo')
    const tampered = enc.slice(0, -4) + (enc.endsWith('AAAA') ? 'BBBB' : 'AAAA')
    expect(() => c.decrypt(tampered)).toThrow()
    process.env.PILOT_DATA_KEY = key()
    expect(() => c.decrypt(enc)).toThrow()
  })

  it('valor sem prefixo (legado) é devolvido como está', () => {
    process.env.PILOT_DATA_KEY = key()
    expect(new CryptoService().decrypt('texto antigo')).toBe('texto antigo')
  })

  it('rotação: valor da versão 1 continua legível com a chave nova na versão 2', () => {
    const k1 = key()
    process.env.PILOT_DATA_KEY = k1
    const old = new CryptoService().encrypt('mensagem antiga')
    process.env.PILOT_DATA_KEY = key()
    process.env.PILOT_DATA_KEY_VERSION = '2'
    process.env.PILOT_DATA_KEY_V1 = k1
    const c = new CryptoService()
    expect(c.decrypt(old)).toBe('mensagem antiga')
    expect(c.encrypt('nova')).toMatch(/^enc:v2:/)
  })

  it('falha fechado sem chave fora de teste, e com chave inválida', () => {
    delete process.env.PILOT_DATA_KEY
    process.env.NODE_ENV = 'production'
    const c = new CryptoService()
    expect(() => c.assertReady()).toThrow(/PILOT_DATA_KEY ausente/)
    expect(() => c.encrypt('x')).toThrow(/PILOT_DATA_KEY ausente/)
    process.env.PILOT_DATA_KEY = Buffer.from('curta').toString('base64')
    expect(() => c.assertReady()).toThrow(/32 bytes/)
  })

  it('em teste, sem chave, é passagem direta', () => {
    delete process.env.PILOT_DATA_KEY
    process.env.NODE_ENV = 'test'
    const c = new CryptoService()
    expect(c.encrypt('abc')).toBe('abc')
  })

  it('hash de telefone é determinístico e depende do sal', () => {
    process.env.PILOT_PHONE_SALT = 'sal-1'
    const a = new CryptoService().hashPhone('5583999991234')
    expect(a).toBe(new CryptoService().hashPhone('5583999991234'))
    expect(a).toMatch(/^[0-9a-f]{64}$/)
    process.env.PILOT_PHONE_SALT = 'sal-2'
    expect(new CryptoService().hashPhone('5583999991234')).not.toBe(a)
  })
})

describe('ConsentService.normalize', () => {
  it('marketing e aprendizado exigem consentimento explícito, versão do texto e origem', () => {
    expect(() => ConsentService.normalize({ purpose: 'marketing' })).toThrow(/textVersion/)
    expect(() => ConsentService.normalize({ purpose: 'aprendizado_agente', textVersion: 'v1' })).toThrow(/source/)
    expect(() => ConsentService.normalize({ purpose: 'marketing', legalBasis: 'legitimo_interesse', textVersion: 'v1', source: 'x' })).toThrow(/consentimento/)
    expect(ConsentService.normalize({ purpose: 'marketing', textVersion: 'v1', source: 'formulario_com_aviso:abc-123' }).legalBasis).toBe('consentimento')
    expect(ConsentService.normalize({ purpose: 'atendimento' }).legalBasis).toBe('procedimentos_preliminares')
  })
})

describe('sanitizeDetails (auditoria sem dado pessoal)', () => {
  it('remove chaves pessoais e mascara strings com identificadores', () => {
    const d = sanitizeDetails({ purpose: 'marketing', name: 'Maria', phone: '5583999991234', note: 'ligar 83999991234', n: 3, nested: { body: 'oi', ok: true } })
    expect(d).toEqual({ purpose: 'marketing', note: 'ligar [TELEFONE]', n: 3, nested: { ok: true } })
  })
})
