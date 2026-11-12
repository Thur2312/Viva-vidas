import { Injectable, Logger } from '@nestjs/common'
import { PrismaService } from 'src/database/prisma.service'
import { LeadsManagementService } from 'src/modules/admin/leads-management/leads-management.service'
import { MetaLeadFormsService } from 'src/modules/meta-ads/services/meta-lead-forms.service'
import { META_API_BASE, META_API_VERSION } from 'src/modules/meta-ads/constants/meta-ads.constants'
import { CreateLeadDto } from 'src/modules/admin/leads-management/dto/create-leads-management.dto'
import { MetaLeadWebhookPayload, MetaLeadChangeValue, MetaLeadData } from './types/meta-lead.types'
import { MetaLeadsConfigService } from './meta-leads-config.service'
import { MetaLeadsMapperService } from './meta-leads-mapper.service'
import { MetaLeadsRoutingService } from './meta-leads-routing.service'
import { MetaLeadsFallbackService } from './meta-leads-fallback.service'
import { CompanyStatusService } from 'src/shared/services/company-status.service'

@Injectable()
export class WebhookMetaLeadsService {
  private readonly logger = new Logger(WebhookMetaLeadsService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly leadsService: LeadsManagementService,
    private readonly metaLeadFormsService: MetaLeadFormsService,
    private readonly configService: MetaLeadsConfigService,
    private readonly mapperService: MetaLeadsMapperService,
    private readonly routingService: MetaLeadsRoutingService,
    private readonly fallbackService: MetaLeadsFallbackService,
    private readonly companyStatus: CompanyStatusService,
  ) {}

  // ===== Handshake de Validacao (GET) =====

  async verifyWebhook(subdomain: string, mode: string, token: string, challenge: string): Promise<string | null> {
    if (mode !== 'subscribe') {
      this.logger.warn(`[Meta Leads] Webhook verification failed: mode=${mode} (expected subscribe)`)
      return null
    }

    const company = await this.prisma.companies.findFirst({
      where: { subdomain, deleted_at: null },
      select: { id: true },
    })

    if (!company) {
      this.logger.warn(`[Meta Leads] Company not found for subdomain=${subdomain}`)
      return null
    }

    // Coletar todos os tokens validos (per-campaign + global + env)
    const validTokens: string[] = []

    // 1. Tokens por campanha
    const campaignTokens = await this.metaLeadFormsService.listCampaignVerifyTokensByCompanyId(company.id)
    validTokens.push(...campaignTokens)

    // 2. Token global da empresa (integrations)
    const dbVerifyToken = await this.configService.getVerifyTokenForSubdomain(subdomain)
    if (dbVerifyToken) validTokens.push(dbVerifyToken)

    // 3. Fallback env vars
    const envToken = process.env.META_LEADS_WEBHOOK_VERIFY_TOKEN || process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN
    if (envToken) validTokens.push(envToken)

    if (validTokens.length === 0) {
      this.logger.warn(`[Meta Leads] No verify token configured for subdomain=${subdomain}`)
      return null
    }

    if (validTokens.includes(token)) {
      this.logger.log(`[Meta Leads] Webhook verified successfully for subdomain=${subdomain}`)
      return challenge
    }

    this.logger.warn(`[Meta Leads] Webhook verification failed for subdomain=${subdomain}`)
    return null
  }

  // ===== Handshake por Campaign (GET) =====

  async verifyWebhookByCampaign(campaignToken: string, mode: string, token: string, challenge: string): Promise<string | null> {
    if (mode !== 'subscribe') return null

    const campaign = await this.prisma.campaigns.findFirst({
      where: { hdmMetaLeadToken: campaignToken, deleted_at: null },
      select: { campaignId: true, companyId: true, metaLeadsVerifyToken: true },
    })
    if (!campaign) return null

    const validTokens: string[] = []

    if (campaign.metaLeadsVerifyToken) validTokens.push(campaign.metaLeadsVerifyToken)

    const campaignTokens = await this.metaLeadFormsService.listCampaignVerifyTokensByCompanyId(campaign.companyId)
    validTokens.push(...campaignTokens)

    const envToken = process.env.META_LEADS_WEBHOOK_VERIFY_TOKEN || process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN
    if (envToken) validTokens.push(envToken)

    if (validTokens.includes(token)) {
      this.logger.log(`[Meta Leads] Webhook verified for campaign=${campaign.campaignId}`)
      return challenge
    }

    return null
  }

