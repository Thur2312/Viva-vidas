import { Logger } from '@nestjs/common'
import { Prisma, PrismaClient } from '@prisma/client'

const logger = new Logger('PrismaSoftDelete')

/**
 * Models que REALMENTE tem a coluna `deleted_at`, lidos do schema em runtime.
 *
 * Sao 81 de 134 (medido em 31/08/2026). As extensions aplicavam soft delete a
 * `$allModels` sem verificar nada, entao nos outros 53 — `AdsPerformance`, `Tracking`,
 * `TriggerTrackingEvent`, `Installment`, `ExchangeRate`, `AdCreativeAnalysis`… — toda
 * leitura pelo client ESTENDIDO virava uma query invalida:
 *
 *   Invalid `prisma.adCreativeAnalysis.findUnique()` invocation:
 *   Unknown argument `deleted_at`.
 *
 * O modo de falha alternava entre 500 visivel (rota de analise de criativo, 31/08) e
 * funcionalidade que sumia em silencio (o varredor de leads orfaos tinha o erro engolido
 * pelo proprio try/catch — ver lead-distribution-sweeper.service.spec.ts). Nas duas vezes
 * a correcao foi contornar no chamador, e a armadilha continuou armada para o proximo.
 *
 * DERIVAR DO SCHEMA, e nao manter uma lista a mao, e o ponto: model novo sem a coluna
 * nasce tratado corretamente, sem ninguem precisar lembrar de atualizar nada aqui.
 */
const MODELOS_COM_SOFT_DELETE = new Set(
  Prisma.dmmf.datamodel.models
    .filter((m) => m.fields.some((f) => f.name === 'deleted_at'))
    .map((m) => m.name),
)

/** `true` quando o model tem `deleted_at` — unico criterio das tres extensions. */
export function temSoftDelete(model?: string | null): boolean {
  return !!model && MODELOS_COM_SOFT_DELETE.has(model)
}

/**
 * As extensions de escrita sao FABRICAS que recebem o client CRU.
 *
 * Dentro do override de `delete` nao da para chamar o `delete` original — `context` e o
 * proprio delegate estendido, e chama-lo recursaria. Como `customPrismaClient` ja tem o
 * client cru em maos, ele e passado adiante e serve de escape para a exclusao fisica.
 */
export const softDelete = (clientCru: PrismaClient) =>
  Prisma.defineExtension({
    name: 'softDelete',
    model: {
      $allModels: {
        async delete<M, A>(this: M, where: Prisma.Args<M, 'delete'>['where']): Promise<Prisma.Result<M, A, 'update'>> {
          const context = Prisma.getExtensionContext(this)
          const model = (context as any).$name as string | undefined

          if (!temSoftDelete(model)) {
            // Sem coluna para marcar, a unica semantica possivel e a exclusao real. Antes
            // isto estourava com "Unknown argument `deleted_at`". O aviso existe para que
            // um dado apagado por este caminho seja rastreavel depois — varredura de
            // 31/08 nao encontrou nenhum chamador vivo, e o log e o que denuncia o
            // primeiro que aparecer.
            logger.warn(`[${model}] sem deleted_at — executando DELETE FISICO (nao ha o que marcar)`)
            return (clientCru as any)[model!].delete({ where })
          }

          return (context as any).update({
            where,
            data: {
              deleted_at: new Date(),
            },
          })
        },
      },
    },
  })

export const softDeleteMany = (clientCru: PrismaClient) =>
  Prisma.defineExtension({
    name: 'softDeleteMany',
    model: {
      $allModels: {
        async deleteMany<M, A>(this: M, where: Prisma.Args<M, 'deleteMany'>['where']): Promise<Prisma.Result<M, A, 'updateMany'>> {
          const context = Prisma.getExtensionContext(this)
          const model = (context as any).$name as string | undefined

          if (!temSoftDelete(model)) {
            logger.warn(`[${model}] sem deleted_at — executando DELETE FISICO em lote`)
            return (clientCru as any)[model!].deleteMany({ where })
          }

          return (context as any).updateMany({
            where,
            data: {
              deleted_at: new Date(),
            },
          })
        },
      },
    },
  })

/**
 * Decide o `where` final de uma leitura. Extraida da extension porque
 * `Prisma.defineExtension` devolve uma FUNCAO `(client) => client.$extends(config)` — o
 * objeto de configuracao nao fica acessivel, entao testar a regra exigiria alcancar as
 * entranhas do Prisma. Como funcao nomeada, a regra e verificavel direto.
 */
export function aplicarFiltroSoftDelete(model: string | undefined, operation: string, args: any): any {
  const eLeitura =
    operation === 'findUnique' || operation === 'findFirst' || operation === 'findMany'

  if (!eLeitura || !temSoftDelete(model)) return args

  return { ...args, where: { ...args?.where, deleted_at: null } }
}

/** Filtra linhas soft-deletadas — SO nos models que tem a coluna. */
export const filterSoftDeleted = Prisma.defineExtension({
  name: 'filterSoftDeleted',
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        return query(aplicarFiltroSoftDelete(model, operation, args))
      },
    },
  },
})
