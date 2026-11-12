import { Module } from '@nestjs/common'
import { PgService } from '../pilot/pg.service'
import { PanelAuthController } from './panel-auth.controller'
import { PanelAuthService } from './panel-auth.service'

@Module({
  controllers: [PanelAuthController],
  providers: [
    PgService,
    { provide: PanelAuthService, useFactory: (pg: PgService) => new PanelAuthService(pg), inject: [PgService] },
  ],
  exports: [PanelAuthService],
})
export class PanelAuthModule {}
