import { Injectable, Logger } from '@nestjs/common'
import { PrismaService } from 'src/database/prisma.service'
import { RedisService } from 'src/shared/redis/redis.service'
import { Prisma } from '@prisma/client'

@Injectable()
export class AdsLinkingService {
  private readonly logger = new Logger(AdsLinkingService.name)

  constructor(
    private prisma: PrismaService,
    private readonly redisService: RedisService,
  ) {}

  /**
   * Vincula registros de AdsPerformance a uma campanha HDM.
   *
   * Match unificado por `link_group_key` (coluna GENERATED STORED em
   * ads_performance, populada server-side a partir de externalCampaignId,
   * campaign_name e account_name). Os 3 prefixos do contrato com o frontend
   * sao traduzidos para linkGroupKey antes do UPDATE:
   *
   *   "120239..."         -> id:120239...
   *   "name:CA2"          -> name:<account>|CA2  (lookup de account_name)
   *   "account:Maclo Ads" -> account:Maclo Ads
   *
   * Tudo dentro de transacao com pg_advisory_xact_lock per-company para
   * serializar com autoLinkNewRecords (que tambem roda durante sync Meta).
   */
  async linkAdsToCampaign(hdmCampaignId: string, externalCampaignIds: string[]): Promise<{ linked: number }> {
    if (externalCampaignIds.length === 0) return { linked: 0 }

    this.logger.log(`Vinculando campanhas ${externalCampaignIds.join(', ')} a campanha HDM ${hdmCampaignId}`)

    const companyId = await this.resolveCompanyId(hdmCampaignId)
    if (!companyId) {
      this.logger.warn(`Campanha HDM ${hdmCampaignId} sem companyId — abortando link`)
      return { linked: 0 }
    }

    const linked = await this.prisma.$transaction(async (tx) => {
      await this.acquireCompanyLock(tx, companyId)

      const groupKeys = await this.resolveGroupKeysForLink(tx, companyId, externalCampaignIds)
      if (groupKeys.length === 0) return 0

      const result = await tx.adsPerformance.updateMany({
        where: { companyId, linkGroupKey: { in: groupKeys }, campaignId: null },
        data: { campaignId: hdmCampaignId },
      })

      if (result.count > 0) {
        await tx.campaigns.update({
          where: { campaignId: hdmCampaignId },
          data: { adsLastUpdatedAt: new Date() },
        })
      }

      return result.count
    }, { maxWait: 15000, timeout: 30000 })

    if (linked > 0) {
      await this.invalidateAdsCacheForCampaign(hdmCampaignId)
    }

    this.logger.log(`${linked} registros vinculados`)
    return { linked }
  }

  /**
   * Desvincula registros de AdsPerformance de uma campanha HDM. Simetrico ao
   * link: mesmo lock, mesma traducao de prefixo, mesma chave linkGroupKey.
   * Diferenca: filtra `campaignId = hdmCampaignId` (so registros desta
   * campanha) e seta `campaignId = null`.
   */
  async unlinkAdsFromCampaign(hdmCampaignId: string, externalCampaignIds: string[]): Promise<{ unlinked: number }> {
    if (externalCampaignIds.length === 0) return { unlinked: 0 }

    this.logger.log(`Desvinculando campanhas ${externalCampaignIds.join(', ')} da campanha HDM ${hdmCampaignId}`)

    const companyId = await this.resolveCompanyId(hdmCampaignId)
    if (!companyId) {
      this.logger.warn(`Campanha HDM ${hdmCampaignId} sem companyId — abortando unlink`)
      return { unlinked: 0 }
    }

    const unlinked = await this.prisma.$transaction(async (tx) => {
      await this.acquireCompanyLock(tx, companyId)

      const groupKeys = await this.resolveGroupKeysForUnlink(tx, companyId, hdmCampaignId, externalCampaignIds)
      if (groupKeys.length === 0) return 0

      const result = await tx.adsPerformance.updateMany({
        where: { companyId, linkGroupKey: { in: groupKeys }, campaignId: hdmCampaignId },
        data: { campaignId: null },
      })

      return result.count
    }, { maxWait: 15000, timeout: 30000 })

    if (unlinked > 0) {
      await this.invalidateAdsCacheForCampaign(hdmCampaignId)
    }

    this.logger.log(`${unlinked} registros desvinculados`)
    return { unlinked }
  }