  // ===== Simulacao de Webhook (POST /test) =====

  async simulateWebhook(subdomain: string, token: string, leadData: any) {
    const company = await this.prisma.companies.findFirst({
      where: { subdomain, deleted_at: null },
      select: { id: true },
    })

    if (!company) {
      this.logger.warn(`[Meta Leads Test] Company not found for subdomain=${subdomain}`)
      return { error: 'Company not found' }
    }

    const dbVerifyToken = await this.configService.getVerifyTokenForSubdomain(subdomain)
    if (!dbVerifyToken || dbVerifyToken !== token) {
      this.logger.warn(`[Meta Leads Test] Invalid token for subdomain=${subdomain}`)
      return { error: 'Invalid token' }
    }

    const { name, email, phone, city, state, source, canal, form_id, page_id } = leadData

    const createLeadDto: CreateLeadDto = {
      name: name || 'Lead Teste Meta',
      email: email || `teste-${Date.now()}@meta-lead.com`,
      phone: phone || '11999999999',
      city: city || '',
      state: state || '',
      source: source || 'Meta Lead Ads (Test)',
      canal: canal || 'facebook',
      companyId: company.id,
      utms: '',
      form_id: form_id || undefined,
      page_id: page_id || undefined,
    }

    const fakeLeadData = { field_data: [] } as any
    const campaignId = await this.routingService.findCampaignForLead(company.id, fakeLeadData, page_id || '', form_id || '')

    try {
      if (campaignId) {
        await this.leadsService.createLead(campaignId, createLeadDto, { skipApiKeyValidation: true })
        this.logger.log(`[Meta Leads Test] Lead created with campaign=${campaignId} (via form_id=${form_id})`)
      } else {
        await this.fallbackService.createLeadWithoutCampaign(company.id, createLeadDto)
        this.logger.log(`[Meta Leads Test] Lead created without campaign for company=${company.id}`)
      }
      return { success: true, message: 'Test lead created successfully', campaignId: campaignId || null }
    } catch (error) {
      this.logger.error(`[Meta Leads Test] Error creating lead: ${error.message}`)
      return { error: error.message }
    }
  }

  // ===== Ingestao por Campaign (POST) =====

  async ingestWebhookByCampaign(
    campaignToken: string,
    payload: MetaLeadWebhookPayload,
    rawBody: Buffer | undefined,
    signature256?: string,
  ) {
    if (payload.object !== 'page') return { received: true }
    if (!payload.entry?.length) return { received: true }

    const campaign = await this.prisma.campaigns.findFirst({
      where: { hdmMetaLeadToken: campaignToken, deleted_at: null },
      select: { campaignId: true, companyId: true },
    })
    if (!campaign) return { received: true }

    // Empresa desativada: descarta com o mesmo 200 silencioso que este fluxo ja
    // usa para assinatura invalida — a Meta desabilita subscription que responde
    // erro repetidamente.
    if (!(await this.companyStatus.isActive(campaign.companyId))) {
      this.logger.warn(`[Meta Leads] Empresa inativa, evento descartado campaign=${campaign.campaignId}`)
      return { received: true }
    }

    // Fail-closed quando a empresa tem appSecret configurado: assinatura ausente ou
    // inválida descarta o evento (200 silencioso — não dar sinal a quem forja).
    const config = await this.configService.getWebhookConfig(campaign.companyId)
    if (config?.appSecret) {
      const isValid =
        // `rawBody?.length`, nao `!!rawBody`: Buffer VAZIO e truthy (string vazia nao era).
        !!rawBody?.length &&
        !!signature256 &&
        this.configService.validateSignature(rawBody, signature256, config.appSecret)
      if (!isValid) {
        this.logger.warn(
          `[Meta Leads] Assinatura ${this.describeSignatureFailure(rawBody, signature256)} (fail-closed) campaign=${campaign.campaignId}`,
        )
        return { received: true }
      }
    }

    for (const entry of payload.entry) {
      for (const change of entry.changes || []) {
        if (change.field !== 'leadgen' || !change.value?.leadgen_id) continue
        this.processLeadAsyncForCampaign(campaign.companyId, campaign.campaignId, change.value).catch(err => {
          this.logger.error(`[Meta Leads] Campaign processing failed: ${err.message}`)
        })
      }
    }

    return { received: true }
  }

