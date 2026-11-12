import { PrismaClient } from '@prisma/client'
import { filterSoftDeleted, softDelete, softDeleteMany } from './prisma.extensions'

// Nota: triggerExtension foi substituida por PostgreSQL LISTEN/NOTIFY (PgNotifyListenerService)
// O PG NOTIFY funciona dentro de $transaction, a extension nao funcionava.
export const customPrismaClient = (prismaClient: PrismaClient) => {
  // softDelete/softDeleteMany recebem o client CRU: dentro do override de `delete` nao
  // ha como chamar o `delete` original sem recursao, e models sem `deleted_at` precisam
  // desse escape para fazer a exclusao fisica.
  return prismaClient
    .$extends(softDelete(prismaClient))
    .$extends(softDeleteMany(prismaClient))
    .$extends(filterSoftDeleted)
}

//Our Custom Prisma Client with the client set to the customPrismaClient with extension
export class PrismaClientExtended extends PrismaClient {
  customPrismaClient: CustomPrismaClient

  get client() {
    if (!this.customPrismaClient) this.customPrismaClient = customPrismaClient(this)

    return this.customPrismaClient
  }
}

//Create a type to our funtion
export type CustomPrismaClient = ReturnType<typeof customPrismaClient>
