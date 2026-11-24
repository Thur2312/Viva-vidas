import { Body, Controller, Get, Param, Put, Req } from '@nestjs/common'
import { IsString, MaxLength } from 'class-validator'
import { NoTenant } from '../../auth/no-tenant.decorator'
import { Roles } from '../../panel-auth/roles.decorator'
import { requestCtx } from '../compliance/audit.service'
import { SecretsService } from './secrets.service'

export class SetSecretDto {
  /** Valor vazio remove a chave do painel. Validado a fundo no serviço. */
  @IsString() @MaxLength(500) value!: string
}

/** Chaves de integração cadastradas pelo painel. Leitura: manager. Troca e remoção: owner. */
@Controller('pilot/config')
@NoTenant()
export class ConfigController {
  constructor(private readonly secrets: SecretsService) {}

  @Roles('manager') @Get('secrets')
  listSecrets() {
    return this.secrets.list()
  }

  @Roles('owner') @Put('secrets/:name')
  putSecret(@Param('name') name: string, @Body() dto: SetSecretDto, @Req() req: any) {
    const ctx = requestCtx(req)
    return dto.value.trim() === '' ? this.secrets.remove(name, ctx) : this.secrets.set(name, dto.value, ctx)
  }
}
