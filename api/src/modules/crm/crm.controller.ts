import { Controller, Get, Post, Req } from '@nestjs/common'
import { NoTenant } from '../auth/no-tenant.decorator'
import { Roles } from '../panel-auth/roles.decorator'
import { requestCtx } from '../pilot/compliance/audit.service'
import { CrmService } from './crm.service'

/** Painel do CRM (JWT). Status: qualquer papel. Reenviar o que falhou: so o dono. */
@Controller('pilot/crm')
export class CrmController {
  constructor(private readonly crm: CrmService) {}

  @NoTenant() @Roles('viewer') @Get('status')
  status() { return this.crm.status() }

  @NoTenant() @Roles('owner') @Post('retry-dead')
  retry(@Req() req: any) { return this.crm.retryDead(requestCtx(req)) }
}
