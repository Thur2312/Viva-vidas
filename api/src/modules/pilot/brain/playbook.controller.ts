import { BadRequestException, Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, Put, Req } from '@nestjs/common'
import { NoTenant } from '../../auth/no-tenant.decorator'
import { Roles } from '../../panel-auth/roles.decorator'
import { requestCtx } from '../compliance/audit.service'
import { CreatePlaybookDto, UpdatePlaybookDto } from './playbook.dto'
import { PlaybookService } from './playbook.service'

function positive(n: number): number {
  if (!Number.isSafeInteger(n) || n < 1) throw new BadRequestException('Versão inválida')
  return n
}

/** Versões do playbook de vendas. Leitura: viewer. Edição e ativação: owner (checado aqui, no servidor). */
@Controller('pilot/playbook')
export class PlaybookController {
  constructor(private readonly playbooks: PlaybookService) {}

  @NoTenant() @Roles('viewer') @Get()
  overview() {
    return this.playbooks.overview()
  }

  @NoTenant() @Roles('viewer') @Get(':version')
  get(@Param('version', ParseIntPipe) version: number) {
    return this.playbooks.get(positive(version))
  }

  @NoTenant() @Roles('owner') @Post()
  create(@Body() dto: CreatePlaybookDto, @Req() req: any) {
    return this.playbooks.create(dto, requestCtx(req))
  }

  @NoTenant() @Roles('owner') @Put(':version')
  update(@Param('version', ParseIntPipe) version: number, @Body() dto: UpdatePlaybookDto, @Req() req: any) {
    return this.playbooks.update(positive(version), dto, requestCtx(req))
  }

  @NoTenant() @Roles('owner') @Post(':version/activate') @HttpCode(200)
  activate(@Param('version', ParseIntPipe) version: number, @Req() req: any) {
    return this.playbooks.activate(positive(version), requestCtx(req))
  }
}
