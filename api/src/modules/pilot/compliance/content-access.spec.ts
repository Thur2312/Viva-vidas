import { canReadContent } from './content-access'

describe('canReadContent', () => {
  it('so manager e owner leem conteudo de conversa', () => {
    expect(canReadContent({ user: { role: 'owner' } })).toBe(true)
    expect(canReadContent({ user: { role: 'manager' } })).toBe(true)
    expect(canReadContent({ user: { role: 'viewer' } })).toBe(false)
  })
  it('falha fechado sem usuario ou com papel desconhecido', () => {
    expect(canReadContent({})).toBe(false)
    expect(canReadContent(undefined)).toBe(false)
    expect(canReadContent({ user: { role: 'admin' } })).toBe(false)
  })
})
