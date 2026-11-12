import { Injectable, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { PrismaService } from 'src/database/prisma.service'
import { RedisService } from 'src/shared/redis/redis.service'
import { LeadsManagementService } from 'src/modules/admin/leads-management/leads-management.service'
import { META_API_BASE, META_API_VERSION } from 'src/modules/meta-ads/constants/meta-ads.constants'
import { MetaLeadsConfigService } from './meta-leads-config.service'
import { MetaLeadsMapperService } from './meta-leads-mapper.service'
import { MetaLeadsFallbackService } from './meta-leads-fallback.service'
import { MetaLeadData } from './types/meta-lead.types'

const RECONCILIATION_LOCK_KEY = 'meta-leads:reconciliation:lock'
const RECONCILIATION_LOCK_TTL_SECONDS = 300
// Janela da Meta é 90 dias; cap de páginas evita runs longos em forms muito grandes.
const MAX_PAGES_PER_FORM = 10

interface ReconciliationSummary {
  mappings: number
  metaLeads: number
  created: number
  errors: number
}

/**
 * Rede de segurança para o fluxo fire-and-forget do webhook de Meta Leads:
 * entregas perdidas (webhook não entregue, restart no meio do processamento,
 * token expirado) somem sem rastro. Este cron compara os leads que a Meta tem
 * em cada formulário VINCULADO (MetaLeadFormMapping) com Leads.externalUserId
 * e recria os faltantes pelo mesmo fluxo real de criação (dedup em camadas).
 */
@Injectable()
export class MetaLeadsReconciliationService {
  private readonly logger = new Logger(MetaLeadsReconciliationService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly leadsService: LeadsManagementService,
    private readonly configService: MetaLeadsConfigService,
    private readonly mapperService: MetaLeadsMapperService,
    private readonly fallbackService: MetaLeadsFallbackService,
  ) {}

  @Cron('0 */6 * * *', { name: 'meta-leads-reconciliation' })
  async handleCron() {
    // PM2 cluster: só uma instância executa por rodada.
    const gotLock = await this.redis.tryAcquireLock(RECONCILIATION_LOCK_KEY, RECONCILIATION_LOCK_TTL_SECONDS)
    if (!gotLock) return

    try {
      await this.reconcileAll()
    } catch (error) {
      this.logger.error(`[Meta Leads] Reconciliação falhou: ${error.message}`)
    }
  }

  async reconcileAll(): Promise<ReconciliationSummary> {
    const summary: ReconciliationSummary = { mappings: 0, metaLeads: 0, created: 0, errors: 0 }

    const mappings = await this.prisma.metaLeadFormMapping.findMany({
      // A reconciliação busca leads na Graph API e CRIA lead no banco — e uma via
      // de entrada, mesmo rodando por cron. Empresa desativada fica de fora, igual
      // ao webhook de meta-leads.
      where: { deleted_at: null, company: { status: 'ACTIVE', deleted_at: null } },
      select: { formId: true, pageId: true, campaignId: true, companyId: true },
    })
    summary.mappings = mappings.length
    if (!mappings.length) return summary

    // Um token por empresa (evita N buscas iguais)
    const tokenByCompany = new Map<string, string | null>()

    for (const mapping of mappings) {
      try {
        if (!tokenByCompany.has(mapping.companyId)) {
          tokenByCompany.set(mapping.companyId, await this.configService.getMetaAccessToken(mapping.companyId))
        }
        const accessToken = tokenByCompany.get(mapping.companyId)
        if (!accessToken) continue

        const result = await this.reconcileForm(mapping, accessToken)
        summary.metaLeads += result.metaLeads
        summary.created += result.created
        summary.errors += result.errors
      } catch (error) {
        summary.errors++
        this.logger.warn(
          `[Meta Leads] Reconciliação do form ${mapping.formId} falhou (company=${mapping.companyId}): ${error.message}`,
        )
      }
    }

    this.logger.log(
      `[Meta Leads] Reconciliação: ${summary.mappings} forms, ${summary.metaLeads} leads na Meta, ` +
        `${summary.created} recuperados, ${summary.errors} erros`,
    )
    return summary
  }

  private async reconcileForm(
    mapping: { formId: string; pageId: string; campaignId: string; companyId: string },
    accessToken: string,
  ): Promise<{ metaLeads: number; created: number; errors: number }> {
    const token = (await this.getPageAccessToken(mapping.pageId, accessToken)) || accessToken
    const metaLeads = await this.fetchFormLeads(mapping.formId, token)
    if (!metaLeads.length) return { metaLeads: 0, created: 0, errors: 0 }

    // Inclui soft-deleted (raw): lead apagado de propósito não deve ressuscitar.
    const metaIds = metaLeads.map(l => l.id)
    const existing = await this.prisma.$queryRaw<{ externalUserId: string }[]>`
      SELECT "externalUserId" FROM "Leads"
      WHERE "companyId" = ${mapping.companyId} AND "externalUserId" = ANY(${metaIds})
    `
    const existingIds = new Set(existing.map(e => e.externalUserId))
    const missing = metaLeads.filter(l => !existingIds.has(l.id))

    let created = 0
    let errors = 0
    for (const leadData of missing) {
      try {
        const dto = this.mapperService.mapMetaLeadToDto(
          { ...leadData, form_id: leadData.form_id || mapping.formId },
          {
            companyId: mapping.companyId,
            pageId: leadData.page_id || mapping.pageId || undefined,
            formId: leadData.form_id || mapping.formId,
            adId: leadData.ad_id,
            adsetId: leadData.adset_id,
          },
        )
        await this.leadsService.createLead(mapping.campaignId, dto, { skipApiKeyValidation: true })
        await this.fallbackService.saveRawEvent(
          mapping.companyId,
          {
            leadgen_id: leadData.id,
            form_id: leadData.form_id || mapping.formId,
            page_id: leadData.page_id || mapping.pageId,
            created_time: Date.parse(leadData.created_time) / 1000,
          },
          'RECONCILED_CREATED',
        )
        created++
        this.logger.log(
          `[Meta Leads] Lead recuperado por reconciliação: leadgen_id=${leadData.id} -> campaign=${mapping.campaignId}`,
        )
      } catch (error) {
        errors++
        this.logger.warn(`[Meta Leads] Falha ao recuperar lead ${leadData.id}: ${error.message}`)
      }
    }

    return { metaLeads: metaLeads.length, created, errors }
  }

  private async getPageAccessToken(pageId: string, accessToken: string): Promise<string | null> {
    if (!pageId) return null
    try {
      const resp = await fetch(`${META_API_BASE}/${META_API_VERSION}/${pageId}?fields=access_token`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      const data = await resp.json()
      return data?.access_token || null
    } catch {
      return null
    }
  }

  private async fetchFormLeads(formId: string, token: string): Promise<MetaLeadData[]> {
    const fields =
      'id,created_time,field_data,form_id,campaign_name,adset_name,ad_name,ad_id,adset_id,campaign_id,platform,is_organic,custom_disclaimer_responses'
    const leads: MetaLeadData[] = []
    let url: string | null =
      `${META_API_BASE}/${META_API_VERSION}/${formId}/leads?fields=${fields}&limit=100`
    let pages = 0

    while (url && pages < MAX_PAGES_PER_FORM) {
      const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      const data = await resp.json()
      if (data?.error) {
        throw new Error(`Meta API error: ${data.error.message}`)
      }
      leads.push(...(data?.data || []))
      url = data?.paging?.next || null
      pages++
    }

    if (url) {
      this.logger.warn(`[Meta Leads] Form ${formId} excedeu ${MAX_PAGES_PER_FORM} páginas — reconciliação parcial`)
    }
    return leads
  }
}
