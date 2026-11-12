import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { randomUUID } from 'crypto'
import { CollectEventDto } from './create-tracking.dto'

/**
 * Spec do CollectEventDto — valida que class-validator rejeita
 * payloads inválidos antes de chegar ao service.
 *
 * Campos obrigatórios: client_hash, visitor_id, session_id, event
 * (todos IsString + IsNotEmpty)
 *
 * Campos opcionais: todos os demais (coordenadas, UTMs, FBC/FBP, form_data, etc.)
 */
describe('CollectEventDto', () => {
  function makeValidPayload(overrides: Partial<CollectEventDto> = {}) {
    return {
      client_hash: 'test-client',
      visitor_id: randomUUID(),
      session_id: randomUUID(),
      event: 'pageview',
      ...overrides,
    }
  }

  describe('campos obrigatórios', () => {
    it('valida payload mínimo (4 campos obrigatórios)', async () => {
      const dto = plainToInstance(CollectEventDto, makeValidPayload())
      const errors = await validate(dto)
      expect(errors).toHaveLength(0)
    })

    it('rejeita client_hash ausente', async () => {
      const { client_hash, ...rest } = makeValidPayload() as any
      const dto = plainToInstance(CollectEventDto, rest)
      const errors = await validate(dto)
      expect(errors.some((e) => e.property === 'client_hash')).toBe(true)
    })

    it('rejeita client_hash vazio', async () => {
      const dto = plainToInstance(CollectEventDto, makeValidPayload({ client_hash: '' }))
      const errors = await validate(dto)
      expect(errors.some((e) => e.property === 'client_hash')).toBe(true)
    })

    it('rejeita visitor_id ausente', async () => {
      const { visitor_id, ...rest } = makeValidPayload() as any
      const dto = plainToInstance(CollectEventDto, rest)
      const errors = await validate(dto)
      expect(errors.some((e) => e.property === 'visitor_id')).toBe(true)
    })

    it('rejeita session_id ausente', async () => {
      const { session_id, ...rest } = makeValidPayload() as any
      const dto = plainToInstance(CollectEventDto, rest)
      const errors = await validate(dto)
      expect(errors.some((e) => e.property === 'session_id')).toBe(true)
    })

    it('rejeita event ausente', async () => {
      const { event, ...rest } = makeValidPayload() as any
      const dto = plainToInstance(CollectEventDto, rest)
      const errors = await validate(dto)
      expect(errors.some((e) => e.property === 'event')).toBe(true)
    })
  })

  describe('campos opcionais', () => {
    it('aceita sem coordenadas de clique', async () => {
      const dto = plainToInstance(CollectEventDto, makeValidPayload())
      const errors = await validate(dto)
      expect(errors).toHaveLength(0)
    })

    it('aceita com todas as coordenadas numéricas', async () => {
      const dto = plainToInstance(
        CollectEventDto,
        makeValidPayload({
          click_x: 100,
          click_y: 200,
          page_x: 100,
          page_y: 400,
          viewport_w: 1920,
          viewport_h: 1080,
          scroll_y: 500,
          scroll_pct: 50,
          time_on_page_ms: 12345,
        }),
      )
      const errors = await validate(dto)
      expect(errors).toHaveLength(0)
    })

    it('aceita UTMs opcionais', async () => {
      const dto = plainToInstance(
        CollectEventDto,
        makeValidPayload({
          utm_source: 'google',
          utm_medium: 'cpc',
          utm_campaign: 'promo',
          utm_content: 'ad1',
          utm_term: 'marketing',
        }),
      )
      const errors = await validate(dto)
      expect(errors).toHaveLength(0)
    })

    it('aceita FBC/FBCLID/FBP opcionais', async () => {
      const dto = plainToInstance(
        CollectEventDto,
        makeValidPayload({ fbc: 'fb.1.x.y', fbclid: 'abc', fbp: 'fb.1.z' }),
      )
      const errors = await validate(dto)
      expect(errors).toHaveLength(0)
    })

    it('aceita form_data como string JSON', async () => {
      const dto = plainToInstance(
        CollectEventDto,
        makeValidPayload({
          event: 'form_submit',
          form_data: JSON.stringify({ nome: 'João' }),
          form_email: 'a@b.com',
          form_nome: 'João',
          form_telefone: '11999998888',
        }),
      )
      const errors = await validate(dto)
      expect(errors).toHaveLength(0)
    })

    it('aceita campos de clique (button_*)', async () => {
      const dto = plainToInstance(
        CollectEventDto,
        makeValidPayload({
          event: 'click',
          button_text: 'Comprar',
          button_tag: 'button',
          button_href: 'https://x.com',
          button_id: 'btn-1',
          button_classes: 'btn cta',
          button_track: 'hero-cta',
        }),
      )
      const errors = await validate(dto)
      expect(errors).toHaveLength(0)
    })
  })

  describe('tipos', () => {
    it('rejeita client_hash não-string', async () => {
      const dto = plainToInstance(CollectEventDto, makeValidPayload({ client_hash: 123 as any }))
      const errors = await validate(dto)
      expect(errors.some((e) => e.property === 'client_hash')).toBe(true)
    })

    it('rejeita event não-string', async () => {
      const dto = plainToInstance(CollectEventDto, makeValidPayload({ event: {} as any }))
      const errors = await validate(dto)
      expect(errors.some((e) => e.property === 'event')).toBe(true)
    })
  })
})
