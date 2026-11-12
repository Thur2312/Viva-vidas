import { IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, MinLength, Min } from 'class-validator'
import { Type } from 'class-transformer'

export const CONV_MODES = ['shadow', 'assisted', 'auto'] as const
// aguardando = última mensagem é do lead | respondida = última é da equipe/agente | rascunho = agente tem rascunho pendente
export const CONV_STATUS = ['aguardando', 'respondida', 'rascunho'] as const
export const CONV_STAGES = ['contatado', 'respondeu', 'qualificado', 'reuniao', 'compareceu', 'venda', 'perdido'] as const

export class ListConversationsQuery {
  @IsOptional() @IsString() @MaxLength(80) search?: string
  @IsOptional() @IsIn(CONV_MODES as unknown as string[]) mode?: (typeof CONV_MODES)[number]
  @IsOptional() @IsIn(CONV_STATUS as unknown as string[]) status?: (typeof CONV_STATUS)[number]
  @IsOptional() @IsIn(CONV_STAGES as unknown as string[]) stage?: (typeof CONV_STAGES)[number]
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(10000) page?: number
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) pageSize?: number
  /** Abre a conversa de um lead (usado pela gaveta do funil). */
  @IsOptional() @Matches(/^[0-9a-fA-F-]{36}$/) leadId?: string
}

export class MessagesQuery {
  @IsOptional() @Matches(/^\d{1,18}$/) before?: string
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number
}

const DATE = /^\d{4}-\d{2}-\d{2}(T[\d:.+\-Zz]+)?$/
export class StatsQuery {
  @IsOptional() @Matches(DATE) from?: string
  @IsOptional() @Matches(DATE) to?: string
}

export class SendMessageDto {
  @IsString() @MinLength(1) @MaxLength(4096) body!: string
}
