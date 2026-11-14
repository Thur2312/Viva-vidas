import { Module } from '@nestjs/common'
import { PassportModule } from '@nestjs/passport'
import { PgModule } from '../pilot/pg.module'
import { PgService } from '../pilot/pg.service'
import { SessionStateService } from '../panel-auth/session-state.service'
import { JwtStrategy } from './jwt.strategy'

// Registra a estrategia 'jwt' (ver jwt.strategy.ts). Sem login/refresh/RBAC do HDM: isso vive em `panel-auth`.
// Usa o PgService compartilhado (PgModule, um unico pool) para conferir o usuario no banco.
@Module({
  imports: [PassportModule, PgModule],
  providers: [
    { provide: SessionStateService, useFactory: (pg: PgService) => new SessionStateService(pg), inject: [PgService] },
    JwtStrategy,
  ],
})
export class AuthModule {}
