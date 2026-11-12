import { Global, Module } from '@nestjs/common'
import { PrismaService } from './prisma.service'

// STUB/TRIMMED: o original tambem registrava PgNotify listener/backfill, emitters e
// ContextBuilderService (sistema de triggers do HDM). Aqui so o PrismaService.
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class DatabaseModule {}
