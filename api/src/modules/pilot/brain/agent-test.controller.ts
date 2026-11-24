import { Body, Controller, HttpCode, Post } from '@nestjs/common'
import { Type } from 'class-transformer'
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, ValidateNested } from 'class-validator'
import { NoTenant } from '../../auth/no-tenant.decorator'
import { Roles } from '../../panel-auth/roles.decorator'
import { ShadowService } from '../shadow.service'

class TurnDto {
  @IsIn(['lead', 'agente']) author!: 'lead' | 'agente'
  @IsString() @MaxLength(1500) body!: string
}

export class AgentTestDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => TurnDto) messages!: TurnDto[]
  /** Versão do playbook a testar (rascunho ou ativa). Sem ela, usa a ativa. */
  @IsOptional() @IsInt() @Min(1) @Max(1_000_000) version?: number
}

/** Conversa de teste do painel: nada é gravado nem enviado. Gerente ou dono. */
@Controller('pilot/agent')
@NoTenant()
export class AgentTestController {
  constructor(private readonly shadow: ShadowService) {}

  @Roles('manager') @Post('test') @HttpCode(200)
  test(@Body() dto: AgentTestDto) {
    return this.shadow.simulate(dto.messages, dto.version)
  }
}
