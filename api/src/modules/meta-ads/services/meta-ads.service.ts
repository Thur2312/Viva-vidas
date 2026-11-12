import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  Optional,
} from '@nestjs/common'
import { PrismaService } from 'src/database/prisma.service'
import { UserNotificationService } from 'src/modules/admin/notifications/user-notification.service'
import { getMetaAuthError } from 'src/shared/util/meta-auth-error.utils'
import {
  markMetaTokenInvalid,
  notifyMetaTokenInvalid,
  META_TOKEN_INVALID_MESSAGE,
  META_TOKEN_DECRYPT_FAILED_MESSAGE,
} from 'src/shared/util/meta-token-invalid.utils'
import { DatePreset, FetchMetaInsightsDto, SyncMetaInsightsDto, SyncBreakdownsDto } from '../dto/fetch-insights.dto'

// Strategies
import { InsightsSyncStrategy } from '../strategies/insights-sync.strategy'
import { AdsSyncStrategy } from '../strategies/ads-sync.strategy'
import { BreakdownSyncStrategy } from '../strategies/breakdown-sync.strategy'

// Mapper
import { MetaAdsMapper } from '../mappers/meta-ads.mapper'

// Auto-link
import { AdsPerformanceService } from '../../ads-performance/ads-performance.service'

// Interfaces
import {
  MetaInsightData,
  MetaCampaignInsight,
  MetaAdSetInsight,
  MetaCredentials,
  SyncResult,
  BreakdownSyncResult,
  MetaApiResponse,
} from '../interfaces/meta-ads.interfaces'

// Re-export interfaces for backward compatibility
export {
  MetaInsightData,
  MetaCampaignInsight,
  MetaAdSetInsight,
  SyncResult,
  BreakdownSyncResult,
} from '../interfaces/meta-ads.interfaces'

// Constants
import {
  META_API_BASE,
  META_API_VERSION,
  FULL_INSIGHTS_FIELDS,
  CAMPAIGN_INSIGHT_FIELDS,
  ADSET_INSIGHT_FIELDS,
  THUMBNAIL_KEY_SUFFIX,
  THUMBNAIL_STORAGE_PREFIX,
  THUMBNAIL_TARGET_PX,
} from '../constants/meta-ads.constants'
import { decryptIntegrationData, looksEncrypted } from 'src/shared/util/encryption.utils'
import { RedisService } from 'src/shared/redis/redis.service'
import { FileStorageService } from '../../files/storage/file-storage.service'
import { createHash } from 'crypto'
import { readImageWidth } from 'src/shared/util/image-dimensions.utils'

/**
 * Service principal para integracao com Meta ADS
 * Orquestra as diferentes estrategias de sincronizacao
 */
@Injectable()
export class MetaAdsService {
  private readonly logger = new Logger(MetaAdsService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly mapper: MetaAdsMapper,
    private readonly insightsStrategy: InsightsSyncStrategy,
    private readonly adsStrategy: AdsSyncStrategy,
    private readonly breakdownStrategy: BreakdownSyncStrategy,
    private readonly adsPerformanceService: AdsPerformanceService,
    private readonly redisService: RedisService,
    private readonly fileStorage: FileStorageService,
    // @Optional: os specs instanciam sem o notificador; sem ele o token invalido
    // ainda e marcado no banco, so nao gera a notificacao in-app.
    @Optional() private readonly userNotificationService?: UserNotificationService,
  ) {}

