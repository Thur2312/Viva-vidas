import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common'
import { PrismaService } from 'src/database/prisma.service'
import { RedisService } from 'src/shared/redis/redis.service'

/** Tri-estado de proposito: "nao existe" nao e a mesma coisa que "inativa". */
export type CompanyStatusValue = 'ACTIVE' | 'INACTIVE' | 'MISSING'

/**
 * Status de atividade da empresa, com cache.
 *
 * Registrado no SharedModule, que e @Global — nenhum consumidor precisa importar
 * modulo. Mesmo precedente do CompanyGroupService e do CompanyTimezoneService.
 *
 * Duas camadas de cache pelo mesmo motivo do CompanyGroupService: isActive roda
 * em TODA request autenticada (jwt.strategy) e em TODO webhook, entao ir ao
 * Redis a cada chamada seria caro; e o app roda em 3 workers PM2
 * (cluster.config.js), entao um Map process-local sozinho serviria estados
 * divergentes entre workers logo depois de alguem desativar uma empresa.
 *
 * TTL igual ao do grupo (300s Redis / 15s Map) porque a invalidacao e explicita:
 * toda transicao de status chama invalidate(). O TTL e rede de seguranca para
 * escrita fora do fluxo (SQL na mao, script), nao o mecanismo principal.
 */
@Injectable()
export class CompanyStatusService {
  private readonly logger = new Logger(CompanyStatusService.name)

  private readonly REDIS_PREFIX = 'company:status:v1'
  private readonly REDIS_TTL = 300
  private readonly REDIS_STALE_TTL = 120
  private readonly LOCAL_TTL_MS = 15_000

  private readonly localCache = new Map<string, { status: CompanyStatusValue; fetchedAt: number }>()

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /**
   * Status da empresa. Nunca lanca — ver a nota de fail-open em assertActive.
   */
  async getStatus(companyId: string): Promise<CompanyStatusValue> {
    if (!companyId) return 'MISSING'

    const now = Date.now()
    const local = this.localCache.get(companyId)
    if (local && now - local.fetchedAt < this.LOCAL_TTL_MS) return local.status

    const key = `${this.REDIS_PREFIX}:${companyId}`

    try {
      const { data } = await this.redis.cacheAsideWithTimeout<CompanyStatusValue>(
        key,
        async () => {
          // findFirst passa pela extension filterSoftDeleted, entao empresa
          // soft-deletada cai em MISSING sem precisar de where explicito.
          const company = await this.prisma.client.companies.findFirst({
            where: { id: companyId },
            select: { status: true },
          })
          return (company?.status as CompanyStatusValue) ?? 'MISSING'
        },
        8000,
        { ttl: this.REDIS_TTL, staleTtl: this.REDIS_STALE_TTL },
      )

      const status = data ?? 'MISSING'
      this.localCache.set(companyId, { status, fetchedAt: now })
      return status
    } catch (err) {
      // FAIL-OPEN DELIBERADO, e so aqui.
      //
      // Este metodo e chamado do jwt.strategy.validate, que roda em toda request
      // autenticada: qualquer excecao propagada dali vira 401 na API INTEIRA.
      // Derrubar todos os clientes porque o Redis piscou seria um estrago muito
      // maior do que uma empresa inativa continuar respondendo por alguns
      // segundos. O caminho de LOGIN nao depende disto — la a leitura de status
      // e direta no banco, e portanto fail-closed.
      //
      // Redis fora do ar sozinho NAO cai aqui: cacheAsideWithTimeout ja degrada
      // para o banco. So chega neste catch se banco e cache falharem juntos —
      // situacao em que a request morreria de qualquer jeito logo adiante.
      this.logger.warn(`Falha ao ler status da empresa ${companyId}, assumindo ATIVA: ${err?.message || err}`)
      return 'ACTIVE'
    }
  }

  async isActive(companyId: string): Promise<boolean> {
    return (await this.getStatus(companyId)) === 'ACTIVE'
  }

  /**
   * Bloqueia empresa inativa. 403 para inativa, 404 para inexistente — a
   * distincao importa porque quem chama ja tratou "nao encontrada" com a propria
   * mensagem, e um 403 "empresa inativa" para id inexistente manda o suporte
   * cacar um problema de billing que nao existe.
   */
  async assertActive(companyId: string): Promise<void> {
    const status = await this.getStatus(companyId)

    if (status === 'MISSING') {
      throw new HttpException('Empresa não encontrada', HttpStatus.NOT_FOUND)
    }

    if (status !== 'ACTIVE') {
      throw new HttpException('Empresa inativa. Acesso suspenso.', HttpStatus.FORBIDDEN)
    }
  }

  /**
   * Invalida o cache de status. Chamar em TODA transicao de status — sem isto a
   * desativacao so surte efeito depois de 15s (Map) a 300s (Redis), e de forma
   * desencontrada entre os 3 workers PM2.
   */
  async invalidate(companyId: string): Promise<void> {
    try {
      this.localCache.delete(companyId)
      await this.redis.del(`${this.REDIS_PREFIX}:${companyId}`)
    } catch (err) {
      this.logger.warn(`Falha ao invalidar status de ${companyId}: ${err?.message || err}`)
    }
  }
}