  /**
   * Auto-vincula registros orfaos (campaignId IS NULL) que correspondam a
   * grupos ja vinculados (mesmo link_group_key) a alguma campanha HDM.
   *
   * Substitui a antiga logica de 3 criterios em serie (externalCampaignId /
   * campaignName / accountName) por uma operacao unica chaveada em
   * link_group_key. Garante simetria com link/unlink: as 3 operacoes operam
   * sobre o mesmo conjunto de rows agrupado pela query available.
   */
  async autoLinkNewRecords(companyId: string): Promise<number> {
    const totalLinked = await this.prisma.$transaction(async (tx) => {
      await this.acquireCompanyLock(tx, companyId)

      // DISTINCT ON garante 1 campanha canonica por link_group_key (mais recente
      // por imported_at). Em caso de split (mesmo grupo vinculado a 2+ HDMs),
      // o backfill SQL deve ter sinalizado para revisao manual.
      //
      // NAO filtrar por deleted_at: ads_performance nao tem essa coluna (o model
      // AdsPerformance nao participa do soft delete global). Referencia-la faz o
      // Postgres devolver 42703 e, como a chamada em meta-ads.service.ts roda em
      // try/catch, o auto-link morre em silencio e todo registro novo do sync fica
      // orfao (campaignId NULL) -> invisivel no dashboard de marketing.
      const result = await tx.$executeRaw`
        UPDATE ads_performance ap
        SET "campaignId" = canon.canonical_campaign_id
        FROM (
          SELECT DISTINCT ON (link_group_key)
            link_group_key,
            "campaignId" AS canonical_campaign_id
          FROM ads_performance
          WHERE company_id = ${companyId}
            AND "campaignId" IS NOT NULL
            AND link_group_key IS NOT NULL
            AND (data_source IS NULL OR data_source != 'meta_api_zero')
          ORDER BY link_group_key, imported_at DESC
        ) canon
        WHERE ap.company_id = ${companyId}
          AND ap.link_group_key = canon.link_group_key
          AND ap."campaignId" IS NULL
      `
      return Number(result)
    }, { maxWait: 15000, timeout: 30000 })

    if (totalLinked > 0) {
      this.logger.log(`Auto-link: ${totalLinked} registros vinculados automaticamente para company ${companyId}`)

      try {
        const company = await this.prisma.client.companies.findFirst({
          where: { id: companyId },
          select: { subdomain: true },
        })
        if (company?.subdomain) {
          await this.redisService.delByPattern(`dashboard:ads:*:${company.subdomain}:*`)
        }
        await this.redisService.del(`lookup:company-campaigns:${companyId}`)
      } catch (err) {
        this.logger.warn(`Falha ao invalidar cache de ads apos auto-link: ${err.message}`)
      }
    }

    return totalLinked
  }

  // ============================================================================
  // Helpers
  // ============================================================================

  /**
   * Resolve o companyId a partir do campaignId HDM. Necessario para advisory
   * lock per-company e para escopo do updateMany (evita atualizar rows de
   * outra empresa caso linkGroupKey colida entre tenants).
   */
  private async resolveCompanyId(hdmCampaignId: string): Promise<string | null> {
    const campaign = await this.prisma.campaigns.findUnique({
      where: { campaignId: hdmCampaignId },
      select: { companyId: true },
    })
    return campaign?.companyId ?? null
  }

  /**
   * Acquire pg_advisory_xact_lock per-company. Liberado automaticamente no
   * fim da transacao. Mesmo lock_key e usado por linkAdsToCampaign,
   * unlinkAdsFromCampaign e autoLinkNewRecords — serializando todas as
   * operacoes que mutam ads_performance.campaignId em uma mesma company.
   *
   * hashtextextended retorna bigint, compativel com pg_advisory_xact_lock.
   */
  private async acquireCompanyLock(tx: Prisma.TransactionClient, companyId: string): Promise<void> {
    const lockKey = `ads-link:${companyId}`
    // Limita a espera pelo advisory lock (e demais row-locks da tx) a 20s,
    // abaixo do timeout de 30s da transacao. Em contencao patologica falha
    // limpo com 55P03 (canceling statement due to lock timeout) — erro claro e
    // retentavel — em vez do cru "Transaction already closed". SET LOCAL vale
    // pelo resto da transacao; '20s' e literal fixo (SET nao aceita parametro).
    await tx.$executeRaw`SET LOCAL lock_timeout = '20s'`
    // $executeRaw em vez de $queryRaw: pg_advisory_xact_lock retorna void e
    // o $queryRaw falha ao desserializar com erro N/A. $executeRaw nao le
    // resultado, apenas executa.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`
  }

