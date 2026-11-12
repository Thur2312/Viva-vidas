import { ApiProperty } from '@nestjs/swagger'
import { FreeFormDto } from 'src/shared/validation/free-form-dto.decorator'

/**
 * Payload de criação de lead.
 *
 * OBRIGATÓRIO É O CONTATO: email OU telefone. Nenhum outro campo é exigido — inclusive
 * `name`, que quando ausente vira string vazia.
 *
 * De propósito NÃO há decorators de `class-validator` aqui, e o DTO é marcado com
 * `@FreeFormDto()`: o ValidationPipe global aplica `whitelist` aos DTOs decorados, e o whitelist
 * apagaria os ~200 apelidos de campo aceitos pelo TransformLeadDataPipe (`Qual_seu_e_mail`,
 * `IP_do_usuario`, `resposta_*`, `geo_*`...) — e, num DTO sem decorators, TODOS os campos,
 * inclusive `email` e `phone` (foi o que derrubou a criação de leads de 09/10 a 14/10/2026).
 * A validação real é imperativa, em leads-api-creation.service.ts.
 */
@FreeFormDto()
export class CreateLeadDto {
  // Elo com o tracker (optin.js). Sem decorators de validação de propósito (ver nota acima):
  // um valor inválido é IGNORADO em silêncio em vez de derrubar a captura com 400.
  @ApiProperty({ required: false, description: 'ID anônimo do visitante (UUID v4, cookie hdm_vid). Opcional; inválido é ignorado.' })
  visitor_id?: string

  @ApiProperty({ required: false, description: 'ID da sessão do visitante (UUID v4). Opcional; hoje só é aceito, não persistido.' })
  session_id?: string

  // Campos de identificação da empresa
  @ApiProperty({ required: false, description: 'Resolvido a partir da campanha; não precisa ser enviado.' })
  companyId?: string

  // Campos de nome
  @ApiProperty({ required: false, nullable: true, description: 'Nome do lead. Opcional — sem ele o lead é criado sem nome.', example: 'Jose Silva' })
  readonly name?: string | null

  // Campos de email
  @ApiProperty({ required: false, description: 'Email do lead. Obrigatório se `phone` não for enviado.', example: 'jose.silva@email.com' })
  readonly email?: string

  // Campos de telefone
  @ApiProperty({
    required: false,
    description:
      'Telefone do lead. Obrigatório se `email` não for enviado. Aceita BR (com ou sem DDI 55) e ' +
      'internacional — fora do Brasil, envie com "+" e o código do país (ex.: +351912345678).',
    example: '5511999999999',
  })
  readonly phone?: string

  // Campos de IP
  @ApiProperty({
    required: false,
    description: 'IP do lead. Se omitido, o servidor usa o IP da requisição (X-Forwarded-For).',
    example: '189.100.50.25',
  })
  leadIp?: string

  // Campos de localização
  @ApiProperty({
    required: false,
    description: 'Estado, sigla de 2 letras. Se omitido, é deduzido do IP quando ele for de usuário final.',
    example: 'SP',
  })
  state?: string

  @ApiProperty({
    required: false,
    description: 'Cidade. Se omitida, é deduzida do IP quando ele for de usuário final.',
    example: 'Sao Paulo',
  })
  city?: string

  // Campos de redes sociais
  @ApiProperty()
  readonly instagramUrl?: string

  @ApiProperty()
  readonly linkedinUrl?: string

  @ApiProperty()
  readonly facebookUrl?: string

  @ApiProperty()
  readonly youtubeUrl?: string

  // Campos de URL e UTMs
  //
  // `utms?` e não `utms`: sem a interrogação o plugin do Swagger marcava este como o ÚNICO
  // campo obrigatório do payload — o inverso do contrato real, que exige email ou telefone
  // e não exige utms.
  @ApiProperty({
    required: false,
    description: 'UTMs concatenadas. Alternativamente envie os campos individuais (utm_source, utm_medium...) ou na query string — as três formas são mescladas.',
    example: 'utm_source=meta-ads&utm_medium=cpc&utm_campaign=webinar-semanal',
  })
  readonly utms?: string

  // Campos de histórico e detalhes
  @ApiProperty()
  readonly history_details?: string

  @ApiProperty()
  readonly link_chat?: string

  // Campos de canal e origem
  @ApiProperty()
  readonly canal?: string

  @ApiProperty()
  readonly source?: string

  // Campos de atendimento
  @ApiProperty()
  readonly atendente?: string

  // Campos de identificação externa
  @ApiProperty()
  readonly externalUserId?: string

  // Campos de campanha e tags
  @ApiProperty()
  readonly tag?: string

  @ApiProperty()
  readonly campaignId?: string

  // Campos de agendamento
  @ApiProperty()
  readonly data_agendada?: string

  @ApiProperty()
  readonly Data_da_conversao?: string

  @ApiProperty()
  readonly meet_link?: string

  // Campos de análise
  @ApiProperty()
  readonly analysis?: string

  @ApiProperty()
  readonly analysisManager?: string

  @ApiProperty()
  readonly Analyse?: string

  @ApiProperty()
  readonly encerrar?: string

  // Campos de dispositivo
  @ApiProperty()
  readonly Dispositivo?: string

