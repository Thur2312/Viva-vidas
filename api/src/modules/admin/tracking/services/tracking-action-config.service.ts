import { BadRequestException, Injectable, Logger } from '@nestjs/common'
import { PrismaService } from 'src/database/prisma.service'
import { RedisService } from 'src/shared/redis/redis.service'
import {
  normalizeEventValue,
  sanitizeEventName,
} from 'src/modules/admin/trigger/utils/meta-capi-normalize'
import { TrackingAnalyticsService } from './tracking-analytics.service'
import {
  TrackingActionActor,
  TrackingActionChangeEntry,
  TrackingActionConfigAuditService,
  TrackingActionSnapshot,
} from './tracking-action-config-audit.service'
import { TrackingActionConfigItemDto } from '../dto/tracking-action-config.dto'

/** O que o emitter precisa saber sobre uma ação, já resolvido. */
export interface TrackingActionResolved {
  label: string | null
  metaEventName: string | null
  eventValue: number | null
}

/** Uma linha da tela: a ação observada mais o mapeamento, quando existe. */
export interface TrackingActionConfigRow extends TrackingActionResolved {
  action: string
  isActive: boolean
  /** `false` quando a ação já foi vista mas ainda não tem mapeamento NESTE escopo. */
  isConfigured: boolean
  /** `false` quando o mapeamento existe mas a ação não aparece mais na tabela. */
  isObserved: boolean
  /** Volume observado. É o que separa a ação que importa do resíduo de teste. */
  eventCount: number
  lastSeenAt: Date | null
  /**
   * O que o padrão da empresa define, quando o escopo é uma campanha.
   *
   * É o que deixa a tela mostrar `Lead (herdado)` como placeholder em vez de
   * campo vazio — sem isso o usuário não distingue "não tem nome" de "tem nome,
   * vindo do padrão". Sempre `null` no escopo da própria empresa.
   */
  inheritedMetaEventName: string | null
  inheritedEventValue: number | null
}

/**
 * Quais campanhas sobrescrevem o padrão da empresa, e em quais ações.
 *
 * Existe porque a tela do catálogo prometia que "uma campanha pode sobrescrever
 * qualquer um destes campos" sem nunca dizer QUAIS: para descobrir, o usuário
 * abriria as 41 campanhas da digienge uma a uma. Ler os escopos um por um pelo
 * cliente seriam 41 requisições; aqui é um `groupBy` só.
 *
 * Sem nome de campanha de propósito: não há FK de `campaignId` para `Campaigns`
 * (a sentinela `''` quebraria a unique), e a tela já carrega a lista de
 * campanhas para o seletor. O join é lá.
 */
export interface TrackingActionScopes {
  /** Uma entrada por campanha com override. Alimenta os chips e o seletor. */
  campaigns: { campaignId: string; overrideCount: number }[]
  /** Uma entrada por ação sobrescrita em algum lugar. Alimenta o selo da linha. */
  actions: { action: string; campaignIds: string[] }[]
}

/** `''` é o padrão da empresa; qualquer outro valor é um `campaignId`. */
const COMPANY_SCOPE = ''

const CACHE_PREFIX = 'tracking-action-config:'
const USAGE_CACHE_PREFIX = 'tracking-action-usage:'
const CACHE_TTL_SECONDS = 60

/**
 * Catálogo de ações de tracking da empresa.
 *
 * Responde "o que `video_50` vira quando chega na Meta, e quanto vale". Antes
 * disso a resposta vinha do par `eventName`/`eventValue` da ação
 * `create_tracking`, que é do TRIGGER inteiro — o mesmo nome e o mesmo peso
 * para toda ação que caísse nele.
 *
 * O mapa é lido pelo `TrackingEventService` no momento em que o evento é
 * emitido, e não na hora de enviar para a Meta. É isso que coloca o peso no
 * payload ANTES das condições rodarem, tornando `tracking.value >= 50` uma
 * condição de verdade.
 */