  /**
   * Traduz IDs do contrato frontend (real ID / name:X / account:Y) em
   * link_group_key da DB. Para "name:X" sem account explicito, descobre
   * todos os accountName distintos com campaign_name = X e externalCampaignId
   * NULL — preservando a semantica do bulk-link sobre cards Excel-only.
   *
   * Para link, considera apenas rows com campaignId IS NULL (candidatas).
   */
  private async resolveGroupKeysForLink(
    tx: Prisma.TransactionClient,
    companyId: string,
    externalCampaignIds: string[],
  ): Promise<string[]> {
    return this.resolveGroupKeys(tx, companyId, externalCampaignIds, { campaignIdFilter: null })
  }

  /**
   * Variante para unlink: considera apenas rows ja vinculadas a esta
   * campanha (campaignId = hdmCampaignId). Garante que `name:X` so resolve
   * accounts que de fato pertencem a esta campanha HDM.
   */
  private async resolveGroupKeysForUnlink(
    tx: Prisma.TransactionClient,
    companyId: string,
    hdmCampaignId: string,
    externalCampaignIds: string[],
  ): Promise<string[]> {
    return this.resolveGroupKeys(tx, companyId, externalCampaignIds, { campaignIdFilter: hdmCampaignId })
  }

  /**
   * Implementacao compartilhada. campaignIdFilter:
   *   null   -> rows nao vinculadas (link path)
   *   string -> rows vinculadas a este HDM campaignId (unlink path)
   */
  private async resolveGroupKeys(
    tx: Prisma.TransactionClient,
    companyId: string,
    externalCampaignIds: string[],
    opts: { campaignIdFilter: string | null },
  ): Promise<string[]> {
    const realIds = externalCampaignIds.filter(id => !id.startsWith('name:') && !id.startsWith('account:'))
    const nameIds = externalCampaignIds.filter(id => id.startsWith('name:')).map(id => id.slice(5))
    const accountIds = externalCampaignIds.filter(id => id.startsWith('account:')).map(id => id.slice(8))

    const keys: string[] = []

    // Real IDs: 1:1 com 'id:<extId>'
    for (const id of realIds) keys.push(`id:${id}`)

    // Account IDs: 1:1 com 'account:<accountName>'
    for (const acc of accountIds) keys.push(`account:${acc}`)

    // Name IDs: lookup do account_name para construir 'name:<account>|<campaign>'.
    // Pode produzir multiplos keys por campaign_name se houver cross-account.
    if (nameIds.length > 0) {
      const rows = await tx.adsPerformance.findMany({
        where: {
          companyId,
          campaignName: { in: nameIds },
          externalCampaignId: null, // somente rows Excel-only (alinhado com semantica de "name:")
          ...(opts.campaignIdFilter === null
            ? { campaignId: null }
            : { campaignId: opts.campaignIdFilter }),
        },
        select: { campaignName: true, accountName: true },
        distinct: ['campaignName', 'accountName'],
      })

      for (const row of rows) {
        if (!row.campaignName) continue
        keys.push(`name:${row.accountName ?? ''}|${row.campaignName}`)
      }
    }

    return keys
  }

  /**
   * Invalida cache do dashboard de ads para uma campanha HDM especifica.
   */
  private async invalidateAdsCacheForCampaign(hdmCampaignId: string): Promise<void> {
    try {
      const campaign = await this.prisma.campaigns.findUnique({
        where: { campaignId: hdmCampaignId },
        select: { company: { select: { id: true, subdomain: true } } },
      })
      if (campaign?.company?.subdomain) {
        const subdomain = campaign.company.subdomain
        await Promise.all([
          this.redisService.delByPattern(`dashboard:ads:*:${subdomain}:${hdmCampaignId}:*`),
          this.redisService.delByPattern(`dashboard:ads:*:${subdomain}:${hdmCampaignId}`),
          this.redisService.del(`lookup:company-campaigns:${campaign.company.id}`),
        ])
      }
    } catch (err) {
      this.logger.warn(`Falha ao invalidar cache de ads para campanha ${hdmCampaignId}: ${err.message}`)
    }
  }
}
