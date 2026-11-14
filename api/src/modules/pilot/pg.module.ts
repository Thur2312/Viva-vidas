import { Module } from '@nestjs/common'
import { PgService } from './pg.service'

/**
 * Unico dono do pool de conexoes (PgService). Antes, Auth, PanelAuth, Pilot e Voice declaravam cada um o seu
 * PgService, e a API abria ate 4 pools de 5 conexoes. O Nest instancia um modulo uma unica vez, entao todo modulo
 * que importa PgModule compartilha a MESMA instancia (e o mesmo pool).
 *
 * Nao declare PgService em `providers` de outro modulo: isso cria um pool a mais.
 * O teste pg.module.spec.ts falha se isso acontecer.
 */
@Module({
  providers: [PgService],
  exports: [PgService],
})
export class PgModule {}