@Injectable()
export class TrackingActionConfigService {
  private readonly logger = new Logger(TrackingActionConfigService.name)

  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
    private analytics: TrackingAnalyticsService,
    private audit: TrackingActionConfigAuditService,
  ) {}

  /**
   * Chave canônica do catálogo.
   *
   * A tabela `Tracking` convive com `OPTIN` e `optin` porque só um dos cinco
   * caminhos de escrita chama `normalizeAction()`. O catálogo guarda minúsculo
   * e todo lookup baixa a caixa, senão metade dos eventos não encontraria o
   * próprio mapeamento.
   */
  private normalizeKey(action: unknown): string | null {
    if (typeof action !== 'string') return null
    const trimmed = action.trim().toLowerCase()
    return trimmed || null
  }

  /**
   * Escopo canônico. Ausente, nulo ou em branco = padrão da empresa.
   *
   * Um `undefined` que escapasse para a coluna criaria uma linha que nenhuma
   * unique pega e que o `getMap` indexaria fora do bucket certo.
   */
  private normalizeScope(campaignId?: string | null): string {
    if (typeof campaignId !== 'string') return COMPANY_SCOPE
    return campaignId.trim() || COMPANY_SCOPE
  }

  /**
   * A campanha do escopo tem que ser desta empresa.
   *
   * Sem isto, `?campaignId=<campanha de outra empresa>` gravava a linha e
   * devolvia 200. Não vazava dado — a leitura é toda por `companyId`, então a
   * empresa dona da campanha nunca era afetada nem via nada. Mas nascia uma
   * linha que a tela não sabe nomear (o `labelFor` do front só conhece as
   * campanhas da própria empresa) e que virava chip fantasma no card de escopos.
   *
   * Só na ESCRITA. Ler com um `campaignId` alheio devolve os defaults da própria
   * empresa e mais nada; validar no `list` cobraria uma query por abertura de
   * página para fechar uma porta que não leva a lugar nenhum.
   *
   * Escopo `''` (o padrão, e o caso comum) sai antes de consultar o banco.
   */
  private async assertCampaignBelongs(companyId: string, scope: string): Promise<void> {
    if (scope === COMPANY_SCOPE) return

    const campaign = await this.prisma.campaigns.findFirst({
      where: { campaignId: scope, companyId, deleted_at: null },
      select: { campaignId: true },
    })

    if (!campaign) {
      throw new BadRequestException('Campanha nao pertence a esta empresa ou nao existe.')
    }
  }

  private cacheKey(companyId: string): string {
    return `${CACHE_PREFIX}${companyId}`
  }

  private usageCacheKey(companyId: string): string {
    return `${USAGE_CACHE_PREFIX}${companyId}`
  }

  /**
   * Toda ação observada na empresa, com o mapeamento quando houver — mais os
   * mapeamentos de ações que pararam de aparecer.
   *
   * As duas metades importam: sem as observadas o usuário não descobre o que
   * pode mapear; sem as órfãs, uma ação que ficou um tempo sem disparar sumiria
   * da tela levando junto o peso que alguém configurou.
   */
  async list(companyId: string, campaignId?: string | null): Promise<TrackingActionConfigRow[]> {
    const scope = this.normalizeScope(campaignId)
    const isCampaignScope = scope !== COMPANY_SCOPE

    // Sempre busca os DOIS escopos: no escopo de campanha a tela precisa do
    // padrão da empresa para mostrar o que está sendo herdado.
    const scopesToRead = isCampaignScope ? [COMPANY_SCOPE, scope] : [COMPANY_SCOPE]

    const [usage, rows] = await Promise.all([
      this.getUsage(companyId),
      this.prisma.trackingActionConfig.findMany({
        where: { companyId, campaignId: { in: scopesToRead } },
        orderBy: { action: 'asc' },
      }),
    ])

    const own = new Map<string, (typeof rows)[number]>()
    const inherited = new Map<string, (typeof rows)[number]>()
    for (const row of rows) {
      const key = this.normalizeKey(row.action)
      if (!key) continue
      if (row.campaignId === scope) own.set(key, row)
      else if (isCampaignScope && row.campaignId === COMPANY_SCOPE) inherited.set(key, row)
    }

    const build = (
      action: string,
      eventCount: number,
      lastSeenAt: Date | null,
      isObserved: boolean,
    ): TrackingActionConfigRow => {
      const row = own.get(action)
      const base = inherited.get(action)
      return {
        action,
        label: row?.label ?? null,
        metaEventName: row?.metaEventName ?? null,
        eventValue: row?.eventValue ?? null,
        isActive: row?.isActive ?? true,
        isConfigured: !!row,
        isObserved,
        eventCount,
        lastSeenAt,
        inheritedMetaEventName: base?.metaEventName ?? null,
        inheritedEventValue: base?.eventValue ?? null,
      }
    }

    const observed = new Set(usage.map((u) => u.action))
    const result = usage.map((u) => build(u.action, u.eventCount, u.lastSeenAt, true))

    // Mapeamento de ação que parou de disparar continua na lista — some da tela
    // levaria junto o peso que alguém configurou. Vale para os dois escopos: uma
    // linha herdada sem uso recente ainda governa o que a Meta recebe.
    for (const action of new Set([...own.keys(), ...inherited.keys()])) {
      if (observed.has(action)) continue
      result.push(build(action, 0, null, false))
    }

    // Volume primeiro. Em ordem alfabética a primeira linha da digienge era
    // `acceced` (1 evento, jun/2025) e `optin` (3.059) caía na 28ª.
    return result.sort(
      (a, b) => b.eventCount - a.eventCount || a.action.localeCompare(b.action),
    )
  }

  /**
   * Os escopos de campanha que existem hoje, nas duas projeções que a tela usa.
   *
   * Um `groupBy` por `(campaignId, action)` responde as duas perguntas — "quais
   * campanhas sobrescrevem" e "quais ações são sobrescritas em algum lugar" —
   * com uma ida só ao banco, coberta pelo índice `(company_id, campaign_id)`.
   * Dois endpoints seriam duas varreduras da mesma tabela.
   *
   * Sem cache: é uma tabela pequena, lida uma vez por abertura da página. Uma
   * quarta chave em Redis seria mais uma para o `invalidate()` esquecer de
   * limpar quando um override nasce ou morre, e o preço do erro é a tela
   * afirmar que uma campanha sobrescreve algo que ela não sobrescreve mais.
   */
  async listScopes(companyId: string): Promise<TrackingActionScopes> {
    const rows = await this.prisma.trackingActionConfig.groupBy({
      by: ['campaignId', 'action'],
      where: { companyId, campaignId: { not: COMPANY_SCOPE } },
    })

    const byCampaign = new Map<string, number>()
    const byAction = new Map<string, string[]>()

    const seen = new Set<string>()

    for (const row of rows) {
      // `{ not: '' }` no SQL nao pega um `campaignId` so de espaco, que o
      // `normalizeScope` trata como padrao da empresa. Sem isto, um escopo
      // fantasma apareceria como campanha na tela.
      const scope = this.normalizeScope(row.campaignId)
      if (scope === COMPANY_SCOPE) continue

      const action = this.normalizeKey(row.action)
      if (!action) continue

      // `OPTIN` e `optin` na MESMA campanha viram a mesma regra depois de
      // normalizar. Contar as duas inflaria o numero que o chip mostra.
      const pair = `${scope}\u0000${action}`
      if (seen.has(pair)) continue
      seen.add(pair)

      byCampaign.set(scope, (byCampaign.get(scope) ?? 0) + 1)

      const scopesOfAction = byAction.get(action)
      if (scopesOfAction) scopesOfAction.push(scope)
      else byAction.set(action, [scope])
    }

    return {
      campaigns: [...byCampaign.entries()]
        .map(([campaignId, overrideCount]) => ({ campaignId, overrideCount }))
        // Mais overrides primeiro: é a campanha que mais destoa do padrão, e é
        // dela que o usuário costuma estar atrás.
        .sort((a, b) => b.overrideCount - a.overrideCount || a.campaignId.localeCompare(b.campaignId)),
      actions: [...byAction.entries()].map(([action, campaignIds]) => ({ action, campaignIds })),
    }
  }

  /**
   * Agregação de uso, cacheada por 60s.
   *
   * `list()` também alimenta o seletor de ação das condições
   * (`GET /triggers/helpers/tracking-actions`), que abre toda vez que alguém
   * mexe num trigger — sem cache seriam 53ms de GROUP BY por abertura.
   */
  private async getUsage(
    companyId: string,
  ): Promise<{ action: string; eventCount: number; lastSeenAt: Date | null }[]> {
    const usage = await this.redis.cachedLookup(
      this.usageCacheKey(companyId),
      () => this.analytics.getTrackingActionUsage(companyId),
      CACHE_TTL_SECONDS,
    )

    // Cache quente devolve `lastSeenAt` como string (passou por JSON), frio
    // devolve Date. Normalizar aqui para que quem consome não tenha que saber
    // de qual dos dois caminhos o dado veio.
    return usage.map((u) => ({
      ...u,
      lastSeenAt: u.lastSeenAt ? new Date(u.lastSeenAt) : null,
    }))
  }

  /**
   * Grava o catálogo em lote.
   *
   * Linha sem rótulo, sem nome e sem peso é apagada em vez de virar registro
   * vazio: é assim que "limpar o mapeamento" funciona pelo mesmo PUT que salva,
   * sem precisar de uma chamada de DELETE por linha.
   */
  async upsertMany(
    companyId: string,
    items: TrackingActionConfigItemDto[],
    campaignId?: string | null,
    actor?: TrackingActionActor | null,
  ): Promise<TrackingActionConfigRow[]> {
    const scope = this.normalizeScope(campaignId)
    await this.assertCampaignBelongs(companyId, scope)

    const seen = new Set<string>()
    const toUpsert: {
      action: string
      label: string | null
      metaEventName: string | null
      eventValue: number | null
      isActive: boolean
    }[] = []
    const toDelete: string[] = []

    for (const item of items ?? []) {
      const action = this.normalizeKey(item?.action)
      if (!action) {
        throw new BadRequestException('Ação inválida: informe o nome da ação de tracking.')
      }
      if (seen.has(action)) {
        throw new BadRequestException(`Ação repetida no envio: '${action}'.`)
      }
      seen.add(action)

      const label = this.parseLabel(item.label)
      const metaEventName = this.parseEventName(action, item.metaEventName)
      const eventValue = this.parseEventValue(action, item.eventValue)

      if (label === null && metaEventName === null && eventValue === null) {
        toDelete.push(action)
        continue
      }

      toUpsert.push({
        action,
        label,
        metaEventName,
        eventValue,
        isActive: item.isActive ?? true,
      })
    }

    // O estado ANTES, para a trilha. Precisa vir daqui e não do `list()`: o
    // `list` já mistura o padrão da empresa na herança, e a trilha registra o
    // que mudou NESTA linha, não o que a linha passou a valer depois de herdar.
    const changes = await this.buildChangeEntries(companyId, scope, [...seen], toUpsert, toDelete)
    const auditRows = this.audit.buildCreateManyData(changes, actor)

    await this.prisma.$transaction([
      ...(toDelete.length
        ? [
            this.prisma.trackingActionConfig.deleteMany({
              where: { companyId, campaignId: scope, action: { in: toDelete } },
            }),
          ]
        : []),
      ...toUpsert.map((row) =>
        this.prisma.trackingActionConfig.upsert({
          where: {
            companyId_campaignId_action: { companyId, campaignId: scope, action: row.action },
          },
          create: { companyId, campaignId: scope, ...row },
          update: {
            label: row.label,
            metaEventName: row.metaEventName,
            eventValue: row.eventValue,
            isActive: row.isActive,
          },
        }),
      ),
      // Na MESMA transação do upsert de propósito: uma edição que grava e uma
      // trilha que se perde no crash entre as duas escritas é pior do que não
      // ter trilha, porque ela passa a mentir por omissão.
      ...(auditRows.length
        ? [this.prisma.trackingActionConfigChange.createMany({ data: auditRows })]
        : []),
    ])

    await this.invalidate(companyId)
    return this.list(companyId, scope)
  }

  /**
   * Uma entrada de trilha por ação que REALMENTE mudou.
   *
   * O corte é o ponto todo do método. A tela manda as ~36 linhas do escopo em
   * todo save, e a esmagadora maioria delas nunca teve mapeamento: sem filtrar,
   * um clique em "Salvar" escreveria 36 linhas e ~30 delas diriam "apagado",
   * todas as vezes.
   */
  private async buildChangeEntries(
    companyId: string,
    scope: string,
    actions: string[],
    toUpsert: { action: string; label: string | null; metaEventName: string | null; eventValue: number | null; isActive: boolean }[],
    toDelete: string[],
  ): Promise<TrackingActionChangeEntry[]> {
    if (!actions.length) return []

    const existing = await this.prisma.trackingActionConfig.findMany({
      where: { companyId, campaignId: scope, action: { in: actions } },
      select: { action: true, label: true, metaEventName: true, eventValue: true, isActive: true },
    })

    const before = new Map<string, TrackingActionSnapshot>()
    for (const row of existing) {
      before.set(row.action, {
        label: row.label,
        metaEventName: row.metaEventName,
        eventValue: row.eventValue,
        isActive: row.isActive,
      })
    }

    const after = new Map<string, TrackingActionSnapshot>()
    for (const row of toUpsert) {
      after.set(row.action, {
        label: row.label,
        metaEventName: row.metaEventName,
        eventValue: row.eventValue,
        isActive: row.isActive,
      })
    }
    // Ação no ramo de delete tem `after` nulo — e `buildEntry` devolve `null`
    // quando os dois lados são nulos, que é o caso das ações nunca mapeadas.
    for (const action of toDelete) {
      if (!after.has(action)) after.set(action, null)
    }

    const entries: TrackingActionChangeEntry[] = []
    for (const action of actions) {
      const entry = this.audit.buildEntry({
        companyId,
        campaignId: scope,
        action,
        before: before.get(action) ?? null,
        after: after.get(action) ?? null,
      })
      if (entry) entries.push(entry)
    }

    return entries
  }

  async remove(
    companyId: string,
    action: string,
    campaignId?: string | null,
    actor?: TrackingActionActor | null,
  ): Promise<{ removed: number }> {
    const key = this.normalizeKey(action)
    if (!key) throw new BadRequestException('Ação inválida.')

    const scope = this.normalizeScope(campaignId)
    await this.assertCampaignBelongs(companyId, scope)

    // A UI apaga pelo PUT com a linha em branco, mas esta rota existe e precisa
    // deixar o mesmo rastro — senão some da trilha exatamente o caminho que não
    // passa pela tela.
    const changes = await this.buildChangeEntries(companyId, scope, [key], [], [key])
    const auditRows = this.audit.buildCreateManyData(changes, actor)

    const [{ count }] = await this.prisma.$transaction([
      this.prisma.trackingActionConfig.deleteMany({
        where: { companyId, campaignId: scope, action: key },
      }),
      ...(auditRows.length
        ? [this.prisma.trackingActionConfigChange.createMany({ data: auditRows })]
        : []),
    ])

    await this.invalidate(companyId)
    return { removed: count }
  }

  /**
   * Mapa `escopo → ação → { nome, peso }` para o emitter, cacheado por 60s.
   *
   * Um cache por EMPRESA cobrindo todos os escopos: o mapa inteiro é pequeno
   * (dezenas de ações × campanhas) e assim uma edição em qualquer campanha
   * invalida uma chave só.
   *
   * Roda em todo evento de tracking, que é o caminho quente do `/track`. O TTL
   * curto é o compromisso: uma edição aparece em no máximo um minuto mesmo se a
   * invalidação falhar, e o banco não leva uma consulta por pixel disparado.
   */
  async getMap(
    companyId: string,
  ): Promise<Record<string, Record<string, TrackingActionResolved>>> {
    return this.redis.cachedLookup(
      this.cacheKey(companyId),
      async () => {
        const rows = await this.prisma.trackingActionConfig.findMany({
          where: { companyId, isActive: true },
          select: {
            campaignId: true,
            action: true,
            label: true,
            metaEventName: true,
            eventValue: true,
          },
        })

        const map: Record<string, Record<string, TrackingActionResolved>> = {}
        for (const row of rows) {
          const key = this.normalizeKey(row.action)
          if (!key) continue
          const scope = this.normalizeScope(row.campaignId)
          map[scope] ??= {}
          map[scope][key] = {
            label: row.label ?? null,
            metaEventName: row.metaEventName ?? null,
            eventValue: row.eventValue ?? null,
          }
        }
        return map
      },
      CACHE_TTL_SECONDS,
    )
  }

  /**
   * Resolve uma ação para uma campanha, mesclando CAMPO A CAMPO com o padrão da
   * empresa.
   *
   * Campo a campo e não substituição da linha inteira: é o que permite dizer
   * "nesta campanha o opt-in vale mais" sem redigitar o nome do evento. Na
   * digienge o `optin` dispara em 27 campanhas — obrigar a repetir `Lead` em
   * cada uma seria 27 chances de digitar diferente.
   *
   * `??` e nunca `||`: peso `0` é conversão de valor zero, um valor legítimo.
   * Com `||`, uma campanha que zerasse o peso herdaria o da empresa de volta.
   */
  async resolve(
    companyId: string,
    campaignId: unknown,
    action: unknown,
  ): Promise<TrackingActionResolved | null> {
    const key = this.normalizeKey(action)
    if (!key) return null

    try {
      const map = await this.getMap(companyId)
      const scope = this.normalizeScope(typeof campaignId === 'string' ? campaignId : null)

      const base = map[COMPANY_SCOPE]?.[key]
      const over = scope !== COMPANY_SCOPE ? map[scope]?.[key] : undefined
      if (!base && !over) return null

      return {
        label: over?.label ?? base?.label ?? null,
        metaEventName: over?.metaEventName ?? base?.metaEventName ?? null,
        eventValue: over?.eventValue ?? base?.eventValue ?? null,
      }
    } catch (error) {
      // Catálogo é enriquecimento: sem ele o evento sai como saía antes, com o
      // nome cru e sem valor. Derrubar a emissão por causa disto seria trocar
      // um evento pobre por evento nenhum.
      this.logger.warn(`[TrackingActionConfig] Falha ao resolver '${key}': ${error.message}`)
      return null
    }
  }

  private async invalidate(companyId: string): Promise<void> {
    try {
      // As DUAS chaves: o mapa que o emitter lê e a agregação que a tela lê.
      // Esquecer a segunda faz a lista voltar sem o mapeamento recém-salvo.
      await Promise.all([
        this.redis.del(this.cacheKey(companyId)),
        this.redis.del(this.usageCacheKey(companyId)),
      ])
    } catch (error) {
      this.logger.warn(`[TrackingActionConfig] Falha ao invalidar cache: ${error.message}`)
    }
  }

  private parseLabel(raw: unknown): string | null {
    if (raw === null || raw === undefined) return null
    const trimmed = String(raw).trim()
    return trimmed || null
  }

  /**
   * Nome enviado à Meta. Branco limpa o mapeamento; lixo é erro de validação.
   *
   * Usa o `sanitizeEventName()` do módulo de trigger de propósito: ele já é a
   * fonte da verdade da normalização Meta (acento, caractere inválido, teto de
   * 50). Uma segunda regra aqui divergiria da primeira no primeiro ajuste.
   */
  private parseEventName(action: string, raw: unknown): string | null {
    if (raw === null || raw === undefined || String(raw).trim() === '') return null

    const sanitized = sanitizeEventName(raw)
    if (!sanitized) {
      throw new BadRequestException(
        `Nome de evento inválido para '${action}': '${raw}'. ` +
          'A Meta aceita apenas letras, números e underscore no nome do evento.',
      )
    }
    return sanitized
  }

  private parseEventValue(action: string, raw: unknown): number | null {
    if (raw === null || raw === undefined || String(raw).trim() === '') return null

    const parsed = normalizeEventValue(raw)
    if (parsed === null) {
      throw new BadRequestException(
        `Peso inválido para '${action}': '${raw}'. Informe um número maior ou igual a zero.`,
      )
    }
    return parsed
  }
}
