import { Injectable, Logger } from '@nestjs/common'
import { PrismaService } from 'src/database/prisma.service'
import { formatPhone, formatName, parseUtms } from 'src/shared/util/utils'
import { normalizePhoneForStorage, phoneVariants } from 'src/shared/util/phone.utils'
import { CreateLeadDto } from 'src/modules/admin/leads-management/dto/create-leads-management.dto'
import { LeadsUsageService } from 'src/modules/admin/leads-management/services/leads-usage.service'
import { MetaLeadChangeValue, MetaLeadData } from './types/meta-lead.types'
import { buildInitialJourneyColumns } from 'src/shared/constants/journey-columns.constants'

@Injectable()
export class MetaLeadsFallbackService {
  private readonly logger = new Logger(MetaLeadsFallbackService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly leadsUsageService: LeadsUsageService,
  ) {}

  async saveRawEvent(
    companyId: string,
    changeValue: MetaLeadChangeValue,
    reason: string,
    leadData?: MetaLeadData,
  ) {
    try {
      await this.prisma.events.create({
        data: {
          companyId,
          platformData: JSON.parse(JSON.stringify({
            source: 'meta_lead_ads',
            reason,
            leadgen_id: changeValue.leadgen_id,
            form_id: changeValue.form_id,
            page_id: changeValue.page_id,
            ad_id: changeValue.ad_id || null,
            adgroup_id: changeValue.adgroup_id || null,
            created_time: changeValue.created_time,
            lead_data: leadData || null,
          })),
        },
      })
      this.logger.log(`[Meta Leads] Raw event saved: leadgen_id=${changeValue.leadgen_id} reason=${reason}`)
    } catch (error) {
      this.logger.error(`[Meta Leads] Failed to save raw event: ${error.message}`)
    }
  }

