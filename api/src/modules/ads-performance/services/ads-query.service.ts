import { Injectable, Logger } from '@nestjs/common'
import { PrismaService } from 'src/database/prisma.service'
import { Prisma } from '@prisma/client'
import {
  MetaCampaignGroup,
  MetaCampaignGroupWithType,
  PaginatedAvailableAdsResponse,
  AvailableAdsResponse,
  GetAvailableParams,
} from '../types/ads-performance.types'

@Injectable()
export class AdsQueryService {
  private readonly logger = new Logger(AdsQueryService.name)

  constructor(private prisma: PrismaService) {}

  /**
   * Busca campanhas do Meta com paginacao e filtros no backend
   */
  async getAvailableCampaignsPaginated(params: GetAvailableParams): Promise<PaginatedAvailableAdsResponse> {
    const {
      companyId,
      hdmCampaignId,
      search,
      sortField = 'date',
      sortOrder = 'desc',
      filterHasLeads = 'all',
      filterObjective,
      filterStatus,
      page = 1,
      pageSize = 10,
    } = params

    this.logger.log(`Getting paginated campaigns - companyId: ${companyId}, page: ${page}, pageSize: ${pageSize}, search: ${search || 'none'}`)

    // Busca textual: pesquisa em campaign_name, account_name e externalCampaignId.
    // Inclui account_name porque registros nivel conta (level=account do Meta)
    // nao possuem campaign_name, apenas account_name preenchido.
    // Sem alias - usado nas queries de available e linked (sem JOIN)
    const searchCondition = search
      ? Prisma.sql`AND (LOWER(campaign_name) LIKE LOWER(${'%' + search + '%'}) OR LOWER(account_name) LIKE LOWER(${'%' + search + '%'}) OR "externalCampaignId" LIKE ${'%' + search + '%'})`
      : Prisma.empty

    // Com alias ap - usado nas queries de linkedToOther (com JOIN na tabela Campaigns)
    const searchConditionAliased = search
      ? Prisma.sql`AND (LOWER(ap.campaign_name) LIKE LOWER(${'%' + search + '%'}) OR LOWER(ap.account_name) LIKE LOWER(${'%' + search + '%'}) OR ap."externalCampaignId" LIKE ${'%' + search + '%'})`
      : Prisma.empty

    // Build leads filter condition
    const leadsHavingCondition = filterHasLeads === 'yes'
      ? Prisma.sql`HAVING SUM(results) > 0`
      : filterHasLeads === 'no'
        ? Prisma.sql`HAVING SUM(results) = 0 OR SUM(results) IS NULL`
        : Prisma.empty

    // Build leads filter condition (com alias ap)
    const leadsHavingConditionAliased = filterHasLeads === 'yes'
      ? Prisma.sql`HAVING SUM(ap.results) > 0`
      : filterHasLeads === 'no'
        ? Prisma.sql`HAVING SUM(ap.results) = 0 OR SUM(ap.results) IS NULL`
        : Prisma.empty

    // Build leads filter condition (com alias h - para queries hierarquicas)
    const leadsHavingConditionH = filterHasLeads === 'yes'
      ? Prisma.sql`HAVING SUM(h.results) > 0`
      : filterHasLeads === 'no'
        ? Prisma.sql`HAVING SUM(h.results) = 0 OR SUM(h.results) IS NULL`
        : Prisma.empty

    // Filtro por objetivo (sem alias - queries available e linked)
    const objectiveCondition = filterObjective && filterObjective !== 'all'
      ? Prisma.sql`AND objective = ${filterObjective}`
      : Prisma.empty

    // Filtro por objetivo (com alias ap - query linkedToOther)
    const objectiveConditionAliased = filterObjective && filterObjective !== 'all'
      ? Prisma.sql`AND ap.objective = ${filterObjective}`
      : Prisma.empty

    // Filtro por status de entrega (sem alias)
    const statusCondition = filterStatus && filterStatus !== 'all'
      ? Prisma.sql`AND delivery_status = ${filterStatus}`
      : Prisma.empty

    // Filtro por status de entrega (com alias ap)
    const statusConditionAliased = filterStatus && filterStatus !== 'all'
      ? Prisma.sql`AND ap.delivery_status = ${filterStatus}`
      : Prisma.empty

    try {
      // ============================================================================
      // Todas as 3 queries (available, linked, linkedToOther) rodam em PARALELO
      // pois sao independentes entre si. Isso reduz o tempo total de ~3x.
      // ============================================================================

      // ============================================================================
      // QUERY: AVAILABLE (campanhas/contas ainda nao vinculadas a nenhuma campanha HDM)
      // ============================================================================
      // Hierarquia de dados do Meta (4 niveis):
      //   Level 0 = Conta    -> so account_name preenchido (sem campaign_name, adset_name, ad_name)
      //   Level 1 = Campanha -> campaign_name preenchido (sem adset_name, ad_name)
      //   Level 2 = Publico  -> adset_name preenchido (sem ad_name)
      //   Level 3 = Anuncio  -> ad_name preenchido
      //
      // A query usa fallback hierarquico para evitar duplicacao de metricas:
      //   - Pega sempre o nivel mais alto com dados (impressions > 0)
      //   - Ex: se existem registros de campanha E publico, usa so campanha
      //
      // Regra de gasto (totalSpent):
      //   - Level 0 (Conta): usa amount_spent (gasto individual da conta)
      //   - Level 1 (Campanha): usa campaign_total_ads_spent (gasto total da campanha)
      //   - Level 2/3: usa campaign_total_ads_spent (mas so chega aqui se nao houver nivel superior)
      //
      // Agrupamento: usa COALESCE(campaign_name, account_name) como group_name
      //   - Campanhas agrupam por campaign_name
      //   - Contas agrupam por account_name (pois campaign_name e NULL)
      //
      // isAccountLevel: flag booleana que indica se TODOS os registros do grupo
      //   sao nivel conta (campaign_name IS NULL). Usado para gerar o prefixo correto
      //   do ID (account: vs name:) na hora de vincular/desvincular.
      // ============================================================================
      const availablePromise = this.prisma.$queryRaw<Array<{
        externalCampaignIds: string | null
        campaignName: string | null
        isAccountLevel: boolean
        totalRecords: bigint
        adSetsCount: bigint
        adsCount: bigint
        firstDate: Date | null
        lastDate: Date | null
        totalSpent: string | null
        totalImpressions: bigint | null
        totalClicks: bigint | null
        totalLeads: bigint | null
        deliveryStatus: string | null
        objective: string | null
        accountName: string | null
      }>>`
        -- CTE 1: Seleciona todos os registros, deduplica por data_source e classifica o nivel hierarquico
        WITH all_records AS (
          SELECT
            "externalCampaignId",
            campaign_name,
            account_name,
            objective,
            adset_name,
            ad_name,
            report_start_date,
            report_end_date,
            campaign_total_ads_spent,
            amount_spent,
            impressions,
            link_clicks,
            results,
            ROW_NUMBER() OVER (
              PARTITION BY report_start_date, COALESCE(campaign_name, ''), COALESCE(adset_name, ''), COALESCE(ad_name, '')
              ORDER BY CASE WHEN data_source = 'meta_api_ads' THEN 1 WHEN data_source = 'meta_api' THEN 2 ELSE 3 END,
                       id_record ASC
            ) AS rn
          FROM ads_performance
          WHERE company_id = ${companyId}
            AND (campaign_name IS NOT NULL OR (account_name IS NOT NULL AND account_name != ''))
            AND "campaignId" IS NULL
            AND (data_source IS NULL OR data_source != 'meta_api_zero')
            ${searchCondition}
            ${objectiveCondition}
            ${statusCondition}
        ),
        hierarchical AS (
          SELECT
            "externalCampaignId",
            campaign_name,
            account_name,
            objective,
            adset_name,
            ad_name,
            report_start_date,
            report_end_date,
            campaign_total_ads_spent,
            amount_spent,
            impressions,
            link_clicks,
            results,
            CASE
              WHEN (campaign_name IS NULL OR campaign_name = '') AND (adset_name IS NULL OR adset_name = '') AND (ad_name IS NULL OR ad_name = '') THEN 0
              WHEN (adset_name IS NULL OR adset_name = '') AND (ad_name IS NULL OR ad_name = '') THEN 1
              WHEN (adset_name IS NOT NULL AND adset_name != '') AND (ad_name IS NULL OR ad_name = '') THEN 2
              WHEN ad_name IS NOT NULL AND ad_name != '' THEN 3
              ELSE 4
            END AS hierarchy_level,
            COALESCE(campaign_name, account_name) AS group_name
          FROM all_records
          WHERE rn = 1
        ),
        -- CTE 2: Soma impressoes por group_name + hierarchy_level
        -- Serve para descobrir quais niveis tem dados reais (impressions > 0)
        level_sums AS (
          SELECT group_name, hierarchy_level, COALESCE(SUM(impressions), 0) AS total_impressions
          FROM hierarchical
          WHERE hierarchy_level < 4
          GROUP BY group_name, hierarchy_level
        ),
        -- CTE 3: Para cada group_name, pega o nivel mais GRANULAR (maior numero)
        -- que tenha impressoes > 0. Evita duplicacao de metricas e captura
        -- todos os detalhes (anuncios > publicos > campanha).
        -- Ex: se tem dados de Campanha (1) e Anuncio (3), usa Anuncio (3) que
        -- tem o gasto/impressoes/conversoes mais completos.
        -- Alinha com a regra usada em ads-daily.service.ts (dashboard marketing).
        best_level AS (
          SELECT group_name, MAX(hierarchy_level) AS best_level
          FROM level_sums
          WHERE total_impressions > 0
          GROUP BY group_name
        ),
        -- CTE 4: Contagem de adsets e ads distintos (usa todos os niveis, nao so o min)
        counts AS (
          SELECT
            group_name,
            COUNT(DISTINCT CASE WHEN adset_name IS NOT NULL AND adset_name != '' THEN adset_name END) AS adsets_count,
            COUNT(DISTINCT CASE WHEN ad_name IS NOT NULL AND ad_name != '' THEN ad_name END) AS ads_count
          FROM hierarchical
          GROUP BY group_name
        )
        -- SELECT final: junta as metricas agregadas com as contagens
        SELECT
          agg."externalCampaignIds",
          agg."campaignName",
          agg."isAccountLevel",
          agg."totalRecords",
          COALESCE(cnt.adsets_count, 0)::bigint AS "adSetsCount",
          COALESCE(cnt.ads_count, 0)::bigint AS "adsCount",
          agg."firstDate",
          agg."lastDate",
          agg."totalSpent",
          agg."totalImpressions",
          agg."totalClicks",
          agg."totalLeads",
          -- Busca delivery_status do registro nivel mais alto (sem adset/ad)
          -- Usa COALESCE para encontrar tanto por campaign_name quanto account_name
          (SELECT sub.delivery_status FROM ads_performance sub
           WHERE COALESCE(sub.campaign_name, sub.account_name) = agg."campaignName"
             AND sub.company_id = ${companyId}
             AND sub.adset_name IS NULL
             AND sub.ad_name IS NULL
           LIMIT 1) as "deliveryStatus",
          agg."objective",
          agg."accountName"
        FROM (
          -- Subquery de agregacao: filtra apenas registros do nivel hierarquico escolhido (best_level — mais granular)
          SELECT
            STRING_AGG(DISTINCT h."externalCampaignId", ',' ORDER BY h."externalCampaignId") as "externalCampaignIds",
            h.group_name as "campaignName",
            -- isAccountLevel: true se TODOS os registros do grupo tem campaign_name nulo
            -- Usado no TypeScript para gerar o prefixo correto do ID (account: vs name:)
            BOOL_AND(h.campaign_name IS NULL OR h.campaign_name = '') as "isAccountLevel",
            COUNT(*) as "totalRecords",
            MIN(h.report_start_date) as "firstDate",
            MAX(h.report_end_date) as "lastDate",
            -- Gasto normalizado conforme ADS_HIERARCHY_RULES:
            -- Level 1 (Campanha): COALESCE(campaign_total_ads_spent, amount_spent) - fallback para dados Meta API
            -- Level 0/2/3 (Conta/Publico/Anuncio): amount_spent
            SUM(CASE WHEN h.hierarchy_level = 1 THEN COALESCE(h.campaign_total_ads_spent, h.amount_spent) ELSE h.amount_spent END) as "totalSpent",
            SUM(h.impressions) as "totalImpressions",
            SUM(h.link_clicks) as "totalClicks",
            SUM(h.results) as "totalLeads",
            MAX(h.objective) as "objective",
            MAX(h.account_name) as "accountName"
          FROM hierarchical h
          INNER JOIN best_level ml ON h.group_name = ml.group_name AND h.hierarchy_level = ml.best_level
          GROUP BY h.group_name
          ${leadsHavingConditionH}
        ) agg
        LEFT JOIN counts cnt ON cnt.group_name = agg."campaignName"
      `

      // ============================================================================
      // QUERY: LINKED (campanhas/contas ja vinculadas a ESTA campanha HDM)
      // ============================================================================
      // Mesma logica hierarquica da query available, porem filtra por:
      //   "campaignId" = hdmCampaignId (registros ja vinculados a esta campanha)
      // A estrutura de CTEs (hierarchical, level_sums, best_level, counts) e identica.
      // ============================================================================
      type AvailableRawRow = {
        externalCampaignIds: string | null
        campaignName: string | null
        isAccountLevel: boolean
        totalRecords: bigint
        adSetsCount: bigint
        adsCount: bigint
        firstDate: Date | null
        lastDate: Date | null
        totalSpent: string | null
        totalImpressions: bigint | null
        totalClicks: bigint | null
        totalLeads: bigint | null
        deliveryStatus: string | null
        objective: string | null
        accountName: string | null
      }
      let linkedPromise: Promise<AvailableRawRow[]> = Promise.resolve([])
      if (hdmCampaignId) {
        linkedPromise = this.prisma.$queryRaw<AvailableRawRow[]>`
          WITH all_records AS (
            SELECT
              "externalCampaignId",
              campaign_name,
              account_name,
              objective,
              adset_name,
              ad_name,
              report_start_date,
              report_end_date,
              campaign_total_ads_spent,
              amount_spent,
              impressions,
              link_clicks,
              results,
              ROW_NUMBER() OVER (
                PARTITION BY report_start_date, COALESCE(campaign_name, ''), COALESCE(adset_name, ''), COALESCE(ad_name, '')
                ORDER BY CASE WHEN data_source = 'meta_api_ads' THEN 1 WHEN data_source = 'meta_api' THEN 2 ELSE 3 END,
                         id_record ASC
              ) AS rn
            FROM ads_performance
            WHERE company_id = ${companyId}
              AND (campaign_name IS NOT NULL OR (account_name IS NOT NULL AND account_name != ''))
              AND "campaignId" = ${hdmCampaignId}
              AND (data_source IS NULL OR data_source != 'meta_api_zero')
              ${searchCondition}
              ${objectiveCondition}
              ${statusCondition}
          ),
          hierarchical AS (
            SELECT
              "externalCampaignId",
              campaign_name,
              account_name,
              objective,
              adset_name,
              ad_name,
              report_start_date,
              report_end_date,
              campaign_total_ads_spent,
              amount_spent,
              impressions,
              link_clicks,
              results,
              CASE
                WHEN (campaign_name IS NULL OR campaign_name = '') AND (adset_name IS NULL OR adset_name = '') AND (ad_name IS NULL OR ad_name = '') THEN 0
                WHEN (adset_name IS NULL OR adset_name = '') AND (ad_name IS NULL OR ad_name = '') THEN 1
                WHEN (adset_name IS NOT NULL AND adset_name != '') AND (ad_name IS NULL OR ad_name = '') THEN 2
                WHEN ad_name IS NOT NULL AND ad_name != '' THEN 3
                ELSE 4
              END AS hierarchy_level,
              COALESCE(campaign_name, account_name) AS group_name
            FROM all_records
            WHERE rn = 1
          ),
          level_sums AS (
            SELECT group_name, hierarchy_level, COALESCE(SUM(impressions), 0) AS total_impressions
            FROM hierarchical
            WHERE hierarchy_level < 4
            GROUP BY group_name, hierarchy_level
          ),
          best_level AS (
            SELECT group_name, MAX(hierarchy_level) AS best_level
            FROM level_sums
            WHERE total_impressions > 0
            GROUP BY group_name
          ),
          counts AS (
            SELECT
              group_name,
              COUNT(DISTINCT CASE WHEN adset_name IS NOT NULL AND adset_name != '' THEN adset_name END) AS adsets_count,
              COUNT(DISTINCT CASE WHEN ad_name IS NOT NULL AND ad_name != '' THEN ad_name END) AS ads_count
            FROM hierarchical
            GROUP BY group_name
          )
          SELECT
            agg."externalCampaignIds",
            agg."campaignName",
            agg."isAccountLevel",
            agg."totalRecords",
            COALESCE(cnt.adsets_count, 0)::bigint AS "adSetsCount",
            COALESCE(cnt.ads_count, 0)::bigint AS "adsCount",
            agg."firstDate",
            agg."lastDate",
            agg."totalSpent",
            agg."totalImpressions",
            agg."totalClicks",
            agg."totalLeads",
            (SELECT sub.delivery_status FROM ads_performance sub
             WHERE COALESCE(sub.campaign_name, sub.account_name) = agg."campaignName"
               AND sub.company_id = ${companyId}
               AND sub.adset_name IS NULL
               AND sub.ad_name IS NULL
             LIMIT 1) as "deliveryStatus",
            agg."objective",
            agg."accountName"
          FROM (
            SELECT
              STRING_AGG(DISTINCT h."externalCampaignId", ',' ORDER BY h."externalCampaignId") as "externalCampaignIds",
              h.group_name as "campaignName",
              BOOL_AND(h.campaign_name IS NULL OR h.campaign_name = '') as "isAccountLevel",
              COUNT(*) as "totalRecords",
              MIN(h.report_start_date) as "firstDate",
              MAX(h.report_end_date) as "lastDate",
              SUM(CASE WHEN h.hierarchy_level = 1 THEN COALESCE(h.campaign_total_ads_spent, h.amount_spent) ELSE h.amount_spent END) as "totalSpent",
              SUM(h.impressions) as "totalImpressions",
              SUM(h.link_clicks) as "totalClicks",
              SUM(h.results) as "totalLeads",
              MAX(h.objective) as "objective",
              MAX(h.account_name) as "accountName"
            FROM hierarchical h
            INNER JOIN best_level ml ON h.group_name = ml.group_name AND h.hierarchy_level = ml.best_level
            GROUP BY h.group_name
            ${leadsHavingConditionH}
          ) agg
          LEFT JOIN counts cnt ON cnt.group_name = agg."campaignName"
        `
      }

      // ============================================================================
      // QUERY: LINKED TO OTHER (campanhas/contas vinculadas a OUTRAS campanhas HDM)
      // ============================================================================
      // Mesma logica hierarquica, porem filtra por:
      //   "campaignId" IS NOT NULL AND "campaignId" != hdmCampaignId
      // Diferenca: faz JOIN com tabela Campaigns para trazer o nome da campanha HDM
      //   a que esta vinculado (linkedCampaignName).
      // Tambem agrupa por "campaignId" alem de group_name, porque o mesmo
      //   grupo Meta pode estar vinculado a diferentes campanhas HDM.
      // ============================================================================
      type LinkedToOtherRawRow = {
        externalCampaignIds: string | null
        campaignName: string | null
        isAccountLevel: boolean
        totalRecords: bigint
        adSetsCount: bigint
        adsCount: bigint
        linkedCampaignId: string
        linkedCampaignName: string | null
        firstDate: Date | null
        lastDate: Date | null
        totalSpent: string | null
        totalImpressions: bigint | null
        totalClicks: bigint | null
        totalLeads: bigint | null
        deliveryStatus: string | null
        objective: string | null
        accountName: string | null
      }
      let linkedToOtherPromise: Promise<LinkedToOtherRawRow[]> = Promise.resolve([])

      if (hdmCampaignId) {
        linkedToOtherPromise = this.prisma.$queryRaw<LinkedToOtherRawRow[]>`
          WITH all_records AS (
            SELECT
              ap."externalCampaignId",
              ap.campaign_name,
              ap.account_name,
              ap.objective,
              ap.adset_name,
              ap.ad_name,
              ap.report_start_date,
              ap.report_end_date,
              ap.campaign_total_ads_spent,
              ap.amount_spent,
              ap.impressions,
              ap.link_clicks,
              ap.results,
              ap."campaignId",
              c.name as linked_campaign_name,
              ROW_NUMBER() OVER (
                PARTITION BY ap.report_start_date, COALESCE(ap.campaign_name, ''), COALESCE(ap.adset_name, ''), COALESCE(ap.ad_name, '')
                ORDER BY CASE WHEN ap.data_source = 'meta_api_ads' THEN 1 WHEN ap.data_source = 'meta_api' THEN 2 ELSE 3 END,
                         ap.id_record ASC
              ) AS rn
            FROM ads_performance ap
            LEFT JOIN "Campaigns" c ON c."campaignId" = ap."campaignId"
            WHERE ap.company_id = ${companyId}
              AND (ap.campaign_name IS NOT NULL OR (ap.account_name IS NOT NULL AND ap.account_name != ''))
              AND ap."campaignId" IS NOT NULL
              AND ap."campaignId" != ${hdmCampaignId}
              AND (ap.data_source IS NULL OR ap.data_source != 'meta_api_zero')
              ${searchConditionAliased}
              ${objectiveConditionAliased}
              ${statusConditionAliased}
          ),
          hierarchical AS (
            SELECT
              "externalCampaignId",
              campaign_name,
              account_name,
              objective,
              adset_name,
              ad_name,
              report_start_date,
              report_end_date,
              campaign_total_ads_spent,
              amount_spent,
              impressions,
              link_clicks,
              results,
              "campaignId",
              linked_campaign_name,
              CASE
                WHEN (campaign_name IS NULL OR campaign_name = '') AND (adset_name IS NULL OR adset_name = '') AND (ad_name IS NULL OR ad_name = '') THEN 0
                WHEN (adset_name IS NULL OR adset_name = '') AND (ad_name IS NULL OR ad_name = '') THEN 1
                WHEN (adset_name IS NOT NULL AND adset_name != '') AND (ad_name IS NULL OR ad_name = '') THEN 2
                WHEN ad_name IS NOT NULL AND ad_name != '' THEN 3
                ELSE 4
              END AS hierarchy_level,
              COALESCE(campaign_name, account_name) AS group_name
            FROM all_records
            WHERE rn = 1
          ),
          level_sums AS (
            SELECT group_name, "campaignId", hierarchy_level, COALESCE(SUM(impressions), 0) AS total_impressions
            FROM hierarchical
            WHERE hierarchy_level < 4
            GROUP BY group_name, "campaignId", hierarchy_level
          ),
          best_level AS (
            SELECT group_name, "campaignId", MAX(hierarchy_level) AS best_level
            FROM level_sums
            WHERE total_impressions > 0
            GROUP BY group_name, "campaignId"
          ),
          counts AS (
            SELECT
              group_name,
              "campaignId",
              COUNT(DISTINCT CASE WHEN adset_name IS NOT NULL AND adset_name != '' THEN adset_name END) AS adsets_count,
              COUNT(DISTINCT CASE WHEN ad_name IS NOT NULL AND ad_name != '' THEN ad_name END) AS ads_count
            FROM hierarchical
            GROUP BY group_name, "campaignId"
          )
          SELECT
            agg."externalCampaignIds",
            agg."campaignName",
            agg."isAccountLevel",
            agg."totalRecords",
            COALESCE(cnt.adsets_count, 0)::bigint AS "adSetsCount",
            COALESCE(cnt.ads_count, 0)::bigint AS "adsCount",
            agg."linkedCampaignId",
            agg."linkedCampaignName",
            agg."firstDate",
            agg."lastDate",
            agg."totalSpent",
            agg."totalImpressions",
            agg."totalClicks",
            agg."totalLeads",
            (SELECT sub.delivery_status FROM ads_performance sub
             WHERE COALESCE(sub.campaign_name, sub.account_name) = agg."campaignName"
               AND sub.company_id = ${companyId}
               AND sub.adset_name IS NULL
               AND sub.ad_name IS NULL
             LIMIT 1) as "deliveryStatus",
            agg."objective",
            agg."accountName"
          FROM (
            SELECT
              STRING_AGG(DISTINCT h."externalCampaignId", ',' ORDER BY h."externalCampaignId") as "externalCampaignIds",
              h.group_name as "campaignName",
              BOOL_AND(h.campaign_name IS NULL OR h.campaign_name = '') as "isAccountLevel",
              COUNT(*) as "totalRecords",
              h."campaignId" as "linkedCampaignId",
              MAX(h.linked_campaign_name) as "linkedCampaignName",
              MIN(h.report_start_date) as "firstDate",
              MAX(h.report_end_date) as "lastDate",
              SUM(CASE WHEN h.hierarchy_level = 1 THEN COALESCE(h.campaign_total_ads_spent, h.amount_spent) ELSE h.amount_spent END) as "totalSpent",
              SUM(h.impressions) as "totalImpressions",
              SUM(h.link_clicks) as "totalClicks",
              SUM(h.results) as "totalLeads",
              MAX(h.objective) as "objective",
              MAX(h.account_name) as "accountName"
            FROM hierarchical h
            INNER JOIN best_level ml ON h.group_name = ml.group_name AND h."campaignId" = ml."campaignId" AND h.hierarchy_level = ml.best_level
            GROUP BY h.group_name, h."campaignId"
            ${leadsHavingConditionH}
          ) agg
          LEFT JOIN counts cnt ON cnt.group_name = agg."campaignName" AND cnt."campaignId" = agg."linkedCampaignId"
        `
      } else {
        linkedToOtherPromise = this.prisma.$queryRaw<LinkedToOtherRawRow[]>`
          WITH all_records AS (
            SELECT
              ap."externalCampaignId",
              ap.campaign_name,
              ap.account_name,
              ap.objective,
              ap.adset_name,
              ap.ad_name,
              ap.report_start_date,
              ap.report_end_date,
              ap.campaign_total_ads_spent,
              ap.amount_spent,
              ap.impressions,
              ap.link_clicks,
              ap.results,
              ap."campaignId",
              c.name as linked_campaign_name,
              ROW_NUMBER() OVER (
                PARTITION BY ap.report_start_date, COALESCE(ap.campaign_name, ''), COALESCE(ap.adset_name, ''), COALESCE(ap.ad_name, '')
                ORDER BY CASE WHEN ap.data_source = 'meta_api_ads' THEN 1 WHEN ap.data_source = 'meta_api' THEN 2 ELSE 3 END,
                         ap.id_record ASC
              ) AS rn
            FROM ads_performance ap
            LEFT JOIN "Campaigns" c ON c."campaignId" = ap."campaignId"
            WHERE ap.company_id = ${companyId}
              AND (ap.campaign_name IS NOT NULL OR (ap.account_name IS NOT NULL AND ap.account_name != ''))
              AND ap."campaignId" IS NOT NULL
              AND (ap.data_source IS NULL OR ap.data_source != 'meta_api_zero')
              ${searchConditionAliased}
              ${objectiveConditionAliased}
              ${statusConditionAliased}
          ),
          hierarchical AS (
            SELECT
              "externalCampaignId",
              campaign_name,
              account_name,
              objective,
              adset_name,
              ad_name,
              report_start_date,
              report_end_date,
              campaign_total_ads_spent,
              amount_spent,
              impressions,
              link_clicks,
              results,
              "campaignId",
              linked_campaign_name,
              CASE
                WHEN (campaign_name IS NULL OR campaign_name = '') AND (adset_name IS NULL OR adset_name = '') AND (ad_name IS NULL OR ad_name = '') THEN 0
                WHEN (adset_name IS NULL OR adset_name = '') AND (ad_name IS NULL OR ad_name = '') THEN 1
                WHEN (adset_name IS NOT NULL AND adset_name != '') AND (ad_name IS NULL OR ad_name = '') THEN 2
                WHEN ad_name IS NOT NULL AND ad_name != '' THEN 3
                ELSE 4
              END AS hierarchy_level,
              COALESCE(campaign_name, account_name) AS group_name
            FROM all_records
            WHERE rn = 1
          ),
          level_sums AS (
            SELECT group_name, "campaignId", hierarchy_level, COALESCE(SUM(impressions), 0) AS total_impressions
            FROM hierarchical
            WHERE hierarchy_level < 4
            GROUP BY group_name, "campaignId", hierarchy_level
          ),
          best_level AS (
            SELECT group_name, "campaignId", MAX(hierarchy_level) AS best_level
            FROM level_sums
            WHERE total_impressions > 0
            GROUP BY group_name, "campaignId"
          ),
          counts AS (
            SELECT
              group_name,
              "campaignId",
              COUNT(DISTINCT CASE WHEN adset_name IS NOT NULL AND adset_name != '' THEN adset_name END) AS adsets_count,
              COUNT(DISTINCT CASE WHEN ad_name IS NOT NULL AND ad_name != '' THEN ad_name END) AS ads_count
            FROM hierarchical
            GROUP BY group_name, "campaignId"
          )
          SELECT
            agg."externalCampaignIds",
            agg."campaignName",
            agg."isAccountLevel",
            agg."totalRecords",
            COALESCE(cnt.adsets_count, 0)::bigint AS "adSetsCount",
            COALESCE(cnt.ads_count, 0)::bigint AS "adsCount",
            agg."linkedCampaignId",
            agg."linkedCampaignName",
            agg."firstDate",
            agg."lastDate",
            agg."totalSpent",
            agg."totalImpressions",
            agg."totalClicks",
            agg."totalLeads",
            (SELECT sub.delivery_status FROM ads_performance sub
             WHERE COALESCE(sub.campaign_name, sub.account_name) = agg."campaignName"
               AND sub.company_id = ${companyId}
               AND sub.adset_name IS NULL
               AND sub.ad_name IS NULL
             LIMIT 1) as "deliveryStatus",
            agg."objective",
            agg."accountName"
          FROM (
            SELECT
              STRING_AGG(DISTINCT h."externalCampaignId", ',' ORDER BY h."externalCampaignId") as "externalCampaignIds",
              h.group_name as "campaignName",
              BOOL_AND(h.campaign_name IS NULL OR h.campaign_name = '') as "isAccountLevel",
              COUNT(*) as "totalRecords",
              h."campaignId" as "linkedCampaignId",
              MAX(h.linked_campaign_name) as "linkedCampaignName",
              MIN(h.report_start_date) as "firstDate",
              MAX(h.report_end_date) as "lastDate",
              SUM(CASE WHEN h.hierarchy_level = 1 THEN COALESCE(h.campaign_total_ads_spent, h.amount_spent) ELSE h.amount_spent END) as "totalSpent",
              SUM(h.impressions) as "totalImpressions",
              SUM(h.link_clicks) as "totalClicks",
              SUM(h.results) as "totalLeads",
              MAX(h.objective) as "objective",
              MAX(h.account_name) as "accountName"
            FROM hierarchical h
            INNER JOIN best_level ml ON h.group_name = ml.group_name AND h."campaignId" = ml."campaignId" AND h.hierarchy_level = ml.best_level
            GROUP BY h.group_name, h."campaignId"
            ${leadsHavingConditionH}
          ) agg
          LEFT JOIN counts cnt ON cnt.group_name = agg."campaignName" AND cnt."campaignId" = agg."linkedCampaignId"
        `
      }

      // Query de lastUpdatedAt tambem roda em paralelo
      const lastUpdatedPromise = hdmCampaignId
        ? this.prisma.campaigns.findUnique({
            where: { campaignId: hdmCampaignId },
            select: { adsLastUpdatedAt: true },
          }).then(c => c?.adsLastUpdatedAt?.toISOString() ?? null)
        : Promise.resolve(null)

      // Executa todas as queries em paralelo para reduzir tempo total
      const [availableRaw, linkedRaw, linkedToOtherRaw, lastUpdatedAt] = await Promise.all([
        availablePromise,
        linkedPromise,
        linkedToOtherPromise,
        lastUpdatedPromise,
      ])

      // ============================================================================
      // GERACAO DE IDs E TRANSFORMACAO DOS DADOS
      // ============================================================================
      const generateIdFromName = (name: string | null, isAccount: boolean) =>
        isAccount ? `account:${name || 'unknown'}` : `name:${name || 'unknown'}`

      const available: MetaCampaignGroupWithType[] = availableRaw.map(r => {
        const ids = r.externalCampaignIds ? r.externalCampaignIds.split(',').filter(Boolean) : []
        const mainId = ids[0] || generateIdFromName(r.campaignName, r.isAccountLevel)
        return {
          _type: 'available' as const,
          externalCampaignId: mainId,
          externalCampaignIds: ids.length > 0 ? ids : [mainId],
          campaignName: r.campaignName,
          totalRecords: Number(r.totalRecords),
          adSetsCount: Number(r.adSetsCount),
          adsCount: Number(r.adsCount),
          isLinked: false,
          linkedToCampaignId: null,
          firstDate: r.firstDate ? r.firstDate.toISOString().split('T')[0] : null,
          lastDate: r.lastDate ? r.lastDate.toISOString().split('T')[0] : null,
          totalSpent: r.totalSpent ? Number(r.totalSpent) : 0,
          totalImpressions: r.totalImpressions ? Number(r.totalImpressions) : 0,
          totalClicks: r.totalClicks ? Number(r.totalClicks) : 0,
          totalLeads: r.totalLeads ? Number(r.totalLeads) : 0,
          deliveryStatus: r.deliveryStatus || null,
          objective: r.objective || null,
          accountName: r.accountName || null,
        }
      })

      const linked: MetaCampaignGroupWithType[] = linkedRaw.map(r => {
        const ids = r.externalCampaignIds ? r.externalCampaignIds.split(',').filter(Boolean) : []
        const mainId = ids[0] || generateIdFromName(r.campaignName, r.isAccountLevel)
        return {
          _type: 'linked' as const,
          externalCampaignId: mainId,
          externalCampaignIds: ids.length > 0 ? ids : [mainId],
          campaignName: r.campaignName,
          totalRecords: Number(r.totalRecords),
          adSetsCount: Number(r.adSetsCount),
          adsCount: Number(r.adsCount),
          isLinked: true,
          linkedToCampaignId: hdmCampaignId || null,
          firstDate: r.firstDate ? r.firstDate.toISOString().split('T')[0] : null,
          lastDate: r.lastDate ? r.lastDate.toISOString().split('T')[0] : null,
          totalSpent: r.totalSpent ? Number(r.totalSpent) : 0,
          totalImpressions: r.totalImpressions ? Number(r.totalImpressions) : 0,
          totalClicks: r.totalClicks ? Number(r.totalClicks) : 0,
          totalLeads: r.totalLeads ? Number(r.totalLeads) : 0,
          deliveryStatus: r.deliveryStatus || null,
          objective: r.objective || null,
          accountName: r.accountName || null,
        }
      })

      const linkedToOther: MetaCampaignGroupWithType[] = linkedToOtherRaw.map(r => {
        const ids = r.externalCampaignIds ? r.externalCampaignIds.split(',').filter(Boolean) : []
        const mainId = ids[0] || generateIdFromName(r.campaignName, r.isAccountLevel)
        return {
          _type: 'other' as const,
          externalCampaignId: mainId,
          externalCampaignIds: ids.length > 0 ? ids : [mainId],
          campaignName: r.campaignName,
          totalRecords: Number(r.totalRecords),
          adSetsCount: Number(r.adSetsCount),
          adsCount: Number(r.adsCount),
          isLinked: true,
          linkedToCampaignId: r.linkedCampaignId,
          linkedToCampaignName: r.linkedCampaignName,
          firstDate: r.firstDate ? r.firstDate.toISOString().split('T')[0] : null,
          lastDate: r.lastDate ? r.lastDate.toISOString().split('T')[0] : null,
          totalSpent: r.totalSpent ? Number(r.totalSpent) : 0,
          totalImpressions: r.totalImpressions ? Number(r.totalImpressions) : 0,
          totalClicks: r.totalClicks ? Number(r.totalClicks) : 0,
          totalLeads: r.totalLeads ? Number(r.totalLeads) : 0,
          deliveryStatus: r.deliveryStatus || null,
          objective: r.objective || null,
          accountName: r.accountName || null,
        }
      })

      // Combine all campaigns (order: linked first, then available, then other)
      const allCampaigns = [...linked, ...available, ...linkedToOther]

      // Sort combined list
      allCampaigns.sort((a, b) => {
        let comparison = 0
        switch (sortField) {
          case 'name':
            comparison = (a.campaignName || '').localeCompare(b.campaignName || '')
            break
          case 'date':
            const dateA = a.lastDate ? new Date(a.lastDate).getTime() : 0
            const dateB = b.lastDate ? new Date(b.lastDate).getTime() : 0
            comparison = dateA - dateB
            break
          case 'spent':
            comparison = a.totalSpent - b.totalSpent
            break
          case 'impressions':
            comparison = a.totalImpressions - b.totalImpressions
            break
          case 'clicks':
            comparison = a.totalClicks - b.totalClicks
            break
          case 'leads':
            comparison = a.totalLeads - b.totalLeads
            break
        }
        return sortOrder === 'asc' ? comparison : -comparison
      })

      // Paginate
      const totalItems = allCampaigns.length
      const totalPages = Math.ceil(totalItems / pageSize)
      const startIndex = (page - 1) * pageSize
      const paginatedData = allCampaigns.slice(startIndex, startIndex + pageSize)

      this.logger.log(`Returning ${paginatedData.length} of ${totalItems} campaigns (page ${page}/${totalPages})`)

      return {
        data: paginatedData,
        meta: {
          page,
          pageSize,
          totalItems,
          totalPages,
        },
        counts: {
          available: available.length,
          linked: linked.length,
          linkedToOther: linkedToOther.length,
        },
        lastUpdatedAt,
      }
    } catch (error) {
      this.logger.error(`Error fetching available campaigns: ${error.message}`, error.stack)
      throw error
    }
  }

