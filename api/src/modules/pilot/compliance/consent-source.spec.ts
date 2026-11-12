import { BadRequestException } from '@nestjs/common'
import { ConsentService } from './consent.service'

describe('evidência de consentimento explícito', () => {
  const base = { purpose: 'marketing' as const, textVersion: 'v1' }

  it('aceita tipo conhecido com referência rastreável', () => {
    expect(() => ConsentService.normalize({ ...base, source: 'formulario_com_aviso:form-2026-11-abc123' })).not.toThrow()
    expect(() => ConsentService.normalize({ ...base, source: 'anuncio_click_to_whatsapp:ad_120200001' })).not.toThrow()
  })

  it.each([
    ['texto livre', 'ingestao'],
    ['tipo desconhecido', 'planilha:linha-4'],
    ['sem referência', 'formulario_com_aviso:'],
    ['referência curta demais', 'ligacao_gravada:ab'],
    ['referência só com espaço', 'cadastro_site: '],
  ])('recusa %s', (_n, source) => {
    expect(() => ConsentService.normalize({ ...base, source })).toThrow(BadRequestException)
  })

  it('não exige esse formato para atendimento/qualificação (base procedimentos preliminares)', () => {
    expect(() => ConsentService.normalize({ purpose: 'atendimento', source: 'mensagem_do_lead' })).not.toThrow()
  })
})