  /**
   * Busca as credenciais do Meta para uma empresa
   * Suporta dual-mode: OAuth (prioridade) e Manual (fallback)
   */
  async getMetaCredentials(companyId: string): Promise<MetaCredentials> {
    const integration = await this.prisma.integrations.findFirst({
      where: {
        companiesId: companyId,
        platform: {
          type: 'meta',
        },
        status: 'ACTIVE',
        deleted_at: null,
      },
      include: {
        platform: true,
      },
    })

    if (!integration || !integration.metaAccessToken) {
      throw new NotFoundException('Integracao Meta nao configurada para esta empresa')
    }

    // Token ja reconhecido como revogado: recusa ANTES de chamar a Meta. Sem isso, cada
    // disparo repetia as ~210 chamadas condenadas do incidente de 31/08. So reconexao
    // limpa o flag (clearMetaTokenInvalid) — nao ha o que reintentar aqui.
    // Nao usar Integrations.status: o findFirst acima filtra ACTIVE, e marcar INACTIVE
    // esconderia a integracao dele e do cron de refresh, travando a recuperacao.
    // 400, NUNCA 401: no HDM o 401 significa "sua sessao expirou". O interceptor do front
    // (hdm-web/src/lib/api.ts) dispara um POST /auth/refresh para cada 401, e um clique em
    // "Sincronizar" sao 5 requisicoes — 5 rotacoes de refresh token contra um limite de
    // 10/min. Qualquer falha desse refresh cai em handleLogout() e joga o usuario no login.
    if (integration.metaTokenInvalidAt) {
      throw new BadRequestException(META_TOKEN_INVALID_MESSAGE)
    }

    // Modo OAuth: validacoes adicionais
    if (integration.metaOAuthMethod === 'OAUTH') {
      if (integration.metaTokenExpiresAt && integration.metaTokenExpiresAt < new Date()) {
        throw new BadRequestException(
          'Token OAuth expirado. Reconecte sua conta Facebook em Integracoes > Meta Ads.'
        )
      }

      if (!integration.metaAppId) {
        throw new BadRequestException(
          'Ad Account nao selecionada. Selecione uma Ad Account em Integracoes > Meta Ads.'
        )
      }
    }

    // Modo Manual: validacao original
    if (integration.metaOAuthMethod !== 'OAUTH' && !integration.metaAppId) {
      throw new NotFoundException('Integracao Meta nao configurada para esta empresa')
    }

    const decrypted = decryptIntegrationData(integration)

    // decrypt() devolve a ENTRADA INTACTA quando a chave nao abre o dado (compat com linhas
    // antigas em texto puro) — mesmo guard do tracking-sender.service.ts:346. Sem ele o
    // ciphertext seguia como "sucesso" e ia para a Meta: a conta virava
    // `act_b25333ac…:4a98…` e a resposta era 190 "Cannot parse access token", que o
    // handleMetaAuthError lia como token revogado e marcava a integracao — pedindo uma
    // reconexao que nao cura nada, porque o problema e a ENCRYPTION_KEY, nao o token.
    //
    // Checa os DOIS campos: `act_<ciphertext>` ja e requisicao condenada antes do token.
    if (looksEncrypted(decrypted.metaAccessToken) || looksEncrypted(decrypted.metaAppId)) {
      throw new BadRequestException(META_TOKEN_DECRYPT_FAILED_MESSAGE)
    }

    return {
      adAccountId: decrypted.metaAppId.startsWith('act_')
        ? decrypted.metaAppId
        : `act_${decrypted.metaAppId}`,
      accessToken: decrypted.metaAccessToken,
      integrationId: integration.id,
    }
  }

  /**
   * Token morto no provedor (OAuthException 190/102 — troca de senha do Facebook e o
   * subcode 460): marca a integracao e notifica os gestores UMA vez, na transicao.
   *
   * Nao faz nada se o erro for outro — rate limit, 5xx e payload invalido nao sao token
   * morto e nao podem apagar a integracao de ninguem.
   *
   * Espelha `tracking-sender.service.ts` (CAPI) e o probe do `oauth/status`. Antes o sync
   * de Ads era o unico caminho Meta fora dessa maquina de estados: engolia o 190 chunk a
   * chunk, devolvia `errors: 0` e ainda carimbava `metaLastSync` como sync bem-sucedido.
   * O throw daqui e o que impede esse carimbo falso.
   */
  private async handleMetaAuthError(companyId: string, error: any): Promise<void> {
    const authError = getMetaAuthError(error)
    if (!authError) return

    this.logger.error(
      `Token Meta invalido (code ${authError.code}` +
        `${authError.subcode != null ? `/${authError.subcode}` : ''}) ` +
        `empresa ${companyId}: ${authError.message}`,
    )

    // "Cannot parse access token" e 190 SEM subcode: a Meta esta dizendo que o que chegou
    // nem parece um token. Isso e credencial local quebrada (ENCRYPTION_KEY divergente
    // fazendo o decrypt devolver ciphertext), nao revogacao. Revogado e 190/460 com
    // "session has been invalidated". Marcar aqui pediria reconexao que nao resolve e
    // bloquearia todo sync seguinte pela guarda do getMetaCredentials.
    if (/cannot parse access token/i.test(authError.message)) {
      throw new BadRequestException(META_TOKEN_DECRYPT_FAILED_MESSAGE)
    }

    const transicao = await markMetaTokenInvalid(this.prisma, companyId, authError.message)
    if (transicao) {
      await notifyMetaTokenInvalid(
        this.prisma,
        this.userNotificationService,
        companyId,
        authError.message,
      )
    }

    // 400 e nao 401 — ver a nota em getMetaCredentials.
    throw new BadRequestException(META_TOKEN_INVALID_MESSAGE)
  }

