import { Module } from '@nestjs/common'
import { PgModule } from '../pilot/pg.module'
import { PgService } from '../pilot/pg.service'
import { PanelAuthController } from './panel-auth.controller'
import { PanelAuthService } from './panel-auth.service'

@Module({
  imports: [PgModule],
  controllers: [PanelAuthController],
  providers: [
    { provide: PanelAuthService, useFactory: (pg: PgService) => new PanelAuthService(pg), inject: [PgService] },
  ],
  exports: [PanelAuthService],
})
export class PanelAuthModule {}
