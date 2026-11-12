import { Test, TestingModule } from '@nestjs/testing'
import * as crypto from 'crypto'
import { WebhookWhatsappMetaService, WhatsAppMetaWebhookPayload } from './webhook.whatsapp-meta.service'
import { PrismaService } from 'src/database/prisma.service'

/**
 * P-120: `processWebhook` só validava a assinatura HMAC quando a empresa tinha
 * `whatsappAppSecret` configurado; sem o segredo, QUALQUER corpo era aceito sem nenhuma
 * verificação (fail-open). Esta suíte trava o novo contrato: fail-closed por padrão quando
 * não há segredo configurado, com `WHATSAPP_META_WEBHOOK_SIGNATURE_DISABLED=true` como
 * kill-switch explícito para restaurar o comportamento antigo sem deploy.
 *
 * `decryptIntegrationData` é mockado para devolver o objeto como veio — os testes já
 * passam o "whatsappAppSecret" em texto puro na fixture.
 */
jest.mock('src/shared/util/encryption.utils', () => ({
  decryptIntegrationData: (data: any) => data,
}))

const SUBDOMAIN = 'empresa-teste'
const APP_SECRET = 'segredo-app-meta'
const COMPANY = { id: 'company-1', subdomain: SUBDOMAIN, status: 'ACTIVE' }

/** Payload sem nenhuma entry: o loop de processamento de mensagens não roda — o teste fica
 * restrito ao portão de assinatura, sem precisar mockar o pipeline de mensagens. */
const EMPTY_PAYLOAD: WhatsAppMetaWebhookPayload = {
  object: 'whatsapp_business_account',
  entry: [],
}

function hmacSignature(rawBody: Buffer, secret: string): string {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex')
}

describe('WebhookWhatsappMetaService.processWebhook — assinatura (P-120)', () => {
  let service: WebhookWhatsappMetaService
  let prisma: any
  const ORIGINAL_ENV = process.env.WHATSAPP_META_WEBHOOK_SIGNATURE_DISABLED

  beforeEach(async () => {
    delete process.env.WHATSAPP_META_WEBHOOK_SIGNATURE_DISABLED

    prisma = {
      companies: { findFirst: jest.fn().mockResolvedValue(COMPANY) },
      integrations: { findFirst: jest.fn().mockResolvedValue(null) },
    }

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebhookWhatsappMetaService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile()

    service = module.get<WebhookWhatsappMetaService>(WebhookWhatsappMetaService)
  })

  afterEach(() => {
    if (ORIGINAL_ENV === undefined) delete process.env.WHATSAPP_META_WEBHOOK_SIGNATURE_DISABLED
    else process.env.WHATSAPP_META_WEBHOOK_SIGNATURE_DISABLED = ORIGINAL_ENV
  })

  describe('sem whatsappAppSecret configurado', () => {
    it('rejeita por padrão (fail-closed)', async () => {
      const result = await service.processWebhook(SUBDOMAIN, EMPTY_PAYLOAD, undefined, undefined)

      expect(result).toEqual({ success: false, message: 'Integration not configured' })
    })

    it('aceita com o kill-switch ligado (comportamento antigo, documentado)', async () => {
      process.env.WHATSAPP_META_WEBHOOK_SIGNATURE_DISABLED = 'true'

      const result = await service.processWebhook(SUBDOMAIN, EMPTY_PAYLOAD, undefined, undefined)

      expect(result).toEqual({ success: true, message: 'Webhook processed' })
    })
  })

  describe('com whatsappAppSecret configurado', () => {
    beforeEach(() => {
      prisma.integrations.findFirst.mockResolvedValue({ whatsappAppSecret: APP_SECRET })
    })

    it('rejeita quando a assinatura está ausente', async () => {
      const rawBody = Buffer.from(JSON.stringify(EMPTY_PAYLOAD))

      const result = await service.processWebhook(SUBDOMAIN, EMPTY_PAYLOAD, undefined, rawBody)

      expect(result).toEqual({ success: false, message: 'Invalid signature' })
    })

    it('rejeita quando a assinatura é inválida', async () => {
      const rawBody = Buffer.from(JSON.stringify(EMPTY_PAYLOAD))

      const result = await service.processWebhook(SUBDOMAIN, EMPTY_PAYLOAD, 'sha256=invalida', rawBody)

      expect(result).toEqual({ success: false, message: 'Invalid signature' })
    })

    it('aceita quando a assinatura HMAC bate com o corpo cru', async () => {
      const rawBody = Buffer.from(JSON.stringify(EMPTY_PAYLOAD))
      const signature = hmacSignature(rawBody, APP_SECRET)

      const result = await service.processWebhook(SUBDOMAIN, EMPTY_PAYLOAD, signature, rawBody)

      expect(result).toEqual({ success: true, message: 'Webhook processed' })
    })
  })
})
