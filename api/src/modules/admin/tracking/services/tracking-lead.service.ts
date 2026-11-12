import { Injectable, Logger } from '@nestjs/common'
import { setTimeout as sleep } from 'node:timers/promises'
import { PrismaService } from 'src/database/prisma.service'
import { LeadDistributionEngineService } from 'src/modules/admin/lead-distribution/lead-distribution-engine.service'
import { RedisService } from 'src/shared/redis/redis.service'
import { phoneVariants, canonicalPhoneForLock, normalizePhoneForStorage } from 'src/shared/util/phone.utils'
import { buildInitialJourneyColumns } from 'src/shared/constants/journey-columns.constants'

type TrackingCampaign = {
  campaignId: string
  companyId: string
  columnSetId: string | null
  name: string | null
}

type TrackingUtmData = {
  utm_source?: string
  utm_medium?: string
  utm_campaign?: string
  utm_content?: string
  utm_term?: string
}

/**
 * O que o navegador sabe e o servidor não tem como inventar.
 *
 * O `tracker.js` já coleta os cinco e manda no `/collect`; até 28/08/2026 o
 * `TrackingCollectService` guardava parte deles na tabela `Tracking` e descartava
 * o resto — o lead nascia cego e TODO evento Meta CAPI depois lia essas colunas
 * vazias. Daí `fbc` em 0% e `fbp` em 0,6% nos 2.170 eventos já enviados, com o
 * `fbclid` presente em 95% dos leads correspondentes.
 */
export type TrackingBrowserData = {
  /** Cookie `_fbc`, ou `fb.1.{ts}.{fbclid}` sintetizado pelo tracker. */
  fbc?: string | null
  /** Cookie `_fbp`. Sem equivalente no servidor. */
  fbp?: string | null
  /** Da query string da landing. Alimenta o `resolveFbc()` quando não há `_fbc`. */
  fbclid?: string | null
  /** `navigator.userAgent`. Exigido pela Meta para `action_source: website`. */
  userAgent?: string | null
  /** `location.href` da landing. Vira `event_source_url`. */
  sourceUrl?: string | null
  /** IP do visitante resolvido na borda, não o do proxy. */
  leadIp?: string | null
}

const isBlank = (value: unknown): boolean =>
  value === null || value === undefined || String(value).trim() === ''

const AUTOCREATE_LOCK_TTL_SECONDS = 10