  // ===== Ingestao do Evento (POST) =====

  async ingestWebhook(
    subdomain: string,
    payload: MetaLeadWebhookPayload,
    rawBody: Buffer | undefined,
    signature256?: string,
  ) {
    if (payload.object !== 'page') {
      this.logger.warn(`[Meta Leads] Object type not supported: ${payload.object}`)
      return { received: true }
    }

    if (!payload.entry?.length) {
      this.logger.warn('[Meta Leads] Empty entry array')
      return { received: true }
    }

    const company = await this.prisma.companies.findFirst({
      where: { subdomain, deleted_at: null },
      select: { id: true, status: true },
    })

    if (!company) {
      this.logger.warn(`[Meta Leads] Company not found for subdomain=${subdomain}`)
      return { received: true }
    }

    if (company.status !== 'ACTIVE') {
      this.logger.warn(`[Meta Leads] Empresa inativa, evento descartado subdomain=${subdomain}`)
      return { received: true }
    }

    const config = await this.configService.getWebhookConfig(company.id)

    // Fail-closed quando a empresa tem appSecret configurado (assinatura ausente também rejeita).
    if (config?.appSecret) {
      const isValid =
        // `rawBody?.length`, nao `!!rawBody`: Buffer VAZIO e truthy (string vazia nao era).
        !!rawBody?.length &&
        !!signature256 &&
        this.configService.validateSignature(rawBody, signature256, config.appSecret)
      if (!isValid) {
        this.logger.warn(
          `[Meta Leads] Assinatura ${this.describeSignatureFailure(rawBody, signature256)} (fail-closed) company=${company.id}`,
        )
        return { received: true }
      }
    }

    for (const entry of payload.entry) {
      for (const change of entry.changes || []) {
        if (change.field !== 'leadgen') continue
        if (!change.value?.leadgen_id) continue

        this.processLeadAsync(company.id, change.value).catch(err => {
          this.logger.error(`[Meta Leads] Async processing failed for leadgen_id=${change.value.leadgen_id}: ${err.message}`)
        })
      }
    }

    return { received: true }
  }

  // ===== Worker: Processamento Assincrono =====

  private async processLeadAsync(companyId: string, changeValue: MetaLeadChangeValue) {
    const { leadgen_id, page_id, form_id, ad_id, adgroup_id } = changeValue

    this.logger.log(`[Meta Leads] Processing lead async: leadgen_id=${leadgen_id}`)

    const accessToken = await this.configService.getMetaAccessToken(companyId)
    if (!accessToken) {
      this.logger.error(`[Meta Leads] No access token for company=${companyId}`)
      await this.fallbackService.saveRawEvent(companyId, changeValue, 'NO_ACCESS_TOKEN')
      return
    }

    let leadData: MetaLeadData
    try {
      leadData = await this.fetchLeadFromMeta(leadgen_id, accessToken)
    } catch (error) {
      this.logger.error(`[Meta Leads] Graph API error for leadgen_id=${leadgen_id}: ${error.message}`)
      await this.fallbackService.saveRawEvent(companyId, changeValue, `GRAPH_API_ERROR: ${error.message}`)
      return
    }

    const campaignId = await this.routingService.findCampaignForLead(companyId, leadData, page_id, form_id)

    try {
      const createLeadDto = this.mapperService.mapMetaLeadToDto(leadData, {
        companyId,
        pageId: page_id,
        formId: form_id,
        adId: ad_id || leadData.ad_id,
        adsetId: adgroup_id || leadData.adset_id,
      })

      if (campaignId) {
        await this.leadsService.createLead(campaignId, createLeadDto, { skipApiKeyValidation: true })
        this.logger.log(`[Meta Leads] Lead created: leadgen_id=${leadgen_id} -> campaign=${campaignId}`)
      } else {
        await this.fallbackService.createLeadWithoutCampaign(companyId, createLeadDto)
        this.logger.log(`[Meta Leads] Lead created without campaign: leadgen_id=${leadgen_id} company=${companyId}`)
      }
    } catch (error) {
      this.logger.error(`[Meta Leads] Error creating lead ${leadgen_id}: ${error.message}`)
      await this.fallbackService.saveRawEvent(companyId, changeValue, `CREATE_LEAD_ERROR: ${error.message}`, leadData)
    }
  }