  /**
   * Sincroniza dados do Meta com a tabela AdsPerformance
   * Escolhe automaticamente a melhor estrategia baseado nos parametros
   */
  async syncInsightsToDatabase(dto: SyncMetaInsightsDto): Promise<SyncResult> {
    const { adAccountId, accessToken, integrationId } = await this.getMetaCredentials(dto.companyId)
    const level = dto.level || 'ad'
    const datePreset = dto.datePreset || DatePreset.LAST_7_DAYS

    this.logger.log(`=== META ADS SYNC REQUEST ===`)
    this.logger.log(`Company ID: ${dto.companyId}`)
    this.logger.log(`Level: ${level}`)
    this.logger.log(`Date Preset: ${datePreset}`)
    this.logger.log(`Time Increment: ${dto.timeIncrement || 'all_days'}`)

    try {
      // Sempre usa /insights (flat records, paginacao eficiente)
      // - Queries pesadas (ad + daily) usam ESSENTIAL_INSIGHT_FIELDS (~40 campos)
      // - Queries leves usam FULL_INSIGHTS_FIELDS (100+ campos)
      // O endpoint /ads com insights aninhados causa erro 99 em contas grandes
      this.logger.log(`Usando estrategia /insights`)
      const result = await this.insightsStrategy.sync(
        dto.companyId,
        adAccountId,
        accessToken,
        datePreset,
        {
          level,
          timeIncrement: dto.timeIncrement,
          actionAttributionWindows: dto.actionAttributionWindows,
          breakdowns: dto.breakdowns,
          actionBreakdowns: dto.actionBreakdowns,
          actionReportTime: dto.actionReportTime,
          filtering: dto.filtering,
          sort: dto.sort,
          useAccountAttributionSetting: dto.useAccountAttributionSetting,
          useUnifiedAttributionSetting: dto.useUnifiedAttributionSetting,
        }
      )

      // Auto-vincula registros novos a campanhas HDM ja vinculadas
      try {
        const autoLinked = await this.adsPerformanceService.autoLinkNewRecords(dto.companyId)
        if (autoLinked > 0) {
          this.logger.log(`Auto-link pos-sync: ${autoLinked} registros vinculados automaticamente`)
        }
      } catch (error) {
        // error, nao warn: sem auto-link todo registro novo fica orfao e some do
        // dashboard. Falhar aqui nao pode quebrar o sync, mas tem que ser visivel.
        this.logger.error(
          `Erro no auto-link pos-sync (code=${error.code ?? 'n/a'}): ${error.message}`,
          error.stack,
        )
      }

      // Re-hospeda thumbnails de CDN da Meta (URLs assinadas que expiram) em storage permanente
      // (files.hdmfy.com). Re-busca uma URL fresca por ad antes de baixar (a do banco pode ter vencido).
      await this.persistThumbnailsToStorage(dto.companyId, accessToken)

      // Atualiza adsLastUpdatedAt em todas as campanhas HDM que tem ads vinculados
      await this.updateCampaignsAdsLastUpdated(dto.companyId)

      // Marca o ultimo sync bem-sucedido tambem no caminho MANUAL. Antes so o cron
      // (meta-ads-cron.service.ts) gravava metaLastSync, entao quem sincronizava pela
      // UI ficava com "ultimo sync" vazio/velho na tela de Integracoes.
      // Fica ANTES do delByPattern abaixo para que a invalidacao de cache cubra tudo.
      try {
        await this.prisma.client.integrations.update({
          where: { id: integrationId },
          data: { metaLastSync: new Date() },
        })
        await this.redisService.del(`lookup:meta-integration:${dto.companyId}`)
      } catch (err) {
        this.logger.warn(`Falha ao atualizar metaLastSync: ${err.message}`)
      }

      // Invalida cache do dashboard de marketing para que próximo request traga dados frescos
      try {
        const company = await this.prisma.client.companies.findFirst({
          where: { id: dto.companyId },
          select: { subdomain: true },
        })
        if (company?.subdomain) {
          const deleted = await this.redisService.delByPattern(`dashboard:ads:*:${company.subdomain}:*`)
          if (deleted > 0) {
            this.logger.log(`Cache invalidado: ${deleted} keys para subdomain ${company.subdomain}`)
          }
        }
      } catch (err) {
        this.logger.warn(`Falha ao invalidar cache de ads: ${err.message}`)
      }

      return result
    } catch (error) {
      this.logger.error(`Erro na sincronizacao: ${error.message}`)

      await this.handleMetaAuthError(dto.companyId, error)

      if (error.name === 'AbortError') {
        throw new BadRequestException(
          'Timeout na requisicao. Tente reduzir o periodo ou usar granularidade "Periodo completo".'
        )
      }

      throw error
    }
  }

