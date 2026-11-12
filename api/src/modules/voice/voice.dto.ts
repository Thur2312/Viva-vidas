import { IsBoolean, IsIn, IsISO8601, IsInt, IsObject, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator'
import { Type } from 'class-transformer'
import { CallWindow } from './voice.config'
import { CALL_STATUSES } from './voice.types'

export class PlaceCallDto {
  @IsUUID() leadId!: string
}

export class ListCallsQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize?: number
  @IsOptional() @IsUUID() leadId?: string
  @IsOptional() @IsIn(CALL_STATUSES as unknown as string[]) status?: string
  @IsOptional() @IsISO8601() from?: string
  @IsOptional() @IsISO8601() to?: string
}

export class UpdateSettingsDto {
  /** Validado a fundo no serviço (isValidWindow). */
  @IsOptional() @IsObject() callWindow?: CallWindow
  @IsOptional() @IsBoolean() dncEnabled?: boolean
  @IsOptional() @IsString() @MaxLength(600) announcementText?: string | null
}
