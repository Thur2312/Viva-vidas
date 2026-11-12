import { Injectable } from '@nestjs/common'
import { CreateLeadDto } from 'src/modules/admin/leads-management/dto/create-leads-management.dto'
import { MetaLeadData } from './types/meta-lead.types'

@Injectable()
export class MetaLeadsMapperService {
  getFieldValue(fieldData: { name: string; values: string[] }[], fieldName: string): string | null {
    const field = fieldData.find(item => item.name === fieldName)
    return field?.values?.[0] || null
  }

  mapMetaLeadToDto(
    leadData: MetaLeadData,
    meta: { companyId: string; pageId: string; formId: string; adId?: string; adsetId?: string },
  ): CreateLeadDto {
    const fd = leadData.field_data || []

    // Parse seguro por name (nao por index)
    const name =
      this.getFieldValue(fd, 'full_name') ||
      this.getFieldValue(fd, 'nome_completo') ||
      this.getFieldValue(fd, 'nome') ||
      this.getFieldValue(fd, 'name') || ''

    const firstName = this.getFieldValue(fd, 'first_name') || this.getFieldValue(fd, 'primeiro_nome') || ''
    const lastName = this.getFieldValue(fd, 'last_name') || this.getFieldValue(fd, 'sobrenome') || ''
    const fullName = name || [firstName, lastName].filter(Boolean).join(' ')

    const email = this.getFieldValue(fd, 'email') || this.getFieldValue(fd, 'e-mail') || ''
    const phone = this.getFieldValue(fd, 'phone_number') || this.getFieldValue(fd, 'phone') || this.getFieldValue(fd, 'telefone') || this.getFieldValue(fd, 'whatsapp') || ''
    const city = this.getFieldValue(fd, 'city') || this.getFieldValue(fd, 'cidade') || ''
    const state = this.getFieldValue(fd, 'state') || this.getFieldValue(fd, 'estado') || ''
    const company = this.getFieldValue(fd, 'company_name') || this.getFieldValue(fd, 'empresa') || this.getFieldValue(fd, 'company') || ''
    const jobTitle = this.getFieldValue(fd, 'job_title') || this.getFieldValue(fd, 'cargo') || ''
    const streetAddress = this.getFieldValue(fd, 'street_address') || this.getFieldValue(fd, 'endereco') || this.getFieldValue(fd, 'endereço') || ''
    const zipCode = this.getFieldValue(fd, 'zip_code') || this.getFieldValue(fd, 'post_code') || this.getFieldValue(fd, 'cep') || ''
    const country = this.getFieldValue(fd, 'country') || this.getFieldValue(fd, 'pais') || this.getFieldValue(fd, 'país') || ''
    const dateOfBirth = this.getFieldValue(fd, 'date_of_birth') || this.getFieldValue(fd, 'data_nascimento') || this.getFieldValue(fd, 'data_de_nascimento') || ''
    const gender = this.getFieldValue(fd, 'gender') || this.getFieldValue(fd, 'genero') || this.getFieldValue(fd, 'gênero') || this.getFieldValue(fd, 'sexo') || ''
    const cpf = this.getFieldValue(fd, 'id_cpf') || this.getFieldValue(fd, 'cpf') || ''
    const maritalStatus = this.getFieldValue(fd, 'marital_status') || this.getFieldValue(fd, 'estado_civil') || ''
    const workEmail = this.getFieldValue(fd, 'work_email') || this.getFieldValue(fd, 'email_comercial') || this.getFieldValue(fd, 'email_corporativo') || ''
    const workPhoneNumber = this.getFieldValue(fd, 'work_phone_number') || this.getFieldValue(fd, 'telefone_comercial') || this.getFieldValue(fd, 'phone_work') || ''
    const militaryStatus = this.getFieldValue(fd, 'military_status') || this.getFieldValue(fd, 'status_militar') || ''
    const relationshipStatus = this.getFieldValue(fd, 'relationship_status') || this.getFieldValue(fd, 'relacionamento') || ''

    // Extrair UTMs nativos do Meta Lead Forms
    const utmCampaign = this.getFieldValue(fd, 'utm_campaign') || leadData.campaign_name || ''
    const utmSource = this.getFieldValue(fd, 'utm_source') || ''
    const utmMedium = this.getFieldValue(fd, 'utm_medium') || ''
    const utmContent = this.getFieldValue(fd, 'utm_content') || ''
    const utmTerm = this.getFieldValue(fd, 'utm_term') || ''

    // Montar string de UTMs no formato URL param
    const utmParts: string[] = []
    if (utmCampaign) utmParts.push(`utm_campaign=${utmCampaign}`)
    if (utmSource) utmParts.push(`utm_source=${utmSource}`)
    if (utmMedium) utmParts.push(`utm_medium=${utmMedium}`)
    if (utmContent) utmParts.push(`utm_content=${utmContent}`)
    if (utmTerm) utmParts.push(`utm_term=${utmTerm}`)

    const dto: CreateLeadDto = {
      name: fullName,
      email,
      phone,
      city,
      state,
      empresa: company,
      cargo: jobTitle,
      utms: utmParts.join('&'),
      source: 'Meta Lead Ads',
      canal: leadData.platform || 'facebook',
      companyId: meta.companyId,
      externalUserId: leadData.id, // leadgen_id como ID externo para dedup
      // Facebook Lead Ads fields
      page_id: meta.pageId || leadData.page_id,
      form_id: meta.formId || leadData.form_id,
      ad_id: meta.adId || leadData.ad_id,
      ad_name: leadData.ad_name || this.getFieldValue(fd, 'ad_name'),
      adset_id: meta.adsetId || leadData.adset_id,
      adset_name: leadData.adset_name || this.getFieldValue(fd, 'adset_name'),
      // Meta Lead Ads — campos extras
      street_address: streetAddress,
      zip_code: zipCode,
      country,
      date_of_birth: dateOfBirth,
      gender,
      cpf,
      marital_status: maritalStatus,
      // Meta Lead Ads — campos extras (batch 2)
      first_name: firstName || undefined,
      last_name: lastName || undefined,
      work_email: workEmail || undefined,
      work_phone_number: workPhoneNumber || undefined,
      meta_campaign_id: leadData.campaign_id || undefined,
      meta_campaign_name: leadData.campaign_name || undefined,
      is_organic: leadData.is_organic || false,
      // Meta Lead Ads — campos extras (batch 3)
      meta_created_time: leadData.created_time || undefined,
      custom_disclaimer_responses: leadData.custom_disclaimer_responses || undefined,
      military_status: militaryStatus || undefined,
      relationship_status: relationshipStatus || undefined,
    }

    // Campos customizados do formulario que nao mapeiam diretamente
    const mappedFields = new Set([
      'full_name', 'nome_completo', 'nome', 'name', 'first_name', 'primeiro_nome',
      'last_name', 'sobrenome', 'email', 'e-mail', 'phone_number', 'phone',
      'telefone', 'whatsapp', 'city', 'cidade', 'state', 'estado',
      'company_name', 'empresa', 'company', 'job_title', 'cargo',
      'utm_campaign', 'utm_source', 'utm_medium', 'utm_content', 'utm_term',
      'ad_name', 'adset_name',
      'street_address', 'endereco', 'endereço',
      'zip_code', 'post_code', 'cep',
      'country', 'pais', 'país',
      'date_of_birth', 'data_nascimento', 'data_de_nascimento',
      'gender', 'genero', 'gênero', 'sexo',
      'id_cpf', 'cpf',
      'marital_status', 'estado_civil',
      'work_email', 'email_comercial', 'email_corporativo',
      'work_phone_number', 'telefone_comercial', 'phone_work',
      'military_status', 'status_militar',
      'relationship_status', 'relacionamento',
    ])

    const extraFields: string[] = []
    for (const field of fd) {
      const key = field.name.toLowerCase()
      const value = field.values?.[0]
      if (!mappedFields.has(key) && value) {
        extraFields.push(`${field.name}: ${value}`)
      }
    }

    if (extraFields.length > 0) {
      (dto as any).notes = `[Meta Form] ${extraFields.join(' | ')}`
    }

    // Gerar history_details com TODAS as respostas do formulario → vira comentario no lead
    const allResponses: string[] = []
    for (const field of fd) {
      const value = field.values?.[0]
      if (value) {
        allResponses.push(`${field.name}: ${value}`)
      }
    }

    if (allResponses.length > 0) {
      ;(dto as any).history_details = `Respostas do Formulário Meta:\n${allResponses.join('\n')}`
    }

    return dto
  }
}