  /**
   * Torna permanentes as thumbnails de anuncios que ainda apontam para um CDN da Meta
   * (fbcdn/cdninstagram: URLs assinadas que EXPIRAM -> 403). A URL gravada no banco pode ja
   * estar vencida, entao NAO baixamos a URL do banco: re-buscamos uma URL FRESCA do criativo
   * na Meta (por ad_id, em lotes de 50), baixamos essa e a re-hospedamos no storage permanente
   * (MinIO/S3 -> files.hdmfy.com). Assim o re-host nao depende de enrichThumbnails ter rodado
   * antes nem do nivel do sync. Nao bloqueia o sync (falhas sao logadas e re-tentadas depois).
   */
  private async persistThumbnailsToStorage(companyId: string, accessToken: string): Promise<number> {
    try {
      // Anuncios cuja thumbnail ainda aponta para um CDN da Meta (nao-permanente).
      const ads = await this.prisma.$queryRawUnsafe<{ adId: string }[]>(`
        SELECT DISTINCT ad_id AS "adId"
        FROM ads_performance
        WHERE company_id = $1
          AND ad_id IS NOT NULL AND ad_id != ''
          AND (thumbnail_url LIKE '%fbcdn.net%' OR thumbnail_url LIKE '%cdninstagram.com%')
      `, companyId)

      if (ads.length === 0) return 0

      this.logger.log(`=== FASE STORAGE THUMBNAILS: ${ads.length} anuncios com thumbnail de CDN para re-hospedar ===`)

      const CHUNK_SIZE = 50
      let converted = 0

      for (let i = 0; i < ads.length; i += CHUNK_SIZE) {
        const chunk = ads.slice(i, i + CHUNK_SIZE)

        // Re-busca uma URL FRESCA do criativo (a do banco pode estar vencida). Lote -> 1 request.
        // thumbnail_width/height sao obrigatorios aqui pelo mesmo motivo de enrichThumbnails:
        // sem eles o espelho no bucket congela a versao de 64x64 e nunca mais melhora.
        const params = new URLSearchParams({
          ids: chunk.map(a => a.adId).join(','),
          fields: 'creative{image_url,thumbnail_url}',
          thumbnail_width: String(THUMBNAIL_TARGET_PX),
          thumbnail_height: String(THUMBNAIL_TARGET_PX),
          access_token: accessToken,
        })

        let data: any
        try {
          const res = await fetch(`${META_API_BASE}/${META_API_VERSION}/?${params.toString()}`)
          data = await res.json()
        } catch (err) {
          this.logger.warn(`Falha ao buscar criativos frescos: ${err.message}. Pulando lote.`)
          continue
        }
        if (data?.error) {
          this.logger.warn(`Erro ao buscar criativos frescos: ${data.error.message}. Pulando lote.`)
          continue
        }

        for (const { adId } of chunk) {
          try {
            const adData = data[adId]
            if (adData?.error) continue

            const freshUrl = adData?.creative?.image_url ?? adData?.creative?.thumbnail_url ?? null
            if (!freshUrl) continue

            const res = await fetch(freshUrl)
            if (!res.ok) {
              this.logger.warn(`Thumbnail fresca do ad ${adId} retornou ${res.status}, pulando (re-tenta no proximo sync)`)
              continue
            }

            const buffer = Buffer.from(await res.arrayBuffer())
            const contentType = res.headers.get('content-type') || 'image/jpeg'
            const ext = contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : 'jpg'
            // Key deterministica pela path da URL (sem a query assinada) -> mesmo criativo reusa o objeto.
            // O sufixo de tamanho faz parte da chave de proposito: e o que permite a
            // enrichThumbnails reconhecer um espelho antigo (pequeno) e reprocessa-lo.
            // O sufixo carrega a largura MEDIDA nos bytes, nao a pedida. Antes vinha de
            // THUMBNAIL_KEY_SUFFIX (derivado de THUMBNAIL_TARGET_PX), ou seja: do que
            // pedimos a Meta. Quando ela devolvia um criativo pequeno — o que acontece
            // sempre que a cadeia de resolucao cai em `image_url`, que nao aceita
            // `thumbnail_width` — um arquivo de 64px era gravado como `-1080.jpg` e
            // passava a ser invisivel para TODOS os guards de reprocessamento. Ficava
            // borrado para sempre, e nenhum sync conseguia mais alcanca-lo.
            const larguraReal = readImageWidth(buffer)
            const pathHash = createHash('sha1').update(freshUrl.split('?')[0]).digest('hex')
            const basename = `${pathHash}-${larguraReal ?? 0}.${ext}`
            const key = `${THUMBNAIL_STORAGE_PREFIX}/${basename}`

            const { url: cdnUrl } = await this.fileStorage.upload({
              buffer,
              originalName: basename,
              contentType,
              key,
              size: buffer.length,
            })

            // Converte TODAS as linhas desse ad que ainda apontam para um CDN da Meta.
            await this.prisma.$executeRawUnsafe(
              `UPDATE ads_performance SET thumbnail_url = $1
               WHERE company_id = $2 AND ad_id = $3
                 AND (thumbnail_url LIKE '%fbcdn.net%' OR thumbnail_url LIKE '%cdninstagram.com%')`,
              cdnUrl, companyId, adId,
            )
            converted++
          } catch (err) {
            this.logger.warn(`Falha ao re-hospedar thumbnail do ad ${adId}: ${err.message}`)
          }
        }
      }

      this.logger.log(`Thumbnails re-hospedadas: ${converted}/${ads.length} anuncios`)
      return converted
    } catch (error) {
      this.logger.warn(`Erro na fase de storage de thumbnails: ${error.message}. Continuando.`)
      return 0
    }
  }

