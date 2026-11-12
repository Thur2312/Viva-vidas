import * as crypto from 'crypto'
import { MetaLeadsConfigService } from './meta-leads-config.service'

// Mock encryption utils
jest.mock('src/shared/util/encryption.utils', () => ({
  decryptIntegrationData: jest.fn(),
  looksEncrypted: jest.fn(() => false),
}))

import { decryptIntegrationData, looksEncrypted } from 'src/shared/util/encryption.utils'

const mockDecrypt = decryptIntegrationData as jest.Mock
const mockLooksEncrypted = looksEncrypted as jest.Mock

function createMockPrisma() {
  return {
    companies: {
      findFirst: jest.fn(),
    },
    integrations: {
      findFirst: jest.fn(),
    },
  }
}

describe('MetaLeadsConfigService', () => {
  let service: MetaLeadsConfigService
  let prisma: ReturnType<typeof createMockPrisma>

  beforeEach(() => {
    prisma = createMockPrisma()
    service = new MetaLeadsConfigService(prisma as any)
    jest.clearAllMocks()
  })

  // ===== getVerifyTokenForSubdomain =====

  describe('getVerifyTokenForSubdomain', () => {
    it('should return token when company and integration found with webhook enabled', async () => {
      prisma.companies.findFirst.mockResolvedValue({ id: 'comp-1' })
      prisma.integrations.findFirst.mockResolvedValue({ metaLeadsVerifyToken: 'verify-abc' })

      const result = await service.getVerifyTokenForSubdomain('my-subdomain')
      expect(result).toBe('verify-abc')
    })

    it('should return null when company not found', async () => {
      prisma.companies.findFirst.mockResolvedValue(null)

      const result = await service.getVerifyTokenForSubdomain('unknown')
      expect(result).toBeNull()
      expect(prisma.integrations.findFirst).not.toHaveBeenCalled()
    })

    it('should return null when integration not found', async () => {
      prisma.companies.findFirst.mockResolvedValue({ id: 'comp-1' })
      prisma.integrations.findFirst.mockResolvedValue(null)

      const result = await service.getVerifyTokenForSubdomain('my-subdomain')
      expect(result).toBeNull()
    })

    it('should return null when integration has null metaLeadsVerifyToken', async () => {
      prisma.companies.findFirst.mockResolvedValue({ id: 'comp-1' })
      prisma.integrations.findFirst.mockResolvedValue({ metaLeadsVerifyToken: null })

      const result = await service.getVerifyTokenForSubdomain('my-subdomain')
      expect(result).toBeNull()
    })

    it('should filter by deleted_at: null on both queries', async () => {
      prisma.companies.findFirst.mockResolvedValue({ id: 'comp-1' })
      prisma.integrations.findFirst.mockResolvedValue({ metaLeadsVerifyToken: 'tok' })

      await service.getVerifyTokenForSubdomain('sub')

      expect(prisma.companies.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ deleted_at: null }),
        }),
      )
      expect(prisma.integrations.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            deleted_at: null,
            metaLeadsWebhookEnabled: true,
          }),
        }),
      )
    })
  })

  // ===== getWebhookConfig =====

  describe('getWebhookConfig', () => {
    it('should return decrypted config when integration found', async () => {
      prisma.integrations.findFirst.mockResolvedValue({
        metaAccessToken: 'encrypted-token',
        metaLeadsVerifyToken: 'verify-tok',
        metaLeadsAppSecret: 'encrypted-secret',
      })
      mockDecrypt.mockReturnValue({
        metaAccessToken: 'decrypted-token',
        metaLeadsAppSecret: 'decrypted-secret',
      })

      const result = await service.getWebhookConfig('comp-1')

      expect(result).toEqual({
        accessToken: 'decrypted-token',
        verifyToken: 'verify-tok',
        appSecret: 'decrypted-secret',
      })
    })

    it('should return null when no integration found', async () => {
      prisma.integrations.findFirst.mockResolvedValue(null)

      const result = await service.getWebhookConfig('comp-1')
      expect(result).toBeNull()
    })

    it('should return null when integration has null metaAccessToken', async () => {
      prisma.integrations.findFirst.mockResolvedValue({ metaAccessToken: null })

      const result = await service.getWebhookConfig('comp-1')
      expect(result).toBeNull()
    })

    it('should return null when decryption throws error', async () => {
      prisma.integrations.findFirst.mockResolvedValue({
        metaAccessToken: 'encrypted-token',
      })
      mockDecrypt.mockImplementation(() => { throw new Error('Decryption failed') })

      const result = await service.getWebhookConfig('comp-1')
      expect(result).toBeNull()
    })

    it('should return null appSecret when metaLeadsAppSecret not configured', async () => {
      prisma.integrations.findFirst.mockResolvedValue({
        metaAccessToken: 'encrypted-token',
        metaLeadsVerifyToken: null,
      })
      mockDecrypt.mockReturnValue({
        metaAccessToken: 'decrypted-token',
        metaLeadsAppSecret: null,
      })

      const result = await service.getWebhookConfig('comp-1')
      expect(result).toEqual({
        accessToken: 'decrypted-token',
        verifyToken: null,
        appSecret: null,
      })
    })

    it('token que nao decriptou nao vai para a Graph API', async () => {
      // decrypt() nao lanca quando a chave nao abre o dado: devolve o ciphertext intacto,
      // entao o try/catch deste metodo nao pega o caso. Sem o guard, o ciphertext seguia
      // como token e a Meta respondia "Cannot parse access token".
      prisma.integrations.findFirst.mockResolvedValue({
        metaAccessToken: 'b25333ac:4a982575:0809dc4c',
        metaLeadsVerifyToken: 'verify-tok',
      })
      mockDecrypt.mockReturnValue({ metaAccessToken: 'b25333ac:4a982575:0809dc4c' })
      mockLooksEncrypted.mockReturnValueOnce(true)

      expect(await service.getWebhookConfig('comp-1')).toBeNull()
    })
  })

  // ===== getMetaAccessToken =====

  describe('getMetaAccessToken', () => {
    it('should return accessToken from getWebhookConfig', async () => {
      prisma.integrations.findFirst.mockResolvedValue({
        metaAccessToken: 'encrypted-token',
        metaLeadsVerifyToken: null,
      })
      mockDecrypt.mockReturnValue({ metaAccessToken: 'my-token', metaLeadsAppSecret: null })

      const result = await service.getMetaAccessToken('comp-1')
      expect(result).toBe('my-token')
    })

    it('should return null when getWebhookConfig returns null', async () => {
      prisma.integrations.findFirst.mockResolvedValue(null)

      const result = await service.getMetaAccessToken('comp-1')
      expect(result).toBeNull()
    })
  })

  // ===== validateSignature =====

  describe('validateSignature', () => {
    const appSecret = 'test-secret-key'
    // Buffer, nao string: `validateSignature` passou a receber os BYTES crus. A conversao
    // para string era o bug — decodificar UTF-8 troca byte invalido por U+FFFD e a assinatura
    // nunca mais bate.
    const rawBody = Buffer.from('{"object":"page","entry":[{"id":"123"}]}', 'utf8')

    function computeHmac(body: Buffer | string, secret: string): string {
      return crypto.createHmac('sha256', secret).update(body).digest('hex')
    }

    it('should return true for valid HMAC-SHA256 signature with sha256= prefix', () => {
      const signature = `sha256=${computeHmac(rawBody, appSecret)}`
      expect(service.validateSignature(rawBody, signature, appSecret)).toBe(true)
    })

    it('should return false for wrong signature', () => {
      const wrongSig = 'sha256=deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef'
      expect(service.validateSignature(rawBody, wrongSig, appSecret)).toBe(false)
    })

    it('should return false for tampered body', () => {
      const signature = `sha256=${computeHmac(rawBody, appSecret)}`
      const tamperedBody = Buffer.concat([rawBody, Buffer.from('TAMPERED')])
      expect(service.validateSignature(tamperedBody, signature, appSecret)).toBe(false)
    })

    it('should return false for wrong appSecret', () => {
      const signature = `sha256=${computeHmac(rawBody, appSecret)}`
      expect(service.validateSignature(rawBody, signature, 'wrong-secret')).toBe(false)
    })

    it('should return false when buffer lengths differ (truncated signature)', () => {
      const truncated = 'sha256=deadbeef'
      expect(service.validateSignature(rawBody, truncated, appSecret)).toBe(false)
    })

    /**
     * REGRESSAO do bug de producao: o controller mandava `JSON.stringify(payload)` quando o
     * rawBody nao tinha sido capturado (as rotas `/api/meta-leads` faltavam na lista de
     * `webhookPrefixes` de main.ts). Nome com acento e o caso comum no Brasil, e e
     * exatamente onde o corpo re-serializado deixa de reproduzir os bytes assinados.
     */
    it('nao valida corpo re-serializado quando a Meta escapou o acento (bug do JSON.stringify)', () => {
      // Como a Meta manda no fio: o acento vem escapado.
      const rawFromMeta = Buffer.from('{"object":"page","entry":[{"changes":[{"value":{"full_name":"Jos\\u00e9 Gon\\u00e7alves"}}]}]}', 'utf8')
      const signature = `sha256=${computeHmac(rawFromMeta, appSecret)}`

      // Com os bytes originais, valida.
      expect(service.validateSignature(rawFromMeta, signature, appSecret)).toBe(true)

      // Re-serializar o objeto ja parseado devolve o acento literal — outros bytes, outro
      // HMAC. Era isso que descartava lead legitimo em silencio no fluxo fail-closed.
      const reserialized = Buffer.from(JSON.stringify(JSON.parse(rawFromMeta.toString('utf8'))), 'utf8')
      expect(reserialized.equals(rawFromMeta)).toBe(false)
      expect(service.validateSignature(reserialized, signature, appSecret)).toBe(false)
    })

    it('should return false on malformed hex signature without crashing', () => {
      expect(service.validateSignature(rawBody, 'sha256=NOT_HEX!!!', appSecret)).toBe(false)
    })

    it('should return false on empty signature', () => {
      expect(service.validateSignature(rawBody, '', appSecret)).toBe(false)
    })
  })
})