  /**
   * Diz QUAL das tres coisas falhou. Sem isso, um `rawBody` ausente — que e defeito nosso,
   * de prefixo faltando em `main.ts` — aparecia no log como "assinatura invalida" e mandava
   * investigar o lado da Meta.
   */
  private describeSignatureFailure(rawBody?: Buffer, signature256?: string): string {
    if (!rawBody?.length) return 'nao verificavel (corpo cru ausente — conferir webhookPrefixes em main.ts)'
    if (!signature256) return 'ausente'
    return 'inválida'
  }

  private async processLeadAsyncForCampaign(companyId: string, campaignId: string, changeValue: MetaLeadChangeValue) {
    const { leadgen_id, page_id, form_id, ad_id, adgroup_id } = changeValue
    this.logger.log(`[Meta Leads] Processing lead for campaign=${campaignId}: leadgen_id=${leadgen_id}`)

    // Vínculo explícito form→campanha tem precedência sobre o token da URL: o webhook
    // da Meta é um callback único por app, então uma mesma URL per-campaign recebe leads
    // de TODOS os forms da página — sem esta checagem, o 2º form vinculado a outra
    // campanha cai na campanha do token (13 leads reais misroteados em 07/2026).
    if (form_id) {
      const mappedCampaignId = await this.metaLeadFormsService.findCampaignByFormId(form_id, companyId)
      if (mappedCampaignId && mappedCampaignId !== campaignId) {
        this.logger.log(
          `[Meta Leads] form=${form_id} vinculado à campanha ${mappedCampaignId} — sobrepõe o token da URL (${campaignId})`,
        )
        campaignId = mappedCampaignId
      }
    }

    const accessToken = await this.configService.getMetaAccessToken(companyId)
    if (!accessToken) {
      await this.fallbackService.saveRawEvent(companyId, changeValue, 'NO_ACCESS_TOKEN')
      return
    }

    let leadData: MetaLeadData
    try {
      leadData = await this.fetchLeadFromMeta(leadgen_id, accessToken)
    } catch (err) {
      this.logger.error(`[Meta Leads] Failed to fetch lead ${leadgen_id}: ${err.message}`)
      await this.fallbackService.saveRawEvent(companyId, changeValue, 'FETCH_FAILED')
      return
    }

    try {
      const createLeadDto = this.mapperService.mapMetaLeadToDto(leadData, {
        companyId,
        pageId: page_id,
        formId: form_id,
        adId: ad_id || leadData.ad_id,
        adsetId: adgroup_id || leadData.adset_id,
      })

      await this.leadsService.createLead(campaignId, createLeadDto, { skipApiKeyValidation: true })
      this.logger.log(`[Meta Leads] Lead created in campaign=${campaignId} from leadgen_id=${leadgen_id}`)
    } catch (err) {
      this.logger.error(`[Meta Leads] Failed to create lead: ${err.message}`)
      await this.fallbackService.saveRawEvent(companyId, changeValue, `CREATE_LEAD_ERROR: ${err.message}`, leadData)
    }
  }

  // ===== Graph API =====

  private async fetchLeadFromMeta(leadgenId: string, accessToken: string): Promise<MetaLeadData> {
    const fields = 'id,created_time,field_data,form_id,campaign_name,adset_name,ad_name,ad_id,adset_id,campaign_id,platform,is_organic,custom_disclaimer_responses'
    const url = `${META_API_BASE}/${META_API_VERSION}/${leadgenId}?fields=${fields}`

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    })

    if (!response.ok) {
      const errorBody = await response.text()
      throw new Error(`Meta API error (${response.status}): ${errorBody}`)
    }

    return response.json()
  }
}
