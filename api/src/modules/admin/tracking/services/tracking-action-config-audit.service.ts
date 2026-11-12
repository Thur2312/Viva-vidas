import { Injectable, Logger } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from 'src/database/prisma.service'

/** `''` é o padrão da empresa; qualquer outro valor é um `campaignId`. */
const COMPANY_SCOPE = ''

/**
 * Sentinela do filtro de escopo na LEITURA.
 *
 * Nos endpoints do catálogo, `campaignId` ausente significa "padrão da empresa".
 * Aqui ausente significa "todos os escopos", que é o que a abertura do painel
 * pede. Reusar o nome `campaignId` plantaria uma armadilha silenciosa, então o
 * parâmetro é `scope` e o padrão da empresa se pede explicitamente.
 */
export const SCOPE_FILTER_COMPANY = 'company'

const DEFAULT_TAKE = 50
const MAX_TAKE = 200

/**
 * Campos do catálogo que entram na trilha.
 *
 * Allow-list explícita, como o `AUDITABLE_FIELDS` do update de transação: `id`,
 * `createdAt` e `updatedAt` mudam sozinhos e virariam ruído em toda entrada.
 */
export const AUDITABLE_FIELDS = ['metaEventName', 'eventValue', 'label', 'isActive'] as const

export type AuditableField = (typeof AUDITABLE_FIELDS)[number]

export type TrackingActionChangeType = 'CREATED' | 'UPDATED' | 'DELETED'

/** Estado de uma linha do catálogo, do ponto de vista da trilha. */
export type TrackingActionSnapshot = {
  [K in AuditableField]?: unknown
} | null

/**
 * O que a ação vale quando NÃO existe linha no catálogo.
 *
 * Não é `null` em todo campo: `isActive` tem default `true` no banco. Tratar a
 * linha ausente como `isActive: null` faria toda criação registrar
 * `Ativa: — → true` e toda remoção registrar `Ativa: true → —`, um par de
 * entradas fantasma em cima do que o `changeType` já diz. Comparar contra o
 * default deixa a trilha com os campos que a pessoa realmente mexeu.
 */
const ABSENT_ROW: Record<AuditableField, unknown> = {
  metaEventName: null,
  eventValue: null,
  label: null,
  isActive: true,
}

/** Quem fez a edição. Sai do JWT e da request — nunca do body. */
export interface TrackingActionActor {
  userId?: string | null
  userName?: string | null
  userEmail?: string | null
  ipAddress?: string | null
  userAgent?: string | null
}

export interface TrackingActionChangeEntry {
  companyId: string
  campaignId: string
  action: string
  changeType: TrackingActionChangeType
  changedFields: Record<string, { before: unknown; after: unknown }>
}

export interface ListChangesParams {
  /** Ausente = todos os escopos. `'company'` = padrão da empresa. Resto = campanha. */
  scope?: string | null
  action?: string | null
  skip?: number
  take?: number
}

/**
 * Trilha de alterações do catálogo de ações de tracking.
 *
 * O `TrackingController` tem `@SkipLogging()` na classe — decisão certa, porque
 * são 202.852 POSTs de máquina no dump e a própria `Tracking` já é o registro
 * deles. O efeito colateral é que o `PUT` do catálogo também escapava da tabela
 * `Logs`: trocar o peso de uma conversão não deixava rastro nenhum.
 *
 * A tabela é append-only e não tem `deleted_at`, então todo acesso é por
 * `prisma.trackingActionConfigChange` (cliente base). Por `prisma.client.*` a
 * extension `filterSoftDeleted` injetaria `deleted_at: null` e o Postgres
 * responderia "column does not exist".
 */
@Injectable()
export class TrackingActionConfigAuditService {
  private readonly logger = new Logger(TrackingActionConfigAuditService.name)

  constructor(private prisma: PrismaService) {}

