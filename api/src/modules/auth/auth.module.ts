import { Module } from '@nestjs/common'
import { PassportModule } from '@nestjs/passport'
import { JwtStrategy } from './jwt.strategy'

// STUB: so registra a estrategia 'jwt' (ver jwt.strategy.ts). Sem login/refresh/RBAC do HDM.
@Module({
  imports: [PassportModule],
  providers: [JwtStrategy],
})
export class AuthModule {}