  async createLeadWithoutCampaign(companyId: string, createLeadDto: CreateLeadDto) {
    const existingEmail = createLeadDto?.email ? createLeadDto.email.trim().toLowerCase() : undefined
    const existingPhone = createLeadDto?.phone ? createLeadDto.phone : undefined

    // Variantes ±55/±9º no lookup — match exato perdia leads gravados em
    // formato divergente. Fallback exato p/ phones curtos (variants = []).
    const phoneVariantsList = existingPhone
      ? phoneVariants(formatPhone(existingPhone), { legacyLandlineNine: true })
      : []
    const phoneFilter = existingPhone
      ? (phoneVariantsList.length > 0 ? { phone: { in: phoneVariantsList } } : { phone: formatPhone(existingPhone) })
      : null

    // Check for existing lead (dedup)
    const existingLead = await this.prisma.leads.findFirst({
      where: {
        AND: [
          {
            OR: [
              ...(createLeadDto.externalUserId ? [{ externalUserId: createLeadDto.externalUserId }] : []),
              ...(existingEmail ? [{ email: existingEmail }] : []),
              ...(phoneFilter ? [phoneFilter] : []),
            ],
          },
          { companyId },
        ],
      },
    })

    if (existingLead) {
      this.logger.log(`[Meta Leads] Lead already exists (id=${existingLead.id}), skipping creation`)
      return existingLead
    }

    // Find or create customer
    let customer = await this.prisma.customers.findFirst({
      where: { email: existingEmail },
    })

    if (!customer) {
      customer = await this.prisma.customers.create({
        data: {
          name: formatName(createLeadDto.name),
          email: existingEmail || '',
          phoneNumber: normalizePhoneForStorage(createLeadDto.phone),
          address: '',
          document: '',
        },
      })
    }

    // Find or create "Leads" GenericDnd board
    let leadsDnd = await this.prisma.genericDnd.findFirst({
      where: { title: 'Leads', companyId },
    })

    if (!leadsDnd) {
      leadsDnd = await this.prisma.genericDnd.create({
        data: {
          title: 'Leads',
          companyId,
          type: 'lead',
        },
      })
    }

    // Parse UTMs
    const utms = parseUtms(createLeadDto.utms || '')
    const utmUrl = new URLSearchParams(utms).toString()

    // Create the lead without campaign
    const lead = await this.prisma.leads.create({
      data: {
        name: formatName(createLeadDto.name),
        email: existingEmail || '',
        phone: normalizePhoneForStorage(createLeadDto.phone),
        source: createLeadDto.source,
        canal: createLeadDto.canal,
        utms: utmUrl,
        city: createLeadDto.city,
        state: createLeadDto.state,
        empresa: createLeadDto.empresa,
        cargo: createLeadDto.cargo,
        externalUserId: createLeadDto.externalUserId,
        notes: (createLeadDto as any).notes,
        companyId,
        customerId: customer.customerId,
        // Facebook Lead Ads fields
        page_id: createLeadDto.page_id,
        form_id: createLeadDto.form_id,
        ad_id: createLeadDto.ad_id,
        ad_name: createLeadDto.ad_name,
        adset_id: createLeadDto.adset_id,
        adset_name: createLeadDto.adset_name,
        street_address: createLeadDto.street_address,
        zip_code: createLeadDto.zip_code,
        country: createLeadDto.country,
        date_of_birth: createLeadDto.date_of_birth,
        gender: createLeadDto.gender,
        cpf: createLeadDto.cpf,
        marital_status: createLeadDto.marital_status,
        // Meta Lead Ads — campos extras (batch 2)
        first_name: createLeadDto.first_name,
        last_name: createLeadDto.last_name,
        work_email: createLeadDto.work_email,
        work_phone_number: createLeadDto.work_phone_number,
        meta_campaign_id: createLeadDto.meta_campaign_id,
        meta_campaign_name: createLeadDto.meta_campaign_name,
        is_organic: createLeadDto.is_organic || false,
        // Meta Lead Ads — campos extras (batch 3)
        meta_created_time: createLeadDto.meta_created_time,
        custom_disclaimer_responses: createLeadDto.custom_disclaimer_responses || undefined,
        military_status: createLeadDto.military_status,
        relationship_status: createLeadDto.relationship_status,
        utm_source: utms?.utm_source || '',
        utm_medium: utms?.utm_medium || '',
        utm_campaign: utms?.utm_campaign || '',
        utm_term: utms?.utm_term || '',
        utm_content: utms?.utm_content || '',
      },
    })

    // Rastrear uso de leads (fire-and-forget)
    this.leadsUsageService.incrementLeadCount(companyId)
      .catch(err => this.logger.warn(`[Leads Usage] Falha ao incrementar: ${err.message}`))
    this.leadsUsageService.logLeadOverage({
      companyId,
      leadId: String(lead.id),
      leadName: lead.name,
      leadEmail: lead.email,
      leadSource: lead.source,
      campaignId: null,
      campaignName: null,
    }).catch(err => this.logger.warn(`[Lead Overage Log] Falha: ${err.message}`))

    // Create GenericDndCard + positions in a transaction
    await this.prisma.$transaction(async (tx) => {
      const newCard = await tx.genericDndCard.create({
        data: {
          genericDndId: leadsDnd.id,
          title: lead.name,
          description: 'Lead sem campanha (Meta Lead Ads)',
          metadata: JSON.stringify(lead),
          companyId,
          type: 'lead',
          color: 'blue',
          leadId: lead.id,
        },
      })

      const allColumnSets = await tx.genericDndColumnSet.findMany({
        where: { genericDndId: leadsDnd.id },
        include: { columns: true },
      })

      if (allColumnSets.length === 0) {
        const defaultColumnSet = await tx.genericDndColumnSet.create({
          data: {
            name: 'Default',
            genericDndId: leadsDnd.id,
            columns: {
              // Antes nascia uma jornada só com Recepção — sem Win/Lost, a conversão
              // de lead em oportunidade não achava a coluna de ganho.
              create: buildInitialJourneyColumns(),
            },
          },
          include: { columns: true },
        })
        allColumnSets.push(defaultColumnSet)
      }

      for (const set of allColumnSets) {
        const firstColumn = set.columns.sort((a, b) => a.position - b.position)[0]
        if (!firstColumn) continue

        const cardCount = await tx.genericDndCardPosition.count({
          where: { columnId: firstColumn.id, columnSetId: set.id },
        })

        await tx.genericDndCardPosition.create({
          data: {
            cardId: newCard.id,
            columnId: firstColumn.id,
            columnSetId: set.id,
            position: cardCount,
          },
        })
      }
    })

    return lead
  }
}