  /**
   * Sincroniza breakdowns do Meta para a tabela AdsBreakdownPerformance
   */
  async syncBreakdownsToDatabase(dto: SyncBreakdownsDto): Promise<BreakdownSyncResult> {
    const { adAccountId, accessToken } = await this.getMetaCredentials(dto.companyId)
    const datePreset = dto.datePreset || DatePreset.THIS_MONTH

    this.logger.log(`=== META ADS BREAKDOWNS SYNC REQUEST ===`)
    this.logger.log(`Company ID: ${dto.companyId}`)
    this.logger.log(`Date Preset: ${datePreset}`)

    try {
      return await this.breakdownStrategy.syncBreakdowns(
        dto.companyId,
        adAccountId,
        accessToken,
        datePreset,
      )
    } catch (error) {
      this.logger.error(`Erro na sincronizacao de breakdowns: ${error.message}`)

      await this.handleMetaAuthError(dto.companyId, error)

      if (error.name === 'AbortError') {
        throw new BadRequestException(
          'Timeout na requisicao de breakdowns. Tente reduzir o periodo.'
        )
      }

      throw error
    }
  }

  /**
   * Busca insights do Meta Graph API em tempo real (sem salvar no banco)
   */
  async fetchInsights(dto: FetchMetaInsightsDto): Promise<MetaInsightData[]> {
    const { adAccountId, accessToken } = await this.getMetaCredentials(dto.companyId)

    const fields = FULL_INSIGHTS_FIELDS.join(',')

    const params = new URLSearchParams({
      level: 'ad',
      fields,
      access_token: accessToken,
    })

    if (dto.startDate && dto.endDate) {
      params.append('time_range', JSON.stringify({
        since: dto.startDate,
        until: dto.endDate,
      }))
    } else if (dto.datePreset) {
      params.append('date_preset', dto.datePreset)
    } else {
      params.append('date_preset', DatePreset.LAST_7_DAYS)
    }

    const url = `${META_API_BASE}/${META_API_VERSION}/${adAccountId}/insights?${params.toString()}`

    this.logger.log(`Fetching insights from Meta API...`)

    const response = await fetch(url)
    const result: MetaApiResponse = await response.json()

    if (result.error) {
      throw new BadRequestException(`Erro na API do Meta: ${result.error.message}`)
    }

    // Processa os dados para extrair leads das actions
    return result.data.map(item => {
      const leads = this.mapper.extractLeads(item.actions)
      return {
        ...item,
        leads,
        cpl: leads > 0 && parseFloat(item.spend) > 0
          ? (parseFloat(item.spend) / leads).toFixed(2)
          : '0.00',
      }
    })
  }

  /**
   * Busca insights agrupados por campanha
   */
  async fetchInsightsByCampaign(dto: FetchMetaInsightsDto): Promise<MetaCampaignInsight[]> {
    const { adAccountId, accessToken } = await this.getMetaCredentials(dto.companyId)

    const params = new URLSearchParams({
      level: 'campaign',
      fields: CAMPAIGN_INSIGHT_FIELDS.join(','),
      access_token: accessToken,
      date_preset: dto.datePreset || DatePreset.LAST_7_DAYS,
    })

    const url = `${META_API_BASE}/${META_API_VERSION}/${adAccountId}/insights?${params.toString()}`

    const response = await fetch(url)
    const result: MetaApiResponse = await response.json()

    if (result.error) {
      throw new BadRequestException(`Erro na API do Meta: ${result.error.message}`)
    }

    // Log detalhado dos campos recebidos
    if (result.data.length > 0) {
      this.logReceivedFields('CAMPAIGN', result.data[0], CAMPAIGN_INSIGHT_FIELDS)
    }

    return result.data.map(item => this.mapInsightToResponse(item))
  }

