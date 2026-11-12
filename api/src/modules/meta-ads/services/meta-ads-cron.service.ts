import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { Cron, CronExpression, SchedulerRegistry } from '@nestjs/schedule'
import { PrismaService } from 'src/database/prisma.service'
import { MetaAdsService } from './meta-ads.service'
import { MetaAdsOAuthService } from './meta-ads-oauth.service'
import { CronJob } from 'cron'
import { DatePreset } from '../dto/fetch-insights.dto'
import { shouldRunCron } from 'src/shared/util/cron-worker.util'
import { RedisService } from 'src/shared/redis/redis.service'
import { CompanyStatusService } from 'src/shared/services/company-status.service'

interface CronIntegration {
  id: number
  companiesId: string
  metaCronInterval: number
  metaLastSync: Date | null
}

@Injectable()
export class MetaAdsCronService implements OnModuleInit {
  private readonly logger = new Logger(MetaAdsCronService.name)
  private activeCronJobs: Map<number, CronJob> = new Map()

  constructor(
    private prisma: PrismaService,
    private metaAdsService: MetaAdsService,
    private metaAdsOAuthService: MetaAdsOAuthService,
    private schedulerRegistry: SchedulerRegistry,
    private redis: RedisService,
    private companyStatus: CompanyStatusService,
  ) {}

  async onModuleInit() {
    if (!shouldRunCron('meta-ads-sync')) return
    this.logger.log('Inicializando cron jobs do Meta ADS...')
    await this.initializeCronJobs()
  }

  /**
   * Inicializa todos os cron jobs ativos no banco de dados
   */
  async initializeCronJobs() {
    const integrations = await this.prisma.integrations.findMany({
      where: {
        metaCronEnabled: true,
        deleted_at: null,
        // Empresa desativada nao tem job registrado. Este filtro so vale no boot;
        // a guarda que importa em runtime esta no executeSyncJob, porque desativar
        // uma empresa nao reinicia o processo.
        company: { status: 'ACTIVE', deleted_at: null },
        platform: {
          type: 'meta',
        },
      },
      select: {
        id: true,
        companiesId: true,
        metaCronInterval: true,
        metaLastSync: true,
      },
    })

    this.logger.log(`Encontradas ${integrations.length} integracoes Meta com cron ativo`)

    for (const integration of integrations) {
      await this.registerCronJob(integration)
    }
  }

  /**
   * Registra um cron job para uma integracao especifica
   */
  async registerCronJob(integration: CronIntegration) {
    if (!shouldRunCron('meta-ads-sync')) return
    const jobName = `meta-sync-${integration.id}`
    const interval = integration.metaCronInterval || 24

    // Remove job existente se houver
    if (this.activeCronJobs.has(integration.id)) {
      this.removeCronJob(integration.id)
    }

    // Cria a expressao cron baseada no intervalo (em horas)
    const cronExpression = this.getCronExpression(interval)

    const job = new CronJob(cronExpression, async () => {
      await this.executeSyncJob(integration.id, integration.companiesId)
    })

    this.schedulerRegistry.addCronJob(jobName, job)
    job.start()
    this.activeCronJobs.set(integration.id, job)

    this.logger.log(`Cron job registrado: ${jobName} (intervalo: ${interval}h)`)
  }

  /**
   * Remove um cron job existente
   */
  removeCronJob(integrationId: number) {
    const jobName = `meta-sync-${integrationId}`

    if (this.activeCronJobs.has(integrationId)) {
      try {
        const job = this.activeCronJobs.get(integrationId)
        job?.stop()
        this.schedulerRegistry.deleteCronJob(jobName)
        this.activeCronJobs.delete(integrationId)
        this.logger.log(`Cron job removido: ${jobName}`)
      } catch (error) {
        this.logger.warn(`Erro ao remover cron job ${jobName}: ${error.message}`)
      }
    }
  }

  /**
   * Converte intervalo em horas para expressao cron
   */
  private getCronExpression(intervalHours: number): string {
    switch (intervalHours) {
      case 1:
        return CronExpression.EVERY_HOUR
      case 2:
        return CronExpression.EVERY_2_HOURS
      case 3:
        return CronExpression.EVERY_3_HOURS
      case 5:
        return '0 */5 * * *' // A cada 5 horas
      case 12:
        return CronExpression.EVERY_12_HOURS
      case 24:
      default:
        return CronExpression.EVERY_DAY_AT_6AM
    }
  }

  /**
   * Executa a sincronizacao para uma integracao
   */
  async executeSyncJob(integrationId: number, companyId: string) {
    // Job ja registrado continua agendado depois de a empresa ser desativada — o
    // registro so e refeito no boot. Sem esta guarda, o sync do Meta Ads seguiria
    // rodando (e consumindo cota da API) por dias em nome de uma empresa desligada.
    if (!(await this.companyStatus.isActive(companyId))) {
      this.logger.warn(`Sync ignorado: empresa ${companyId} está inativa`)
      this.removeCronJob(integrationId)
      return
    }

    this.logger.log(`Executando sync para integracao ${integrationId} (empresa: ${companyId})`)

    try {
      const result = await this.metaAdsService.syncInsightsToDatabase({
        companyId,
        datePreset: DatePreset.LAST_7_DAYS,
      })

      // Atualiza timestamp do ultimo sync
      await this.prisma.integrations.update({
        where: { id: integrationId },
        data: { metaLastSync: new Date() },
      })

      this.logger.log(`Sync concluido: ${result.synced} registros, ${result.errors} erros`)
      return result
    } catch (error) {
      this.logger.error(`Erro no sync da integracao ${integrationId}: ${error.message}`)
      throw error
    }
  }

