import { Module } from '@nestjs/common'
import { PassportModule } from '@nestjs/passport'
import { PgService } from '../pilot/pg.service'
import { SessionStateService } from '../panel-auth/session-state.service'
import { JwtStrategy } from './jwt.strategy'

// Registra a estrategia 'jwt' (ver jwt.strategy.ts). Sem login/refresh/RBAC do HDM: isso vive em `panel-auth`.
// Tem o proprio PgService (padrao do projeto: cada modulo cria o seu) para conferir o usuario no banco.
@Module({
  imports: [PassportModule],
  providers: [
    PgService,
    { provide: SessionStateService, useFactory: (pg: PgService) => new SessionStateService(pg), inject: [PgService] },
    JwtStrategy,
  ],
})
export class AuthModule {}