  /**
   * Busca insights agrupados por conjunto de anuncios (adset)
   */
  async fetchInsightsByAdSet(dto: FetchMetaInsightsDto): Promise<MetaAdSetInsight[]> {
    const { adAccountId, accessToken } = await this.getMetaCredentials(dto.companyId)

    const params = new URLSearchParams({
      level: 'adset',
      fields: ADSET_INSIGHT_FIELDS.join(','),
      access_token: accessToken,
      date_preset: dto.datePreset || DatePreset.LAST_7_DAYS,
    })

    const url = `${META_API_BASE}/${META_API_VERSION}/${adAccountId}/insights?${params.toString()}`

    const response = await fetch(url)
    const result: MetaApiResponse = await response.json()

    if (result.error) {
      throw new BadRequestException(`Erro na API do Meta: ${result.error.message}`)
    }

    // Log detalhado dos campos recebidos
    if (result.data.length > 0) {
      this.logReceivedFields('ADSET', result.data[0], ADSET_INSIGHT_FIELDS)
    }

    return result.data.map(item => ({
      ...this.mapInsightToResponse(item),
      adSetName: item.adset_name,
      adSetId: item.adset_id,
    }))
  }

  /**
   * Mapeia um insight da API para o formato de resposta (tempo real, sem salvar)
   * Inclui todos os campos v24.0
   */
  private mapInsightToResponse(item: any): any {
    const leads = this.mapper.extractLeads(item.actions)
    const spend = parseFloat(item.spend || '0')

    return {
      campaignName: item.campaign_name,
      campaignId: item.campaign_id,
      accountCurrency: item.account_currency || null,
      objective: item.objective || null,
      optimizationGoal: item.optimization_goal || null,
      buyingType: item.buying_type || null,
      attributionSetting: item.attribution_setting || null,
      createdTime: item.created_time || null,
      updatedTime: item.updated_time || null,
      spend,
      impressions: parseInt(item.impressions || '0'),
      reach: parseInt(item.reach || '0'),
      frequency: parseFloat(item.frequency || '0'),
      frequencyValue: item.frequency_value || null,
      clicks: parseInt(item.clicks || '0'),
      uniqueClicks: parseInt(item.unique_clicks || '0'),
      ctr: parseFloat(item.ctr || '0'),
      uniqueCtr: parseFloat(item.unique_ctr || '0'),
      cpm: parseFloat(item.cpm || '0'),
      cpc: parseFloat(item.cpc || '0'),
      cpp: parseFloat(item.cpp || '0'),
      costPerInlineLinkClick: parseFloat(item.cost_per_inline_link_click || '0'),
      costPerInlinePostEngagement: parseFloat(item.cost_per_inline_post_engagement || '0'),
      costPerUniqueClick: parseFloat(item.cost_per_unique_click || '0'),
      costPerUniqueInlineLinkClick: parseFloat(item.cost_per_unique_inline_link_click || '0'),
      costPerThruplay: item.cost_per_thruplay || null,
      costPerOutboundClick: item.cost_per_outbound_click || null,
      costPerUniqueOutboundClick: item.cost_per_unique_outbound_click || null,
      costPerAdClick: item.cost_per_ad_click || null,
      costPer15SecVideoView: item.cost_per_15_sec_video_view || null,
      costPer2SecContinuousVideoView: item.cost_per_2_sec_continuous_video_view || null,
      costPerOneThousandAdImpression: item.cost_per_one_thousand_ad_impression || null,
      costPerDdaCountbyConvs: parseFloat(item.cost_per_dda_countby_convs || '0'),
      costPerObjectiveResult: item.cost_per_objective_result || null,
      costPerResult: item.cost_per_result || null,
      inlinePostEngagement: parseInt(item.inline_post_engagement || '0'),
      uniqueInlineLinkClicks: parseInt(item.unique_inline_link_clicks || '0'),
      inlineLinkClickCtr: parseFloat(item.inline_link_click_ctr || '0'),
      uniqueLinkClicksCtr: parseFloat(item.unique_link_clicks_ctr || '0'),
      outboundClicks: item.outbound_clicks || null,
      uniqueOutboundClicks: item.unique_outbound_clicks || null,
      outboundClicksCtr: item.outbound_clicks_ctr || null,
      uniqueOutboundClicksCtr: item.unique_outbound_clicks_ctr || null,
      websiteCtr: item.website_ctr || null,
      fullViewImpressions: parseInt(item.full_view_impressions || '0'),
      fullViewReach: parseInt(item.full_view_reach || '0'),
      leads,
      cpl: leads > 0 ? (spend / leads).toFixed(2) : '0.00',
      videoPlays: item.video_play_actions?.[0]?.value ? parseInt(item.video_play_actions[0].value) : 0,
      videoViews25: item.video_p25_watched_actions?.[0]?.value ? parseInt(item.video_p25_watched_actions[0].value) : 0,
      videoViews50: item.video_p50_watched_actions?.[0]?.value ? parseInt(item.video_p50_watched_actions[0].value) : 0,
      videoViews75: item.video_p75_watched_actions?.[0]?.value ? parseInt(item.video_p75_watched_actions[0].value) : 0,
      videoViews95: item.video_p95_watched_actions?.[0]?.value ? parseInt(item.video_p95_watched_actions[0].value) : 0,
      videoViews100: item.video_p100_watched_actions?.[0]?.value ? parseInt(item.video_p100_watched_actions[0].value) : 0,
      video30SecWatched: item.video_30_sec_watched_actions?.[0]?.value ? parseInt(item.video_30_sec_watched_actions[0].value) : 0,
      videoAvgTimeWatched: item.video_avg_time_watched_actions?.[0]?.value ? parseFloat(item.video_avg_time_watched_actions[0].value) : 0,
      videoThruplayWatched: item.video_thruplay_watched_actions?.[0]?.value ? parseInt(item.video_thruplay_watched_actions[0].value) : 0,
      videoContinuous2SecWatched: item.video_continuous_2_sec_watched_actions || null,
      videoTimeWatched: item.video_time_watched_actions || null,
      videoPlayCurveActions: item.video_play_curve_actions || null,
      videoPlayRetention0To15s: item.video_play_retention_0_to_15s_actions || null,
      videoPlayRetention20To60s: item.video_play_retention_20_to_60s_actions || null,
      videoPlayRetentionGraph: item.video_play_retention_graph_actions || null,
      socialSpend: parseFloat(item.social_spend || '0'),
      qualityRanking: item.quality_ranking || null,
      engagementRateRanking: item.engagement_rate_ranking || null,
      conversionRateRanking: item.conversion_rate_ranking || null,
      actions: item.actions || null,
      actionValues: item.action_values || null,
      adClickActions: item.ad_click_actions || null,
      adImpressionActions: item.ad_impression_actions || null,
      uniqueActions: item.unique_actions || null,
      conversions: item.conversions || null,
      conversionValues: item.conversion_values || null,
      uniqueConversions: item.unique_conversions || null,
      costPerActionType: item.cost_per_action_type || null,
      costPerConversion: item.cost_per_conversion || null,
      costPerUniqueActionType: item.cost_per_unique_action_type || null,
      costPerUniqueConversion: item.cost_per_unique_conversion || null,
      purchaseRoas: item.purchase_roas || null,
      websitePurchaseRoas: item.website_purchase_roas || null,
      mobileAppPurchaseRoas: item.mobile_app_purchase_roas || null,
      canvasAvgViewPercent: parseFloat(item.canvas_avg_view_percent || '0'),
      canvasAvgViewTime: parseFloat(item.canvas_avg_view_time || '0'),
      instantExperienceClicksToOpen: parseInt(item.instant_experience_clicks_to_open || '0'),
      instantExperienceClicksToStart: parseInt(item.instant_experience_clicks_to_start || '0'),
      instantExperienceOutboundClicks: item.instant_experience_outbound_clicks || null,
      estimatedAdRecallRate: parseFloat(item.estimated_ad_recall_rate || '0'),
      estimatedAdRecallers: parseInt(item.estimated_ad_recallers || '0'),
      catalogSegmentValue: item.catalog_segment_value || null,
      catalogSegmentActions: item.catalog_segment_actions || null,
      catalogSegmentValueMobilePurchaseRoas: item.catalog_segment_value_mobile_purchase_roas || null,
      catalogSegmentValueOmniPurchaseRoas: item.catalog_segment_value_omni_purchase_roas || null,
      catalogSegmentValueWebsitePurchaseRoas: item.catalog_segment_value_website_purchase_roas || null,
      objectiveResults: item.objective_results || null,
      objectiveResultRate: item.objective_result_rate || null,
      resultRate: item.result_rate || null,
      resultValuesPerformanceIndicator: item.result_values_performance_indicator || null,
      ddaCountbyConvs: parseFloat(item.dda_countby_convs || '0'),
      ddaResults: item.dda_results || null,
      interactiveComponentTap: item.interactive_component_tap || null,
      instagramUpcomingEventRemindersSet: parseInt(item.instagram_upcoming_event_reminders_set || '0'),
      landingPageViewPerLinkClick: parseFloat(item.landing_page_view_per_link_click || '0'),
      purchasePerLandingPageView: parseFloat(item.purchase_per_landing_page_view || '0'),
      marketingMessagesDelivered: parseInt(item.marketing_messages_delivered || '0'),
      marketingMessagesDeliveryRate: parseFloat(item.marketing_messages_delivery_rate || '0'),
      marketingMessagesReadRateBenchmark: item.marketing_messages_read_rate_benchmark || null,
      auctionBid: parseFloat(item.auction_bid || '0'),
      auctionCompetitiveness: parseFloat(item.auction_competitiveness || '0'),
      auctionMaxCompetitorBid: parseFloat(item.auction_max_competitor_bid || '0'),
      wishBid: parseFloat(item.wish_bid || '0'),
      qualifyingQuestionQualifyAnswerRate: parseFloat(item.qualifying_question_qualify_answer_rate || '0'),
      shopsAssistedPurchases: item.shops_assisted_purchases || null,
      totalCardView: item.total_card_view || null,
      anchorEventAttributionSetting: item.anchor_event_attribution_setting || null,
      anchorEventsPerformanceIndicator: item.anchor_events_performance_indicator || null,
      multiEventConversionAttributionSetting: item.multi_event_conversion_attribution_setting || null,
    }
  }