  /**
   * Atualiza configuracoes do cron job
   */
  async updateCronSettings(
    integrationId: number,
    enabled: boolean,
    interval: number,
  ) {
    const integration = await this.prisma.integrations.update({
      where: { id: integrationId },
      data: {
        metaCronEnabled: enabled,
        metaCronInterval: interval,
      },
      select: {
        id: true,
        companiesId: true,
        metaCronInterval: true,
        metaLastSync: true,
      },
    })

    if (enabled) {
      await this.registerCronJob(integration)
      this.logger.log(`Cron ativado para integracao ${integrationId} (intervalo: ${interval}h)`)
    } else {
      this.removeCronJob(integrationId)
      this.logger.log(`Cron desativado para integracao ${integrationId}`)
    }

    return integration
  }

  /**
   * Retorna status do cron job
   */
  getCronStatus(integrationId: number) {
    const isActive = this.activeCronJobs.has(integrationId)
    const job = this.activeCronJobs.get(integrationId)

    return {
      active: isActive,
      nextExecution: job ? job.nextDate().toJSDate() : null,
    }
  }

  /**
   * Executa sync manual (fora do cron)
   */
  async executeManualSync(integrationId: number) {
    const integration = await this.prisma.integrations.findUnique({
      where: { id: integrationId },
      select: {
        id: true,
        companiesId: true,
      },
    })

    if (!integration) {
      throw new Error('Integracao nao encontrada')
    }

    return this.executeSyncJob(integration.id, integration.companiesId)
  }

  /**
   * Cron diario (3h) - Refresh de tokens OAuth proximos de expirar
   */
  @Cron('0 3 * * *', { name: 'meta-oauth-token-refresh' })
  async handleTokenRefreshCron() {
    if (!shouldRunCron('meta-token-refresh')) return
    const locked = await this.redis.tryAcquireLock('cron:meta-token-refresh', 3500)
    if (!locked) return
    this.logger.log('Iniciando refresh de tokens OAuth Meta...')

    const sevenDaysFromNow = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)

    const integrations = await this.prisma.integrations.findMany({
      where: {
        metaOAuthMethod: 'OAUTH',
        metaTokenExpiresAt: { lt: sevenDaysFromNow },
        deleted_at: null,
        status: 'ACTIVE',
      },
      select: { id: true },
    })

    this.logger.log(`${integrations.length} tokens OAuth precisam de refresh`)

    let refreshed = 0
    let failed = 0

    for (const integration of integrations) {
      try {
        const success = await this.metaAdsOAuthService.refreshTokenIfNeeded(integration.id)
        if (success) refreshed++
      } catch (error) {
        failed++
        this.logger.error(`Erro ao refresh token da integracao ${integration.id}: ${error.message}`)
      }
    }

    this.logger.log(`Token refresh concluido: ${refreshed} refreshed, ${failed} falhas`)
  }

  /**
   * Cron diario (3h30) - Sonda os tokens Meta ativos contra /me.
   *
   * 3h30 e nao 3h de proposito: roda DEPOIS do `meta-oauth-token-refresh`, para nao sondar
   * um token que o refresh esta trocando no mesmo minuto.
   *
   * Sem isto, token revogado (190/460, troca de senha do Facebook) so era descoberto se o
   * CAPI enviasse conversao, se o Dataset Quality rodasse ou se alguem abrisse a tela de
   * Integracoes. Tenant que so usa Meta Ads ficava morto em silencio.
   */
  @Cron('30 3 * * *', { name: 'meta-token-probe' })
  async handleTokenProbeCron() {
    if (!shouldRunCron('meta-token-probe')) return
    const locked = await this.redis.tryAcquireLock('cron:meta-token-probe', 3500)
    if (!locked) return

    this.logger.log('Sondando tokens Meta ativos...')

    try {
      const { probed } = await this.metaAdsOAuthService.probeAllActiveTokens()
      this.logger.log(`Probe de tokens Meta concluido: ${probed} integracoes sondadas`)
    } catch (error) {
      this.logger.error(`Erro no probe de tokens Meta: ${error.message}`)
    }
  }

  /**
   * Cron diario (3h) - Cleanup de OAuth states expirados
   */
  @Cron('0 3 * * *', { name: 'meta-oauth-state-cleanup' })
  async handleOAuthCleanupCron() {
    if (!shouldRunCron('meta-oauth-cleanup')) return
    const removed = await this.metaAdsOAuthService.cleanupExpiredStates()
    if (removed > 0) {
      this.logger.log(`Cleanup: ${removed} OAuth states expirados removidos`)
    }
  }
}
