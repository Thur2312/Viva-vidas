import { MetaLeadsMapperService } from './meta-leads-mapper.service'
import { MetaLeadData } from './types/meta-lead.types'
import {
  makeGraphApiLeadResponse,
  makeMinimalLeadResponse,
  makePtBrLeadResponse,
  makeOrganicLeadResponse,
  makeLeadResponseWithUtms,
  makeLeadResponseWithCustomFields,
  makeLeadResponseWithDisclaimers,
  DEFAULT_META,
} from './__fixtures__/meta-lead-factories'

describe('MetaLeadsMapperService', () => {
  let mapper: MetaLeadsMapperService

  beforeEach(() => {
    mapper = new MetaLeadsMapperService()
  })

  const meta = {
    companyId: DEFAULT_META.companyId,
    pageId: DEFAULT_META.pageId,
    formId: DEFAULT_META.formId,
    adId: DEFAULT_META.adId,
    adsetId: DEFAULT_META.adsetId,
  }

  // ===== getFieldValue =====

  describe('getFieldValue', () => {
    it('should return value when field exists', () => {
      const fd = [{ name: 'email', values: ['test@test.com'] }]
      expect(mapper.getFieldValue(fd, 'email')).toBe('test@test.com')
    })

    it('should return null when field does not exist', () => {
      const fd = [{ name: 'email', values: ['test@test.com'] }]
      expect(mapper.getFieldValue(fd, 'phone')).toBeNull()
    })

    it('should return null when values array is empty', () => {
      const fd = [{ name: 'email', values: [] }]
      expect(mapper.getFieldValue(fd, 'email')).toBeNull()
    })

    it('should return first value when multiple values exist', () => {
      const fd = [{ name: 'email', values: ['first@test.com', 'second@test.com'] }]
      expect(mapper.getFieldValue(fd, 'email')).toBe('first@test.com')
    })

    it('should be case-sensitive (Email does not match email)', () => {
      const fd = [{ name: 'Email', values: ['test@test.com'] }]
      expect(mapper.getFieldValue(fd, 'email')).toBeNull()
    })
  })

  // ===== Core Field Mapping =====

  describe('Core Field Mapping', () => {
    it('should map full_name to dto.name', () => {
      const lead = makeGraphApiLeadResponse()
      const dto = mapper.mapMetaLeadToDto(lead, meta)
      expect(dto.name).toBe('John Doe')
    })

    it('should map email to dto.email', () => {
      const lead = makeGraphApiLeadResponse()
      const dto = mapper.mapMetaLeadToDto(lead, meta)
      expect(dto.email).toBe('john@example.com')
    })

    it('should map phone_number to dto.phone', () => {
      const lead = makeGraphApiLeadResponse()
      const dto = mapper.mapMetaLeadToDto(lead, meta)
      expect(dto.phone).toBe('+5511999887766')
    })

    it('should map city to dto.city', () => {
      const lead = makeGraphApiLeadResponse()
      const dto = mapper.mapMetaLeadToDto(lead, meta)
      expect(dto.city).toBe('Sao Paulo')
    })

    it('should map state to dto.state', () => {
      const lead = makeGraphApiLeadResponse()
      const dto = mapper.mapMetaLeadToDto(lead, meta)
      expect(dto.state).toBe('SP')
    })

    it('should map company_name to dto.empresa', () => {
      const lead = makeGraphApiLeadResponse()
      const dto = mapper.mapMetaLeadToDto(lead, meta)
      expect(dto.empresa).toBe('Acme Corp')
    })

    it('should map job_title to dto.cargo', () => {
      const lead = makeGraphApiLeadResponse()
      const dto = mapper.mapMetaLeadToDto(lead, meta)
      expect(dto.cargo).toBe('Developer')
    })

    it('should set source to Meta Lead Ads', () => {
      const lead = makeGraphApiLeadResponse()
      const dto = mapper.mapMetaLeadToDto(lead, meta)
      expect(dto.source).toBe('Meta Lead Ads')
    })

    it('should set companyId from meta', () => {
      const lead = makeGraphApiLeadResponse()
      const dto = mapper.mapMetaLeadToDto(lead, meta)
      expect(dto.companyId).toBe(DEFAULT_META.companyId)
    })
  })

  // ===== Name Composition =====

  describe('Name Composition', () => {
    it('should prefer full_name over name', () => {
      const lead = makeGraphApiLeadResponse({
        field_data: [
          { name: 'full_name', values: ['Full Name'] },
          { name: 'name', values: ['Just Name'] },
        ],
      })
      const dto = mapper.mapMetaLeadToDto(lead, meta)
      expect(dto.name).toBe('Full Name')
    })

    it('should fallback to name when full_name is absent', () => {
      const lead = makeGraphApiLeadResponse({
        field_data: [{ name: 'name', values: ['Just Name'] }],
      })
      const dto = mapper.mapMetaLeadToDto(lead, meta)
      expect(dto.name).toBe('Just Name')
    })

    it('should join first_name + last_name when no full_name/nome/name', () => {
      const lead = makeGraphApiLeadResponse({
        field_data: [
          { name: 'first_name', values: ['John'] },
          { name: 'last_name', values: ['Smith'] },
        ],
      })
      const dto = mapper.mapMetaLeadToDto(lead, meta)
      expect(dto.name).toBe('John Smith')
    })

    it('should use only first_name when last_name is absent', () => {
      const lead = makeGraphApiLeadResponse({
        field_data: [{ name: 'first_name', values: ['John'] }],
      })
      const dto = mapper.mapMetaLeadToDto(lead, meta)
      expect(dto.name).toBe('John')
    })

    it('should map first_name to dto.first_name', () => {
      const lead = makeGraphApiLeadResponse({
        field_data: [
          { name: 'first_name', values: ['John'] },
          { name: 'last_name', values: ['Doe'] },
        ],
      })
      const dto = mapper.mapMetaLeadToDto(lead, meta)
      expect(dto.first_name).toBe('John')
      expect(dto.last_name).toBe('Doe')
    })

    it('should fallback primeiro_nome + sobrenome for name composition', () => {
      const lead = makeGraphApiLeadResponse({
        field_data: [
          { name: 'primeiro_nome', values: ['Joao'] },
          { name: 'sobrenome', values: ['Silva'] },
        ],
      })
      const dto = mapper.mapMetaLeadToDto(lead, meta)
      expect(dto.name).toBe('Joao Silva')
    })
  })

  // ===== PT-BR Field Fallbacks =====

  describe('PT-BR Field Fallbacks', () => {
    it('should map nome_completo to name', () => {
      const lead = makeGraphApiLeadResponse({
        field_data: [{ name: 'nome_completo', values: ['Joao Silva'] }],
      })
      const dto = mapper.mapMetaLeadToDto(lead, meta)
      expect(dto.name).toBe('Joao Silva')
    })

    it('should map nome to name as third fallback', () => {
      const lead = makeGraphApiLeadResponse({
        field_data: [{ name: 'nome', values: ['Joao'] }],
      })
      const dto = mapper.mapMetaLeadToDto(lead, meta)
      expect(dto.name).toBe('Joao')
    })

    it('should map e-mail to email', () => {
      const lead = makeGraphApiLeadResponse({
        field_data: [{ name: 'e-mail', values: ['joao@test.com'] }],
      })
      const dto = mapper.mapMetaLeadToDto(lead, meta)
      expect(dto.email).toBe('joao@test.com')
    })

    it('should map telefone to phone', () => {
      const lead = makeGraphApiLeadResponse({
        field_data: [{ name: 'telefone', values: ['+5511999'] }],
      })
      const dto = mapper.mapMetaLeadToDto(lead, meta)
      expect(dto.phone).toBe('+5511999')
    })

    it('should map whatsapp to phone as final fallback', () => {
      const lead = makeGraphApiLeadResponse({
        field_data: [{ name: 'whatsapp', values: ['+5511888'] }],
      })
      const dto = mapper.mapMetaLeadToDto(lead, meta)
      expect(dto.phone).toBe('+5511888')
    })

    it('should map cidade to city', () => {
      const lead = makeGraphApiLeadResponse({
        field_data: [{ name: 'cidade', values: ['Curitiba'] }],
      })
      const dto = mapper.mapMetaLeadToDto(lead, meta)
      expect(dto.city).toBe('Curitiba')
    })

    it('should map estado to state', () => {
      const lead = makeGraphApiLeadResponse({
        field_data: [{ name: 'estado', values: ['PR'] }],
      })
      const dto = mapper.mapMetaLeadToDto(lead, meta)
      expect(dto.state).toBe('PR')
    })

    it('should map empresa to dto.empresa', () => {
      const lead = makeGraphApiLeadResponse({
        field_data: [{ name: 'empresa', values: ['Empresa X'] }],
      })
      const dto = mapper.mapMetaLeadToDto(lead, meta)
      expect(dto.empresa).toBe('Empresa X')
    })

    it('should map cargo to dto.cargo', () => {
      const lead = makeGraphApiLeadResponse({
        field_data: [{ name: 'cargo', values: ['Diretor'] }],
      })
      const dto = mapper.mapMetaLeadToDto(lead, meta)
      expect(dto.cargo).toBe('Diretor')
    })

    it('should map all PT-BR fields from makePtBrLeadResponse', () => {
      const lead = makePtBrLeadResponse()
      const dto = mapper.mapMetaLeadToDto(lead, meta)

      expect(dto.name).toBe('Joao Silva')
      expect(dto.email).toBe('joao@exemplo.com')
      expect(dto.phone).toBe('+5521988776655')
      expect(dto.city).toBe('Rio de Janeiro')
      expect(dto.state).toBe('RJ')
      expect(dto.empresa).toBe('Empresa Teste')
      expect(dto.cargo).toBe('Gerente')
      expect(dto.street_address).toBe('Rua Test 123')
      expect(dto.zip_code).toBe('01001-000')
      expect(dto.country).toBe('Brasil')
      expect(dto.date_of_birth).toBe('1990-01-15')
      expect(dto.gender).toBe('Masculino')
      expect(dto.cpf).toBe('123.456.789-00')
      expect(dto.marital_status).toBe('Solteiro')
      expect(dto.work_email).toBe('joao@empresa.com')
      expect(dto.work_phone_number).toBe('+552133334444')
      expect(dto.military_status).toBe('N/A')
      expect(dto.relationship_status).toBe('Solteiro')
    })

    it('should map endereco to street_address', () => {
      const lead = makeGraphApiLeadResponse({
        field_data: [{ name: 'endereco', values: ['Rua A 100'] }],
      })
      const dto = mapper.mapMetaLeadToDto(lead, meta)
      expect(dto.street_address).toBe('Rua A 100')
    })

    it('should map endereço (with accent) to street_address', () => {
      const lead = makeGraphApiLeadResponse({
        field_data: [{ name: 'endereço', values: ['Rua B 200'] }],
      })
      const dto = mapper.mapMetaLeadToDto(lead, meta)
      expect(dto.street_address).toBe('Rua B 200')
    })

    it('should map cep to zip_code', () => {
      const lead = makeGraphApiLeadResponse({
        field_data: [{ name: 'cep', values: ['12345-678'] }],
      })
      const dto = mapper.mapMetaLeadToDto(lead, meta)
      expect(dto.zip_code).toBe('12345-678')
    })

    it('should map post_code to zip_code', () => {
      const lead = makeGraphApiLeadResponse({
        field_data: [{ name: 'post_code', values: ['90000'] }],
      })
      const dto = mapper.mapMetaLeadToDto(lead, meta)
      expect(dto.zip_code).toBe('90000')
    })

    it('should map país (with accent) to country', () => {
      const lead = makeGraphApiLeadResponse({
        field_data: [{ name: 'país', values: ['Brasil'] }],
      })
      const dto = mapper.mapMetaLeadToDto(lead, meta)
      expect(dto.country).toBe('Brasil')
    })

    it('should map data_de_nascimento to date_of_birth', () => {
      const lead = makeGraphApiLeadResponse({
        field_data: [{ name: 'data_de_nascimento', values: ['2000-05-10'] }],
      })
      const dto = mapper.mapMetaLeadToDto(lead, meta)
      expect(dto.date_of_birth).toBe('2000-05-10')
    })

    it('should map gênero (with accent) to gender', () => {
      const lead = makeGraphApiLeadResponse({
        field_data: [{ name: 'gênero', values: ['Feminino'] }],
      })
      const dto = mapper.mapMetaLeadToDto(lead, meta)
      expect(dto.gender).toBe('Feminino')
    })

    it('should map sexo to gender', () => {
      const lead = makeGraphApiLeadResponse({
        field_data: [{ name: 'sexo', values: ['M'] }],
      })
      const dto = mapper.mapMetaLeadToDto(lead, meta)
      expect(dto.gender).toBe('M')
    })

    it('should map id_cpf to cpf', () => {
      const lead = makeGraphApiLeadResponse({
        field_data: [{ name: 'id_cpf', values: ['111.222.333-44'] }],
      })
      const dto = mapper.mapMetaLeadToDto(lead, meta)
      expect(dto.cpf).toBe('111.222.333-44')
    })

    it('should map email_corporativo to work_email', () => {
      const lead = makeGraphApiLeadResponse({
        field_data: [{ name: 'email_corporativo', values: ['work@corp.com'] }],
      })
      const dto = mapper.mapMetaLeadToDto(lead, meta)
      expect(dto.work_email).toBe('work@corp.com')
    })

    it('should map phone_work to work_phone_number', () => {
      const lead = makeGraphApiLeadResponse({
        field_data: [{ name: 'phone_work', values: ['+551130001000'] }],
      })
      const dto = mapper.mapMetaLeadToDto(lead, meta)
      expect(dto.work_phone_number).toBe('+551130001000')
    })
  })

  // ===== UTM Handling =====

  describe('UTM Handling', () => {
    it('should build UTM string from field_data', () => {
      const lead = makeLeadResponseWithUtms()
      const dto = mapper.mapMetaLeadToDto(lead, meta)
      expect(dto.utms).toContain('utm_campaign=black_friday')
      expect(dto.utms).toContain('utm_source=facebook')
      expect(dto.utms).toContain('utm_medium=cpc')
      expect(dto.utms).toContain('utm_content=banner_v2')
      expect(dto.utms).toContain('utm_term=comprar')
    })

    it('should fallback to leadData.campaign_name for utm_campaign', () => {
      const lead = makeGraphApiLeadResponse({
        field_data: [{ name: 'full_name', values: ['Test'] }],
        campaign_name: 'Fallback Campaign',
      })
      const dto = mapper.mapMetaLeadToDto(lead, meta)
      expect(dto.utms).toContain('utm_campaign=Fallback Campaign')
    })

    it('should produce empty utms string when no UTMs present', () => {
      const lead = makeMinimalLeadResponse()
      const dto = mapper.mapMetaLeadToDto(lead, meta)
      expect(dto.utms).toBe('')
    })

    it('should only include non-empty UTM parts', () => {
      const lead = makeGraphApiLeadResponse({
        field_data: [
          { name: 'utm_source', values: ['google'] },
        ],
        campaign_name: undefined,
      })
      const dto = mapper.mapMetaLeadToDto(lead, meta)
      expect(dto.utms).toBe('utm_source=google')
      expect(dto.utms).not.toContain('utm_medium=')
      expect(dto.utms).not.toContain('utm_content=')
    })
  })

  // ===== Meta-Level Fields =====

  describe('Meta-Level Fields', () => {
    it('should set canal to leadData.platform', () => {
      const lead = makeGraphApiLeadResponse({ platform: 'instagram' })
      const dto = mapper.mapMetaLeadToDto(lead, meta)
      expect(dto.canal).toBe('instagram')
    })

    it('should default canal to facebook when platform is undefined', () => {
      const lead = makeGraphApiLeadResponse({ platform: undefined })
      const dto = mapper.mapMetaLeadToDto(lead, meta)
      expect(dto.canal).toBe('facebook')
    })

    it('should set externalUserId to leadData.id (leadgen_id)', () => {
      const lead = makeGraphApiLeadResponse({ id: 'lg_123' })
      const dto = mapper.mapMetaLeadToDto(lead, meta)
      expect(dto.externalUserId).toBe('lg_123')
    })

    it('should use meta.pageId over leadData.page_id', () => {
      const lead = makeGraphApiLeadResponse({ page_id: 'lead_page' })
      const dto = mapper.mapMetaLeadToDto(lead, { ...meta, pageId: 'meta_page' })
      expect(dto.page_id).toBe('meta_page')
    })

    it('should fallback to leadData.page_id when meta.pageId is empty', () => {
      const lead = makeGraphApiLeadResponse({ page_id: 'lead_page' })
      const dto = mapper.mapMetaLeadToDto(lead, { ...meta, pageId: '' })
      expect(dto.page_id).toBe('lead_page')
    })

    it('should use meta.formId over leadData.form_id', () => {
      const lead = makeGraphApiLeadResponse({ form_id: 'lead_form' })
      const dto = mapper.mapMetaLeadToDto(lead, { ...meta, formId: 'meta_form' })
      expect(dto.form_id).toBe('meta_form')
    })

    it('should use meta.adId over leadData.ad_id', () => {
      const lead = makeGraphApiLeadResponse({ ad_id: 'lead_ad' })
      const dto = mapper.mapMetaLeadToDto(lead, { ...meta, adId: 'meta_ad' })
      expect(dto.ad_id).toBe('meta_ad')
    })

    it('should use meta.adsetId over leadData.adset_id', () => {
      const lead = makeGraphApiLeadResponse({ adset_id: 'lead_adset' })
      const dto = mapper.mapMetaLeadToDto(lead, { ...meta, adsetId: 'meta_adset' })
      expect(dto.adset_id).toBe('meta_adset')
    })

    it('should map ad_name and adset_name from leadData', () => {
      const lead = makeGraphApiLeadResponse({ ad_name: 'My Ad', adset_name: 'My Adset' })
      const dto = mapper.mapMetaLeadToDto(lead, meta)
      expect(dto.ad_name).toBe('My Ad')
      expect(dto.adset_name).toBe('My Adset')
    })

    it('should map meta_campaign_id and meta_campaign_name', () => {
      const lead = makeGraphApiLeadResponse({ campaign_id: 'camp_x', campaign_name: 'Camp X' })
      const dto = mapper.mapMetaLeadToDto(lead, meta)
      expect(dto.meta_campaign_id).toBe('camp_x')
      expect(dto.meta_campaign_name).toBe('Camp X')
    })

    it('should map is_organic', () => {
      const lead = makeOrganicLeadResponse()
      const dto = mapper.mapMetaLeadToDto(lead, meta)
      expect(dto.is_organic).toBe(true)
    })

    it('should default is_organic to false when undefined', () => {
      const lead = makeGraphApiLeadResponse({ is_organic: undefined })
      const dto = mapper.mapMetaLeadToDto(lead, meta)
      expect(dto.is_organic).toBe(false)
    })

    it('should map custom_disclaimer_responses', () => {
      const lead = makeLeadResponseWithDisclaimers()
      const dto = mapper.mapMetaLeadToDto(lead, meta)
      expect(dto.custom_disclaimer_responses).toEqual([
        { checkbox_key: 'privacy_policy', is_checked: 'true' },
        { checkbox_key: 'terms_of_service', is_checked: 'false' },
      ])
    })

    it('should map meta_created_time from leadData.created_time', () => {
      const lead = makeGraphApiLeadResponse({ created_time: '2024-04-08T15:00:00+0000' })
      const dto = mapper.mapMetaLeadToDto(lead, meta)
      expect(dto.meta_created_time).toBe('2024-04-08T15:00:00+0000')
    })
  })

  // ===== Extra/Custom Fields =====

  describe('Extra/Custom Fields', () => {
    it('should populate notes with unmapped fields', () => {
      const lead = makeLeadResponseWithCustomFields()
      const dto = mapper.mapMetaLeadToDto(lead, meta)
      expect((dto as any).notes).toContain('[Meta Form]')
      expect((dto as any).notes).toContain('como_conheceu_nos: Instagram')
      expect((dto as any).notes).toContain('qual_seu_objetivo: Emagrecer')
    })

    it('should join multiple unmapped fields with |', () => {
      const lead = makeLeadResponseWithCustomFields()
      const dto = mapper.mapMetaLeadToDto(lead, meta)
      expect((dto as any).notes).toContain(' | ')
    })

    it('should not include mapped fields in notes', () => {
      const lead = makeGraphApiLeadResponse()
      const dto = mapper.mapMetaLeadToDto(lead, meta)
      expect((dto as any).notes).toBeUndefined()
    })

    it('should populate history_details with all field_data entries', () => {
      const lead = makeLeadResponseWithCustomFields()
      const dto = mapper.mapMetaLeadToDto(lead, meta)
      expect((dto as any).history_details).toContain('Respostas do Formulário Meta:')
      expect((dto as any).history_details).toContain('full_name: Custom User')
      expect((dto as any).history_details).toContain('email: custom@example.com')
      expect((dto as any).history_details).toContain('como_conheceu_nos: Instagram')
    })

    it('should not set history_details when field_data is empty', () => {
      const lead = makeMinimalLeadResponse()
      const dto = mapper.mapMetaLeadToDto(lead, meta)
      expect((dto as any).history_details).toBeUndefined()
    })
  })

  // ===== Edge Cases =====

  describe('Edge Cases', () => {
    it('should handle undefined field_data without crash', () => {
      const lead: MetaLeadData = {
        id: 'lg_edge_001',
        created_time: '2024-04-08T12:00:00+0000',
        field_data: undefined as any,
      }
      const dto = mapper.mapMetaLeadToDto(lead, meta)
      expect(dto.name).toBe('')
      expect(dto.email).toBe('')
      expect(dto.phone).toBe('')
    })

    it('should handle empty field_data array', () => {
      const lead = makeMinimalLeadResponse()
      const dto = mapper.mapMetaLeadToDto(lead, meta)
      expect(dto.name).toBe('')
      expect(dto.email).toBe('')
      expect(dto.phone).toBe('')
      expect(dto.source).toBe('Meta Lead Ads')
    })

    it('should handle field with empty values array', () => {
      const lead = makeGraphApiLeadResponse({
        field_data: [{ name: 'full_name', values: [] }],
      })
      const dto = mapper.mapMetaLeadToDto(lead, meta)
      expect(dto.name).toBe('')
    })

    it('should return empty strings for all optional fields when not present', () => {
      const lead = makeMinimalLeadResponse()
      const dto = mapper.mapMetaLeadToDto(lead, meta)
      expect(dto.city).toBe('')
      expect(dto.state).toBe('')
      expect(dto.empresa).toBe('')
      expect(dto.cargo).toBe('')
      expect(dto.street_address).toBe('')
      expect(dto.zip_code).toBe('')
      expect(dto.country).toBe('')
      expect(dto.date_of_birth).toBe('')
      expect(dto.gender).toBe('')
      expect(dto.cpf).toBe('')
      expect(dto.marital_status).toBe('')
    })

    it('should prefer EN field over PT-BR when both present', () => {
      const lead = makeGraphApiLeadResponse({
        field_data: [
          { name: 'full_name', values: ['English Name'] },
          { name: 'nome_completo', values: ['Nome Portugues'] },
        ],
      })
      const dto = mapper.mapMetaLeadToDto(lead, meta)
      expect(dto.name).toBe('English Name')
    })

    it('should handle ad_name fallback from field_data', () => {
      const lead = makeGraphApiLeadResponse({
        ad_name: undefined,
        field_data: [
          { name: 'full_name', values: ['Test'] },
          { name: 'ad_name', values: ['From Field Data'] },
        ],
      })
      const dto = mapper.mapMetaLeadToDto(lead, meta)
      expect(dto.ad_name).toBe('From Field Data')
    })
  })
})