  /**
   * Busca thumbnails dos anuncios via Meta Graph API
   * Retorna mapa { adId: thumbnailUrl }
   * Usa image_url (imagem) com fallback para thumbnail_url (video)
   */
  async getAdThumbnails(companyId: string, adIds: string[]): Promise<Record<string, string | null>> {
    if (!adIds.length) return {}

    try {
      const { accessToken } = await this.getMetaCredentials(companyId)
      const result: Record<string, string | null> = {}

      // Chunka em lotes de 50 IDs (limite da Meta API)
      const CHUNK_SIZE = 50
      for (let i = 0; i < adIds.length; i += CHUNK_SIZE) {
        const chunk = adIds.slice(i, i + CHUNK_SIZE)
        const ids = chunk.join(',')

        const params = new URLSearchParams({
          ids,
          fields: 'creative{image_url,thumbnail_url}',
          access_token: accessToken,
        })

        const url = `${META_API_BASE}/${META_API_VERSION}/?${params.toString()}`

        this.logger.log(`Buscando thumbnails para ${chunk.length} ads...`)

        const response = await fetch(url)
        const data = await response.json()

        if (data.error) {
          this.logger.warn(`Erro ao buscar thumbnails: ${data.error.message}`)
          chunk.forEach(id => { result[id] = null })
          continue
        }

        for (const adId of chunk) {
          const adData = data[adId]
          if (adData?.error) {
            this.logger.warn(`Erro no ad ${adId}: ${adData.error.message}`)
            result[adId] = null
            continue
          }
          // Prioriza image_url (imagem) e faz fallback para thumbnail_url (video)
          result[adId] = adData?.creative?.image_url
            ?? adData?.creative?.thumbnail_url
            ?? null
        }
      }

      this.logger.log(`Thumbnails encontradas: ${Object.values(result).filter(Boolean).length}/${adIds.length}`)
      return result
    } catch (error) {
      this.logger.error(`Erro ao buscar thumbnails: ${error.message}`)
      return {}
    }
  }

