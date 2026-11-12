import { Injectable, OnModuleInit, OnModuleDestroy, Inject } from '@nestjs/common'
import Redis from 'ioredis'

export interface CacheOptions {
  ttl?: number // em segundos
  staleTtl?: number // tempo extra que dado expirado ainda pode ser servido enquanto revalida (em segundos)
}

export interface CacheResult<T> {
  data: T | null
  fromCache: boolean
  cacheKey: string
}

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private isRedisAvailable = false

  // In-flight request deduplication: evita thundering herd
  // Se N requests pedem a mesma key, só 1 fetch roda e todas recebem o resultado
  private inFlightRequests = new Map<string, Promise<any>>()

  constructor(
    @Inject('REDIS_CLIENT') private readonly client: Redis
  ) {}

  onModuleInit() {
    this.client.on('ready', () => {
      this.isRedisAvailable = true
    })

    this.client.on('error', (err) => {
      this.isRedisAvailable = false
    })

    this.client.on('end', () => {
      this.isRedisAvailable = false
    })

    this.isRedisAvailable = this.client.status === 'ready'
  }

  onModuleDestroy() {
    this.client.disconnect()
  }

  private isHealthy(): boolean {
    return this.isRedisAvailable && this.client.status === 'ready'
  }

  /**
   * O Redis está respondendo?
   *
   * Existe porque vários métodos deste service degradam devolvendo o MESMO valor que um
   * resultado legítimo: `mget` responde `[null, null, ...]` tanto quando as chaves não
   * existem quanto quando o Redis está fora, e `tryAcquireLock` devolve `true` nos dois
   * casos. Quem precisa DISTINGUIR os dois — porque a decisão de negócio muda — pergunta
   * aqui antes de interpretar a resposta.
   *
   * Caso concreto: a distribuição de leads pode restringir o rodízio a quem está com o
   * HDM aberto. "Ninguém online" deve segurar o lead na recepção; "Redis fora do ar" NÃO
   * pode parar a distribuição da empresa inteira — ali o certo é ignorar o filtro de
   * presença e usar o time todo.
   */
  isAvailable(): boolean {
    return this.isHealthy()
  }

  /**
   * ATENÇÃO: `T` é uma MENTIRA no cache HIT.
   *
   * Miss devolve o objeto vivo do fetchFn (Date, Decimal, undefined intactos).
   * Hit devolve `JSON.parse(...) as T` — Date virou string ISO, Decimal virou string,
   * undefined sumiu, NaN/Infinity viraram null, Map/Set viraram {}. O compilador não vê
   * a diferença por causa do cast.
   *
   * Regra: normalize DENTRO do fetchFn qualquer valor que não sobreviva a JSON. Chamar
   * um método de Date sobre `data` fora do fetchFn funciona no primeiro request e estoura
   * em todos os seguintes (foi exatamente esse o bug do export de ads).
   * Ver dashboard-ads.service.ts: getCampaignMeta e getMetaIntegrationState.
   */
  async cacheAsideWithTimeout<T>(
    key: string,
    fetchFn: () => Promise<T>,
    timeoutMs: number = 30000,
    options: CacheOptions = {}
  ): Promise<CacheResult<T>> {
    const ttl = options.ttl ?? 600
    const staleTtl = options.staleTtl ?? 0
    const totalTtl = staleTtl > 0 ? ttl + staleTtl : ttl

    // Se Redis não estiver disponível, busca direto do banco (com deduplicação, sem timeout)
    if (!this.isHealthy()) {
      const freshData = await this.deduplicatedFetch(key, fetchFn)
      return { data: freshData, fromCache: false, cacheKey: key }
    }

    try {
      const cachedRaw = await this.client.get(key)

      if (cachedRaw) {
        // Stale-while-revalidate: checa se dado está no período "stale"
        if (staleTtl > 0) {
          const realTtl = await this.client.ttl(key)
          // Se TTL restante <= staleTtl, dado está "stale" — servir e revalidar em background
          if (realTtl > 0 && realTtl <= staleTtl) {
            this.revalidateInBackground(key, fetchFn, ttl + staleTtl)
          }
        }

        return {
          data: JSON.parse(cachedRaw) as T,
          fromCache: true,
          cacheKey: key,
        }
      }
    } catch (error) {
      // Redis falhou, continua para fetch
    }

    // Cache miss: busca dados frescos com deduplicação + timeout backstop
    const freshDataPromise = this.deduplicatedFetch(key, fetchFn)
    let freshData: T

    if (timeoutMs > 0) {
      let timeoutHandle: NodeJS.Timeout | undefined
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(
          () => reject(new Error(`cacheAsideWithTimeout: fetch timeout (${timeoutMs}ms) for key ${key}`)),
          timeoutMs,
        )
      })

      try {
        freshData = await Promise.race([freshDataPromise, timeoutPromise])
      } catch (err) {
        // Timeout disparou — última tentativa: ler Redis (race condition pode ter populado o cache)
        try {
          const lastChance = await this.client.get(key)
          if (lastChance) {
            return { data: JSON.parse(lastChance) as T, fromCache: true, cacheKey: key }
          }
        } catch {
          // Redis falhou — propaga o timeout original
        }
        // O fetch continua rodando: persistir o resultado tardio é o que torna o retry (ou o
        // próximo request) um HIT. Sem isto, todo o trabalho do fetch que estourou o timeout
        // é jogado fora e o request seguinte estoura de novo — deduplicatedFetch só faz
        // single-flight, a escrita no Redis mora depois deste throw.
        freshDataPromise
          .then((late) => this.client.set(key, JSON.stringify(late), 'EX', totalTtl))
          .catch(() => {
            // Falha silenciosa: o request já degradou, isto aqui é só aquecimento.
          })
        throw err
      } finally {
        if (timeoutHandle) clearTimeout(timeoutHandle)
      }
    } else {
      freshData = await freshDataPromise
    }

    // Salva no cache de forma assíncrona (fire-and-forget)
    if (this.isHealthy()) {
      this.client.set(key, JSON.stringify(freshData), 'EX', totalTtl).catch(() => {
        // Falha silenciosa na escrita
      })
    }

    return {
      data: freshData,
      fromCache: false,
      cacheKey: key,
    }
  }

  /**
   * Revalida cache em background (fire-and-forget)
   * Usado pelo stale-while-revalidate para atualizar dado sem bloquear o request
   */
  private revalidateInBackground<T>(key: string, fetchFn: () => Promise<T>, totalTtl: number): void {
    // Evitar múltiplas revalidações simultâneas para a mesma key
    const revalidateKey = `revalidating:${key}`
    if (this.inFlightRequests.has(revalidateKey)) return

    const promise = (async () => {
      // Lock cross-process (PM2 cluster): só um worker revalida a mesma key por vez.
      // tryAcquireLock é fail-open (Redis indisponível ⇒ true) — preserva o comportamento anterior.
      const gotLock = await this.tryAcquireLock(`lock:revalidate:${key}`, 30)
      if (!gotLock) return

      const freshData = await fetchFn()
      if (this.isHealthy()) {
        await this.client.set(key, JSON.stringify(freshData), 'EX', totalTtl)
      }
    })()
      .catch(() => {
        // Falha silenciosa — dado stale continua servindo
      })
      .finally(() => {
        this.inFlightRequests.delete(revalidateKey)
      })

    this.inFlightRequests.set(revalidateKey, promise)
  }

  /**
   * Cache rápido para lookups frequentes (company, member)
   * TTL curto (60s), sem stale — dados que mudam pouco mas são consultados muito
   */
  async cachedLookup<T>(key: string, fetchFn: () => Promise<T>, ttlSeconds: number = 60): Promise<T> {
    if (this.isHealthy()) {
      try {
        const cached = await this.client.get(key)
        if (cached) return JSON.parse(cached) as T
      } catch {
        // Falha silenciosa
      }
    }

    const data = await this.deduplicatedFetch(key, fetchFn)

    if (this.isHealthy() && data != null) {
      this.client.set(key, JSON.stringify(data), 'EX', ttlSeconds).catch(() => {})
    }

    return data
  }

  /**
   * Deduplicação de requests in-flight (single-flight pattern)
   * Se já existe um fetch rodando para a mesma key, espera o resultado dele
   * ao invés de disparar uma nova query ao banco
   */
  private async deduplicatedFetch<T>(key: string, fetchFn: () => Promise<T>): Promise<T> {
    const existing = this.inFlightRequests.get(key)
    if (existing) {
      return existing as Promise<T>
    }

    const fetchPromise = fetchFn()
      .finally(() => {
        this.inFlightRequests.delete(key)
      })

    this.inFlightRequests.set(key, fetchPromise)
    return fetchPromise
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (!this.isHealthy()) return
    try {
      if (ttlSeconds && ttlSeconds > 0) {
        await this.client.set(key, value, 'EX', ttlSeconds)
      } else {
        await this.client.set(key, value)
      }
    } catch {
      // Falha silenciosa na escrita
    }
  }

  async get(key: string): Promise<string | null> {
    if (!this.isHealthy()) return null
    try {
      return await this.client.get(key)
    } catch {
      return null
    }
  }

  /**
   * Lê N chaves em UMA round trip (MGET nativo).
   *
   * Existe para o pool de cota do grupo empresarial: somar os contadores das
   * empresas do grupo com N `get()` sequenciais multiplicaria a latência p99 do
   * caminho quente (criação de lead/transação) pelo tamanho do grupo, e o app
   * roda em 3 workers PM2.
   *
   * Degrada igual ao `get()`: Redis fora do ar devolve array de nulls do mesmo
   * tamanho, e o chamador cai no banco.
   */
  async mget(keys: string[]): Promise<(string | null)[]> {
    if (keys.length === 0) return []
    if (!this.isHealthy()) return keys.map(() => null)
    try {
      return await this.client.mget(...keys)
    } catch {
      return keys.map(() => null)
    }
  }

  /**
   * Incremento atômico via INCR nativo do Redis.
   * Se ttlSeconds for informado, seta o EXPIRE apenas quando a key é nova (INCR retorna 1).
   * Retorna o valor após incremento, ou -1 se Redis indisponível.
   */
  async incr(key: string, ttlSeconds?: number): Promise<number> {
    if (!this.isHealthy()) return -1
    try {
      const val = await this.client.incr(key)
      if (val === 1 && ttlSeconds && ttlSeconds > 0) {
        await this.client.expire(key, ttlSeconds)
      }
      return val
    } catch {
      return -1
    }
  }

  /**
   * Tenta adquirir um lock distribuído via SET NX EX.
   * Retorna true se o lock foi adquirido, false se já existe.
   */
  async tryAcquireLock(key: string, ttlSeconds: number): Promise<boolean> {
    if (!this.isHealthy()) return true // Se Redis indisponível, permite execução
    try {
      const result = await this.client.set(key, '1', 'EX', ttlSeconds, 'NX')
      return result === 'OK'
    } catch {
      return true // Em caso de erro, permite execução
    }
  }

  async del(key: string): Promise<void> {
    if (this.isHealthy()) {
      await this.client.del(key).catch(() => null)
    }
  }

  async delByPattern(pattern: string): Promise<number> {
    if (!this.isHealthy()) return 0

    try {
      let cursor = '0'
      let deletedCount = 0

      do {
        const [nextCursor, keys] = await this.client.scan(cursor, 'MATCH', pattern, 'COUNT', 100)
        cursor = nextCursor

        if (keys.length > 0) {
          await this.client.del(...keys)
          deletedCount += keys.length
        }
      } while (cursor !== '0')

      return deletedCount
    } catch (error) {
      console.warn(`⚠️ [Redis] Failed to delete keys by pattern "${pattern}":`, error.message)
      return 0
    }
  }
}