  /**
   * Legacy method - returns all campaigns without pagination
   * @deprecated Use getAvailableCampaignsPaginated instead
   */
  async getAvailableCampaigns(companyId: string, hdmCampaignId?: string): Promise<AvailableAdsResponse> {
    this.logger.log(`Getting campaigns for companyId: ${companyId}, hdmCampaignId: ${hdmCampaignId || 'none'}`)

    try {
      const availableRaw = await this.prisma.$queryRaw<Array<{
        externalCampaignIds: string
        campaignName: string | null
        totalRecords: bigint
        adSetsCount: bigint
        adsCount: bigint
        firstDate: Date | null
        lastDate: Date | null
        totalSpent: string | null
        totalImpressions: bigint | null
        totalClicks: bigint | null
        totalLeads: bigint | null
      }>>`
        SELECT
          STRING_AGG(DISTINCT "externalCampaignId", ',' ORDER BY "externalCampaignId") as "externalCampaignIds",
          campaign_name as "campaignName",
          COUNT(*) as "totalRecords",
          COUNT(DISTINCT adset_id) as "adSetsCount",
          COUNT(DISTINCT ad_id) as "adsCount",
          MIN(report_start_date) as "firstDate",
          MAX(report_end_date) as "lastDate",
          SUM(amount_spent) as "totalSpent",
          SUM(impressions) as "totalImpressions",
          SUM(link_clicks) as "totalClicks",
          SUM(results) as "totalLeads"
        FROM ads_performance
        WHERE company_id = ${companyId}
          AND "externalCampaignId" IS NOT NULL
          AND "campaignId" IS NULL
        GROUP BY campaign_name
        ORDER BY MAX(report_end_date) DESC NULLS LAST
      `

      this.logger.log(`Available campaigns found: ${availableRaw.length}`)

      let linkedRaw: Array<{
        externalCampaignIds: string
        campaignName: string | null
        totalRecords: bigint
        adSetsCount: bigint
        adsCount: bigint
        firstDate: Date | null
        lastDate: Date | null
        totalSpent: string | null
        totalImpressions: bigint | null
        totalClicks: bigint | null
        totalLeads: bigint | null
      }> = []

      if (hdmCampaignId) {
        linkedRaw = await this.prisma.$queryRaw<Array<{
          externalCampaignIds: string
          campaignName: string | null
          totalRecords: bigint
          adSetsCount: bigint
          adsCount: bigint
          firstDate: Date | null
          lastDate: Date | null
          totalSpent: string | null
          totalImpressions: bigint | null
          totalClicks: bigint | null
          totalLeads: bigint | null
        }>>`
          SELECT
            STRING_AGG(DISTINCT "externalCampaignId", ',' ORDER BY "externalCampaignId") as "externalCampaignIds",
            campaign_name as "campaignName",
            COUNT(*) as "totalRecords",
            COUNT(DISTINCT adset_id) as "adSetsCount",
            COUNT(DISTINCT ad_id) as "adsCount",
            MIN(report_start_date) as "firstDate",
            MAX(report_end_date) as "lastDate",
            SUM(amount_spent) as "totalSpent",
            SUM(impressions) as "totalImpressions",
            SUM(link_clicks) as "totalClicks",
            SUM(results) as "totalLeads"
          FROM ads_performance
          WHERE company_id = ${companyId}
            AND "externalCampaignId" IS NOT NULL
            AND "campaignId" = ${hdmCampaignId}
          GROUP BY campaign_name
          ORDER BY MAX(report_end_date) DESC NULLS LAST
        `
        this.logger.log(`Linked campaigns found: ${linkedRaw.length}`)
      }

      let linkedToOtherRaw: Array<{
        externalCampaignIds: string
        campaignName: string | null
        totalRecords: bigint
        adSetsCount: bigint
        adsCount: bigint
        linkedCampaignId: string
        linkedCampaignName: string | null
        firstDate: Date | null
        lastDate: Date | null
        totalSpent: string | null
        totalImpressions: bigint | null
        totalClicks: bigint | null
        totalLeads: bigint | null
      }> = []

      if (hdmCampaignId) {
        linkedToOtherRaw = await this.prisma.$queryRaw`
          SELECT
            STRING_AGG(DISTINCT ap."externalCampaignId", ',' ORDER BY ap."externalCampaignId") as "externalCampaignIds",
            ap.campaign_name as "campaignName",
            COUNT(*) as "totalRecords",
            COUNT(DISTINCT ap.adset_id) as "adSetsCount",
            COUNT(DISTINCT ap.ad_id) as "adsCount",
            ap."campaignId" as "linkedCampaignId",
            MAX(c.name) as "linkedCampaignName",
            MIN(ap.report_start_date) as "firstDate",
            MAX(ap.report_end_date) as "lastDate",
            SUM(ap.amount_spent) as "totalSpent",
            SUM(ap.impressions) as "totalImpressions",
            SUM(ap.link_clicks) as "totalClicks",
            SUM(ap.results) as "totalLeads"
          FROM ads_performance ap
          LEFT JOIN "Campaigns" c ON c."campaignId" = ap."campaignId"
          WHERE ap.company_id = ${companyId}
            AND ap."externalCampaignId" IS NOT NULL
            AND ap."campaignId" IS NOT NULL
            AND ap."campaignId" != ${hdmCampaignId}
          GROUP BY ap.campaign_name, ap."campaignId"
          ORDER BY MAX(ap.report_end_date) DESC NULLS LAST
        `
      } else {
        linkedToOtherRaw = await this.prisma.$queryRaw`
          SELECT
            STRING_AGG(DISTINCT ap."externalCampaignId", ',' ORDER BY ap."externalCampaignId") as "externalCampaignIds",
            ap.campaign_name as "campaignName",
            COUNT(*) as "totalRecords",
            COUNT(DISTINCT ap.adset_id) as "adSetsCount",
            COUNT(DISTINCT ap.ad_id) as "adsCount",
            ap."campaignId" as "linkedCampaignId",
            MAX(c.name) as "linkedCampaignName",
            MIN(ap.report_start_date) as "firstDate",
            MAX(ap.report_end_date) as "lastDate",
            SUM(ap.amount_spent) as "totalSpent",
            SUM(ap.impressions) as "totalImpressions",
            SUM(ap.link_clicks) as "totalClicks",
            SUM(ap.results) as "totalLeads"
          FROM ads_performance ap
          LEFT JOIN "Campaigns" c ON c."campaignId" = ap."campaignId"
          WHERE ap.company_id = ${companyId}
            AND ap."externalCampaignId" IS NOT NULL
            AND ap."campaignId" IS NOT NULL
          GROUP BY ap.campaign_name, ap."campaignId"
          ORDER BY MAX(ap.report_end_date) DESC NULLS LAST
        `
      }

      this.logger.log(`LinkedToOther campaigns found: ${linkedToOtherRaw.length}`)

      const available: MetaCampaignGroup[] = availableRaw.map(r => {
        const ids = r.externalCampaignIds.split(',')
        return {
          externalCampaignId: ids[0],
          externalCampaignIds: ids,
          campaignName: r.campaignName,
          totalRecords: Number(r.totalRecords),
          adSetsCount: Number(r.adSetsCount),
          adsCount: Number(r.adsCount),
          isLinked: false,
          linkedToCampaignId: null,
          firstDate: r.firstDate ? r.firstDate.toISOString().split('T')[0] : null,
          lastDate: r.lastDate ? r.lastDate.toISOString().split('T')[0] : null,
          totalSpent: r.totalSpent ? Number(r.totalSpent) : 0,
          totalImpressions: r.totalImpressions ? Number(r.totalImpressions) : 0,
          totalClicks: r.totalClicks ? Number(r.totalClicks) : 0,
          totalLeads: r.totalLeads ? Number(r.totalLeads) : 0,
          deliveryStatus: null,
          objective: null,
          accountName: null,
        }
      })

      const linked: MetaCampaignGroup[] = linkedRaw.map(r => {
        const ids = r.externalCampaignIds.split(',')
        return {
          externalCampaignId: ids[0],
          externalCampaignIds: ids,
          campaignName: r.campaignName,
          totalRecords: Number(r.totalRecords),
          adSetsCount: Number(r.adSetsCount),
          adsCount: Number(r.adsCount),
          isLinked: true,
          linkedToCampaignId: hdmCampaignId || null,
          firstDate: r.firstDate ? r.firstDate.toISOString().split('T')[0] : null,
          lastDate: r.lastDate ? r.lastDate.toISOString().split('T')[0] : null,
          totalSpent: r.totalSpent ? Number(r.totalSpent) : 0,
          totalImpressions: r.totalImpressions ? Number(r.totalImpressions) : 0,
          totalClicks: r.totalClicks ? Number(r.totalClicks) : 0,
          totalLeads: r.totalLeads ? Number(r.totalLeads) : 0,
          deliveryStatus: null,
          objective: null,
          accountName: null,
        }
      })

      const linkedToOther: MetaCampaignGroup[] = linkedToOtherRaw.map(r => {
        const ids = r.externalCampaignIds.split(',')
        return {
          externalCampaignId: ids[0],
          externalCampaignIds: ids,
          campaignName: r.campaignName,
          totalRecords: Number(r.totalRecords),
          adSetsCount: Number(r.adSetsCount),
          adsCount: Number(r.adsCount),
          isLinked: true,
          linkedToCampaignId: r.linkedCampaignId,
          linkedToCampaignName: r.linkedCampaignName,
          firstDate: r.firstDate ? r.firstDate.toISOString().split('T')[0] : null,
          lastDate: r.lastDate ? r.lastDate.toISOString().split('T')[0] : null,
          totalSpent: r.totalSpent ? Number(r.totalSpent) : 0,
          totalImpressions: r.totalImpressions ? Number(r.totalImpressions) : 0,
          totalClicks: r.totalClicks ? Number(r.totalClicks) : 0,
          totalLeads: r.totalLeads ? Number(r.totalLeads) : 0,
          deliveryStatus: null,
          objective: null,
          accountName: null,
        }
      })

      return { available, linked, linkedToOther }
    } catch (error) {
      this.logger.error(`Error fetching available campaigns: ${error.message}`, error.stack)
      throw error
    }
  }
}