  /**
   * Log detalhado dos campos recebidos da API Meta
   */
  private logReceivedFields(level: string, firstItem: any, requestedFields: string[]) {
    this.logger.log(`=== [${level}] PRIMEIRO REGISTRO RAW DA API META ===`)
    this.logger.log(JSON.stringify(firstItem, null, 2))

    const camposRecebidos = new Set(Object.keys(firstItem))
    this.logger.log(`=== [${level}] CAMPOS RETORNADOS: ${camposRecebidos.size} ===`)
    this.logger.log(`Campos: ${Array.from(camposRecebidos).join(', ')}`)

    const camposNaoRetornados = requestedFields.filter(c => !camposRecebidos.has(c))
    const camposVazios = Array.from(camposRecebidos).filter(c =>
      firstItem[c] === null || firstItem[c] === undefined || firstItem[c] === ''
    )

    if (camposNaoRetornados.length > 0) {
      this.logger.warn(`=== [${level}] CAMPOS PEDIDOS MAS NAO RETORNADOS (${camposNaoRetornados.length}): ${camposNaoRetornados.join(', ')}`)
    }
    if (camposVazios.length > 0) {
      this.logger.warn(`=== [${level}] CAMPOS RETORNADOS MAS VAZIOS/NULL (${camposVazios.length}): ${camposVazios.join(', ')}`)
    }
  }

  /**
   * Atualiza adsLastUpdatedAt em todas as campanhas HDM que possuem
   * registros vinculados na tabela ads_performance.
   */
  private async updateCampaignsAdsLastUpdated(companyId: string): Promise<void> {
    try {
      await this.prisma.$executeRaw`
        UPDATE "Campaigns"
        SET "ads_last_updated_at" = NOW()
        WHERE "campaignId" IN (
          SELECT DISTINCT "campaignId"
          FROM ads_performance
          WHERE company_id = ${companyId}
            AND "campaignId" IS NOT NULL
        )
      `
    } catch (error) {
      this.logger.warn(`Erro ao atualizar adsLastUpdatedAt das campanhas: ${error.message}`)
    }
  }
}
