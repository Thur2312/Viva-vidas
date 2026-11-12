import { IsArray, IsIn, IsInt, IsNumber, IsObject, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateNested } from 'class-validator'
import { Type } from 'class-transformer'
import { ConsentDto } from './compliance/compliance.dto'

export class IngestMessageDto {
  @IsString() @MaxLength(32) phone!: string
  @IsOptional() @IsString() @MaxLength(120) name?: string
  @IsIn(['in', 'out']) direction!: 'in' | 'out'
  @IsIn(['lead', 'humano', 'agente']) author!: 'lead' | 'humano' | 'agente'
  @IsString() @MaxLength(4096) body!: string
  @IsOptional() @IsString() @MaxLength(200) wid?: string
  @IsOptional() @IsObject() source?: Record<string, unknown>
  @IsOptional() @IsString() @MaxLength(200) externalRef?: string
  @IsOptional() @IsString() @MaxLength(200) optInOrigin?: string
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => ConsentDto) consents?: ConsentDto[]
}

export class CreateLeadDto {
  @IsString() @MaxLength(32) phone!: string
  @IsOptional() @IsString() @MaxLength(120) name?: string
  @IsOptional() @IsObject() source?: Record<string, unknown>
  @IsOptional() @IsString() @MaxLength(200) optInOrigin?: string
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => ConsentDto) consents?: ConsentDto[]
}

export class EventDto {
  @IsString() @MaxLength(32) phone!: string
  @IsIn(['contatado', 'respondeu', 'qualificado', 'reuniao_marcada', 'compareceu', 'venda', 'perdido', 'opt_out'])
  type!: 'contatado' | 'respondeu' | 'qualificado' | 'reuniao_marcada' | 'compareceu' | 'venda' | 'perdido' | 'opt_out'
  @IsOptional() @IsNumber() @Min(0) value?: number
  @IsOptional() @IsIn(['humano', 'agente', 'sistema']) actor?: 'humano' | 'agente' | 'sistema'
  @IsOptional() @IsObject() payload?: Record<string, unknown>
}

export class QualificationDto {
  @IsOptional() @IsInt() @Min(0) @Max(100) score?: number
  @IsOptional() @IsObject() qualification?: Record<string, unknown>
}

export class ShadowRunDto {
  @IsUUID() conversationId!: string
}

export class ListLeadsQuery {
  @IsOptional() @IsString() stage?: string
  @IsOptional() @IsString() @MaxLength(80) search?: string
  @IsOptional() @IsString() campaignId?: string
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize?: number
}

export class PeriodQuery {
  @IsOptional() @IsString() from?: string
  @IsOptional() @IsString() to?: string
}

