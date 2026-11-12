import { randomUUID } from 'crypto'
import { CollectEventDto } from 'src/modules/admin/tracking/dto/create-tracking.dto'

/**
 * Factory para CollectEventDto em testes.
 * Usa defaults sensatos (UUIDs v4, client_hash válido, event=pageview).
 */
export function buildCollectEventDto(overrides: Partial<CollectEventDto> = {}): CollectEventDto {
  return {
    client_hash: 'test-client',
    visitor_id: randomUUID(),
    session_id: randomUUID(),
    event: 'pageview',
    page: '/',
    url: 'https://test-client.hdmfy.com/',
    referrer: null as any,
    timestamp: new Date().toISOString(),
    ua: 'Mozilla/5.0 (Test)',
    ...overrides,
  } as CollectEventDto
}

export function buildPageviewEvent(overrides: Partial<CollectEventDto> = {}) {
  return buildCollectEventDto({ event: 'pageview', ...overrides })
}

export function buildClickEvent(overrides: Partial<CollectEventDto> = {}) {
  return buildCollectEventDto({
    event: 'click',
    button_text: 'Comprar agora',
    button_tag: 'button',
    button_id: 'cta-main',
    click_x: 100,
    click_y: 200,
    page_x: 100,
    page_y: 400,
    viewport_w: 1920,
    viewport_h: 1080,
    scroll_y: 200,
    ...overrides,
  })
}

export function buildFormSubmitEvent(overrides: Partial<CollectEventDto> = {}) {
  return buildCollectEventDto({
    event: 'form_submit',
    form_nome: 'João da Silva',
    form_email: 'joao@example.com',
    form_telefone: '11999990000',
    form_id: 'lead-form',
    form_data: JSON.stringify({ nome: 'João da Silva', email: 'joao@example.com', telefone: '11999990000' }),
    ...overrides,
  })
}

export function buildScrollDepthEvent(scroll_pct: number, overrides: Partial<CollectEventDto> = {}) {
  return buildCollectEventDto({ event: 'scroll_depth', scroll_pct, ...overrides })
}

export function buildPageExitEvent(time_on_page_ms: number, overrides: Partial<CollectEventDto> = {}) {
  return buildCollectEventDto({ event: 'page_exit', time_on_page_ms, ...overrides })
}