@Injectable()
export class TrackingLeadService {
  private readonly logger = new Logger(TrackingLeadService.name)

  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
    private readonly distributionEngine: LeadDistributionEngineService,
  ) {}

  /**
   * Ponto de entrada idempotente para auto-create de lead via tracking.
   *
   * Regra de negócio: 1 lead por (email|phone, campaignId, companyId) — alinhado com
   * o unique composto do schema. Mesmo email em campanhas DIFERENTES gera leads
   * separados (cada campanha tem seu próprio lead).
   *
   * Defense in depth contra race condition do consumer paralelo (prefetchCount=10):
   *   Layer 1 — Redis SET NX EX serializa workers concorrentes na mesma tripla
   *             (email|phone, campaignId, companyId). Workers em campanhas distintas
   *             não competem pelo mesmo lock.
   *   Layer 2 — try/catch P2002 em createLeadFromTracking absorve violação do unique.
   */
  async findOrCreateLeadFromTracking(
    email: string,
    campaign: TrackingCampaign,
    phone?: string,
    utmData?: TrackingUtmData,
    browser?: TrackingBrowserData,
    name?: string,
  ) {
    const normalizedEmail = email ? email.trim().toLowerCase() : ''
    const normalizedPhone = phone || ''
    // Lock identity canônico: phone sem prefix 55 → garante mesma key cross-path
    // mesmo quando paths salvam phone em formatos diferentes (com/sem 55).
    const lockIdentity = normalizedEmail || canonicalPhoneForLock(normalizedPhone)
    if (!lockIdentity) return null

    // Lookup com OR + variantes de 55 no phone — "11999..." e "55119999..." são
    // tratados como o mesmo número, evitando duplicação por formato divergente.
    // legacyLandlineNine: alcança fixos gravados com 9 espúrio pela regra antiga.
    const phoneVariantsList = phoneVariants(normalizedPhone, { legacyLandlineNine: true })
    const orConditions: Array<{ email: string } | { phone: { in: string[] } }> = []
    if (normalizedEmail) orConditions.push({ email: normalizedEmail })
    if (phoneVariantsList.length > 0) orConditions.push({ phone: { in: phoneVariantsList } })

    const lookupWhere = {
      campaignId: campaign.campaignId,
      companyId: campaign.companyId,
      OR: orConditions,
    }

    // Lock key compartilhada com leads-creation.service.ts (cross-path serialization).
    const lockKey = `lead:autocreate:${campaign.companyId}:${campaign.campaignId}:${lockIdentity}`
    const lockAcquired = await this.redis.tryAcquireLock(lockKey, AUTOCREATE_LOCK_TTL_SECONDS)

    if (!lockAcquired) {
      // Retry-lookup com backoff: aguarda o winner commitar antes de tentar criar.
      // 3 tentativas × 200ms = 600ms — cobre p99 do create completo (Customer + Kanban + Lead + $transaction).
      // Layer 2 (P2002) é a defesa final caso o constraint do DB exista (Fase 1 deferida).
      for (let attempt = 0; attempt < 3; attempt++) {
        const found = await this.prisma.leads.findFirst({ where: lookupWhere, select: { id: true } })
        if (found) {
          this.logger.warn(`[TrackingLead] Lock recusado, lead encontrado após retry #${attempt + 1}: company=${campaign.companyId} campaign=${campaign.campaignId} key=${lockIdentity}`)
          await this.fillBrowserData(found.id, browser, name)
          return found
        }
        await sleep(200)
      }
      this.logger.warn(`[TrackingLead] Lock recusado e lead não encontrado após 3 retries — caindo em create (P2002 catch é a defesa final): company=${campaign.companyId} campaign=${campaign.campaignId} key=${lockIdentity}`)
    }

    const existingLead = await this.prisma.leads.findFirst({ where: lookupWhere, select: { id: true } })
    if (existingLead) {
      // O caso COMUM: visitante recorrente. Gravar o dado de navegador só no
      // create cobriria uma fração do volume — e justamente os leads antigos,
      // que nasceram cegos, nunca ganhariam `fbp`/`fbc`.
      await this.fillBrowserData(existingLead.id, browser, name)
      return existingLead
    }

    return this.createLeadFromTracking(normalizedEmail, campaign, normalizedPhone, utmData, browser, name)
  }

  /**
   * Completa no lead o que o navegador trouxe e o banco ainda não tem.
   *
   * PREENCHE, NUNCA SOBRESCREVE. O `_fbc` de uma visita nova é mais recente que o
   * guardado, e seria defensável trocar — mas trocar muda a atribuição de uma
   * conversão para outro clique, e isso é decisão de negócio, não de plumbing.
   * Buraco vazio é ganho garantido; sobrescrita é aposta.
   *
   * Falha aqui nunca derruba o tracking: o evento vale mais que o enriquecimento.
   *
   * Também completa `name`: o optin de um visitante recorrente pode trazer o nome
   * pela primeira vez (ex.: primeira visita só tinha e-mail no formulário), e sem
   * isso o lead ficava para sempre sem nome — nenhum outro caminho reconsulta este
   * campo depois do create.
   */
  private async fillBrowserData(leadId: number, browser?: TrackingBrowserData, name?: string): Promise<void> {
    if (!browser && isBlank(name)) return

    try {
      const current = await this.prisma.leads.findUnique({
        where: { id: leadId },
        select: { name: true, fbc: true, fbp: true, fbclid: true, source_url: true, leadIp: true, browser_data: true },
      })
      if (!current) return

      const patch: Record<string, unknown> = {}
      if (isBlank(current.name) && !isBlank(name)) patch.name = name
      if (browser) {
        if (isBlank(current.fbc) && !isBlank(browser.fbc)) patch.fbc = browser.fbc
        if (isBlank(current.fbp) && !isBlank(browser.fbp)) patch.fbp = browser.fbp
        if (isBlank(current.fbclid) && !isBlank(browser.fbclid)) patch.fbclid = browser.fbclid
        if (isBlank(current.source_url) && !isBlank(browser.sourceUrl)) patch.source_url = browser.sourceUrl
        if (isBlank(current.leadIp) && !isBlank(browser.leadIp)) patch.leadIp = browser.leadIp
      }

      // `browser_data` é JSONB e guarda mais que o user agent noutros caminhos de
      // criação — mesclar em vez de trocar o objeto inteiro.
      if (browser) {
        const existingBrowser = (current.browser_data as Record<string, unknown> | null) ?? null
        if (!isBlank(browser.userAgent) && isBlank(existingBrowser?.userAgent)) {
          patch.browser_data = { ...(existingBrowser ?? {}), userAgent: browser.userAgent }
        }
      }

      if (Object.keys(patch).length === 0) return

      await this.prisma.leads.update({ where: { id: leadId }, data: patch })
    } catch (err: any) {
      this.logger.warn(`[TrackingLead] Falha ao completar dados de navegador do lead ${leadId}: ${err?.message}`)
    }
  }

  async createLeadFromTracking(
    email: string,
    campaign: TrackingCampaign,
    phone?: string,
    utmData?: TrackingUtmData,
    browser?: TrackingBrowserData,
    name?: string,
  ) {
    const normalizedEmail = email ? email.trim().toLowerCase() : ''
    const normalizedName = isBlank(name) ? '' : String(name).trim()

    // Buscar ou criar Customer
    const customerWhere = normalizedEmail
      ? { email: normalizedEmail }
      : phone
        ? { phoneNumber: phone }
        : null

    let customer = customerWhere
      ? await this.prisma.customers.findFirst({ where: customerWhere })
      : null

    if (!customer) {
      customer = await this.prisma.customers.create({
        data: {
          name: normalizedEmail || phone || '',
          email: normalizedEmail,
          phoneNumber: normalizePhoneForStorage(phone),
          address: '',
          document: '',
        },
      })
    }

    // Buscar primeira coluna do kanban da campanha (Recepção)
    const firstKanbanColumn = await this.prisma.dndColumn.findFirst({
      where: {
        dnd: { campaignId: campaign.campaignId },
      },
      orderBy: { position: 'asc' },
    })

    // Buscar ou criar board "Leads" GenericDnd
    let leadsDnd = await this.prisma.genericDnd.findFirst({
      where: { title: 'Leads', companyId: campaign.companyId },
    })

    if (!leadsDnd) {
      leadsDnd = await this.prisma.genericDnd.create({
        data: {
          title: 'Leads',
          companyId: campaign.companyId,
          type: 'lead',
        },
      })
    }

    // Construir utms consolidado a partir dos campos individuais
    const utmParts: Record<string, string> = {}
    if (utmData?.utm_source) utmParts.utm_source = utmData.utm_source
    if (utmData?.utm_medium) utmParts.utm_medium = utmData.utm_medium
    if (utmData?.utm_campaign) utmParts.utm_campaign = utmData.utm_campaign
    if (utmData?.utm_content) utmParts.utm_content = utmData.utm_content
    if (utmData?.utm_term) utmParts.utm_term = utmData.utm_term
    const utmsString = new URLSearchParams(utmParts).toString()

    // Criar o Lead. `name` vem do próprio payload do optin quando o formulário já
    // captura o campo nessa etapa (ex.: TrackingCollectService passa `form_nome`) —
    // até aqui isso era descartado (hardcoded ''), e o evento saía pro trigger/Meta
    // CAPI só com e-mail: nada reconsulta o nome depois do create se ele nunca foi
    // gravado. Quando a etapa realmente não tem nome ainda (form multi-step), fica
    // vazio mesmo, a ser preenchido depois por `enrichExistingLead` ou por
    // `fillBrowserData` num optin seguinte do mesmo visitante.
    // Layer 2: P2002 absorvido se outro worker venceu a corrida e já criou o lead.
    let lead
    try {
      lead = await this.prisma.leads.create({
        data: {
          name: normalizedName,
          email: normalizedEmail,
          phone: normalizePhoneForStorage(phone),
          campaignId: campaign.campaignId,
          companyId: campaign.companyId,
          customerId: customer.customerId,
          dndColumnId: firstKanbanColumn?.id || null,
          utms: utmsString || '',
          utm_source: utmData?.utm_source || '',
          utm_medium: utmData?.utm_medium || '',
          utm_campaign: utmData?.utm_campaign || '',
          utm_content: utmData?.utm_content || '',
          utm_term: utmData?.utm_term || '',
          // O que o navegador trouxe. Sem isto o lead nasce cego e todo evento
          // Meta CAPI dele sai sem os identificadores de maior peso.
          fbc: browser?.fbc || null,
          fbp: browser?.fbp || null,
          fbclid: browser?.fbclid || null,
          source_url: browser?.sourceUrl || null,
          leadIp: browser?.leadIp || null,
          ...(browser?.userAgent ? { browser_data: { userAgent: browser.userAgent } } : {}),
        },
      })
    } catch (err: any) {
      if (err?.code === 'P2002') {
        this.logger.warn(
          `[TrackingLead] P2002 absorvido — outro worker criou lead concorrente: company=${campaign.companyId} email=${normalizedEmail} phone=${phone || ''}`,
        )
        const winnerPhoneVariants = phoneVariants(phone || '', { legacyLandlineNine: true })
        const winner = await this.prisma.leads.findFirst({
          where: normalizedEmail
            ? { email: normalizedEmail, campaignId: campaign.campaignId, companyId: campaign.companyId }
            : winnerPhoneVariants.length > 0
              ? { phone: { in: winnerPhoneVariants }, campaignId: campaign.campaignId, companyId: campaign.companyId }
              : { phone: phone || '', campaignId: campaign.campaignId, companyId: campaign.companyId },
        })
        return winner
      }
      throw err
    }

    // Operações dependentes do lead em transação (mesmo padrão do createLead)
    await this.prisma.$transaction(async (tx) => {
      const newCard = await tx.genericDndCard.create({
        data: {
          genericDndId: leadsDnd.id,
          title: lead.name,
          description: `Lead from ${campaign.name ?? 'Unknown Campaign'}`,
          metadata: JSON.stringify(lead),
          companyId: lead.companyId,
          campaignId: lead.campaignId,
          type: 'lead',
          color: 'blue',
          leadId: lead.id,
        },
      })

      // Buscar todos os column sets do board (mesmo padrão do createLead)
      const allColumnSets = await tx.genericDndColumnSet.findMany({
        where: { genericDndId: leadsDnd.id },
        include: { columns: true },
      })

      // Se nenhum column set existe, criar um default com coluna Recepção
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

      // Criar posições de cartão para TODOS os column sets
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

    // Distribuição automática na chegada: pós-commit e fire-and-forget, para não segurar
    // a resposta do pixel de tracking nem poder derrubar a captura.
    //
    // Só aqui, e não nos retornos de deduplicação (`existingLead` e `winner`): aqueles
    // devolvem lead que já existe e pode já ter dono. Se falhar, o sweeper pega.
    this.distributionEngine.scheduleOnArrival(lead.id)

    return lead
  }
}