  /**
   * O que mudou entre dois estados da mesma linha, campo a campo.
   *
   * Comparação ESTRITA e normalização para `null` antes de comparar: `null`
   * (sem peso) e `0` (conversão de valor zero) são coisas diferentes, e é a
   * mesma distinção que a herança campo a campo protege com `??` em vez de
   * `||`. Um `==` aqui apagaria da trilha justamente a edição que zera um peso.
   */
  computeDiff(
    before: TrackingActionSnapshot,
    after: TrackingActionSnapshot,
  ): Record<string, { before: unknown; after: unknown }> {
    const diff: Record<string, { before: unknown; after: unknown }> = {}

    for (const field of AUDITABLE_FIELDS) {
      const oldValue = before ? (before[field] ?? null) : ABSENT_ROW[field]
      const newValue = after ? (after[field] ?? null) : ABSENT_ROW[field]
      if (oldValue !== newValue) {
        diff[field] = { before: oldValue, after: newValue }
      }
    }

    return diff
  }

  /**
   * A entrada de trilha de UMA ação, ou `null` quando nada mudou.
   *
   * O `null` é o caso mais comum e o mais importante: a tela manda TODAS as
   * ~36 linhas em todo save, não só as editadas. Sem este corte, um clique em
   * "Salvar" escreveria 36 linhas e a trilha viraria ruído — e as ~30 ações que
   * nunca tiveram mapeamento apareceriam como apagadas em toda edição.
   */
  buildEntry(input: {
    companyId: string
    campaignId: string
    action: string
    before: TrackingActionSnapshot
    after: TrackingActionSnapshot
  }): TrackingActionChangeEntry | null {
    const { companyId, campaignId, action, before, after } = input

    if (!before && !after) return null

    const changedFields = this.computeDiff(before, after)
    if (Object.keys(changedFields).length === 0) return null

    const changeType: TrackingActionChangeType = !before
      ? 'CREATED'
      : !after
        ? 'DELETED'
        : 'UPDATED'

    return { companyId, campaignId, action, changeType, changedFields }
  }

  /**
   * As linhas prontas para o `createMany`, já com o autor carimbado.
   *
   * Devolve o argumento do Prisma em vez de gravar: quem chama anexa isso ao
   * MESMO `$transaction` do upsert. Perder a trilha num crash entre as duas
   * escritas seria regressão de correção — mesmo critério do
   * `dnd-opportunities.service.ts`.
   */
  buildCreateManyData(
    entries: TrackingActionChangeEntry[],
    actor?: TrackingActionActor | null,
  ): Prisma.TrackingActionConfigChangeCreateManyInput[] {
    return entries.map((entry) => ({
      companyId: entry.companyId,
      campaignId: entry.campaignId,
      action: entry.action,
      changeType: entry.changeType,
      changedFields: entry.changedFields as Prisma.InputJsonValue,
      userId: actor?.userId ?? null,
      userName: actor?.userName ?? null,
      userEmail: actor?.userEmail ?? null,
      ipAddress: actor?.ipAddress ?? null,
      userAgent: actor?.userAgent ?? null,
    }))
  }

  async list(companyId: string, params: ListChangesParams = {}) {
    const where: Prisma.TrackingActionConfigChangeWhereInput = { companyId }

    if (typeof params.scope === 'string' && params.scope !== '') {
      where.campaignId = params.scope === SCOPE_FILTER_COMPANY ? COMPANY_SCOPE : params.scope
    }

    const action = typeof params.action === 'string' ? params.action.trim().toLowerCase() : ''
    if (action) where.action = action

    const take = Math.min(Math.max(Number(params.take) || DEFAULT_TAKE, 1), MAX_TAKE)
    const skip = Math.max(Number(params.skip) || 0, 0)

    const [logs, total] = await Promise.all([
      this.prisma.trackingActionConfigChange.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.trackingActionConfigChange.count({ where }),
    ])

    return { logs, total, skip, take }
  }
}