  // Campos do diagnóstico
  @ApiProperty()
  readonly fbclid?: string

  @ApiProperty()
  readonly fbp?: string

  @ApiProperty()
  readonly empresa?: string

  @ApiProperty()
  readonly cargo?: string

  @ApiProperty()
  readonly source_url?: string

  // Proveniência server-side (preenchida por LeadsQueryParamsService.applyServerProvenance).
  // origin_url/origin_type são persistidos; referer_url/origin_host são transientes,
  // injetados pelo proxy Next.js a partir dos headers Referer/Origin.
  @ApiProperty({ required: false })
  origin_url?: string

  @ApiProperty({ required: false })
  origin_type?: string

  @ApiProperty({ required: false })
  referer_url?: string

  @ApiProperty({ required: false })
  origin_host?: string

  @ApiProperty()
  readonly faturamento?: string

  @ApiProperty()
  readonly score_total?: string

  @ApiProperty()
  readonly perda_mensal?: string

  @ApiProperty()
  readonly perda_anual?: string

  @ApiProperty()
  readonly visit_count?: string

  @ApiProperty()
  readonly first_visit_at?: string

  @ApiProperty()
  readonly last_visit_at?: string

  @ApiProperty()
  readonly notes?: string

  @ApiProperty()
  readonly ai_analysis?: string

  // Campos JSONB
  //
  // Podem ser enviados prontos OU montados pelo pipe a partir de campos soltos no root do
  // payload (`resposta_*` → diagnostic_data, `geo_*` → geo_data, `browser_*` → browser_data).
  // Quando as duas formas vêm juntas, os campos soltos vencem — não há merge.
  @ApiProperty({
    required: false,
    description:
      'Diagnóstico/quiz. Aceita o objeto pronto ou os campos soltos `resposta_*`, `progress`, `score_*`. ' +
      'Envio em etapas é suportado: um payload com `progress` MAIOR substitui o anterior; ' +
      'progresso igual ou menor não altera nada.',
    example: {
      progress: '100',
      score_marketing: '2.33',
      score_comercial: '1.67',
      score_cs: '2',
      score_financeiro: '65',
      interesse_mentoria: 'Sim',
      preferencia_contato: 'WhatsApp',
      resposta_A1: '50000',
    },
  })
  readonly diagnostic_data?: any

  @ApiProperty({
    required: false,
    description: 'Geolocalização. Aceita o objeto pronto ou os campos soltos `geo_country`, `geo_region`, `geo_city`, `geo_lat`, `geo_lon`, `geo_isp`.',
    example: { country: 'BR', region: 'SP', city: 'Sao Paulo', lat: '-23.5505', lon: '-46.6333', isp: 'Vivo' },
  })
  readonly geo_data?: any

  @ApiProperty({
    required: false,
    description: 'Dados do navegador. Aceita o objeto pronto ou os campos soltos `browser_*` (o prefixo é removido na chave).',
    example: { user_agent: 'Mozilla/5.0 ...', language: 'pt-BR' },
  })
  readonly browser_data?: any

  // Campos do Facebook Lead Ads
  @ApiProperty()
  readonly adset_id?: string

  @ApiProperty()
  readonly adset_name?: string

  @ApiProperty()
  readonly ad_id?: string

  @ApiProperty()
  readonly ad_name?: string

  @ApiProperty()
  readonly page_id?: string

  @ApiProperty()
  readonly page_name?: string

  @ApiProperty()
  readonly form_id?: string

  @ApiProperty()
  readonly form_name?: string

  @ApiProperty()
  readonly form_locale?: string

  @ApiProperty()
  readonly form_status?: string

  // Meta Lead Ads — campos extras
  @ApiProperty()
  readonly street_address?: string

  @ApiProperty()
  readonly zip_code?: string

  @ApiProperty()
  readonly country?: string

  @ApiProperty()
  readonly date_of_birth?: string

  @ApiProperty()
  readonly gender?: string

  @ApiProperty()
  readonly cpf?: string

  @ApiProperty()
  readonly marital_status?: string

  // Meta Lead Ads — campos extras (batch 2)
  @ApiProperty()
  readonly first_name?: string

  @ApiProperty()
  readonly last_name?: string

  @ApiProperty()
  readonly work_email?: string

  @ApiProperty()
  readonly work_phone_number?: string

  @ApiProperty()
  readonly meta_campaign_id?: string

  @ApiProperty()
  readonly meta_campaign_name?: string

  @ApiProperty()
  readonly is_organic?: boolean

  // Meta Lead Ads — campos extras (batch 3)
  @ApiProperty()
  readonly meta_created_time?: string

  @ApiProperty()
  readonly custom_disclaimer_responses?: any

  @ApiProperty()
  readonly military_status?: string

  @ApiProperty()
  readonly relationship_status?: string
}

@FreeFormDto()
export class LeadToOpportunityDto {
  id: number
  name: string
  email: string
  phone: string
  companyId: string
  userId: string
  tags?: string[]
  /** Template de Jornada (GenericDndColumnSet) de destino — fallback manual do modal */
  columnSetId?: string
}

export class LeadToTaskDto {
  id: number
  name: string
  email: string
  phone: string
  companyId: string
  userId: string
  meet_link: string
  data_agendada: string
}
