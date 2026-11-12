import { Transform, Type } from 'class-transformer'
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator'

const toArray = ({ value }: { value: unknown }): string[] | undefined => {
  if (value === undefined || value === null || value === '') return undefined
  if (Array.isArray(value)) return value.map((v) => String(v)).filter(Boolean)
  return String(value)
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean)
}

const toBoolean = ({ value }: { value: unknown }): boolean | undefined => {
  if (value === undefined || value === null || value === '') return undefined
  return value === true || value === 'true' || value === '1'
}

export class FilterTrackingEventsDto {
  @IsOptional()
  @IsDateString()
  startDate?: string

  @IsOptional()
  @IsDateString()
  endDate?: string

  @IsOptional()
  @Transform(toArray)
  @IsArray()
  @IsString({ each: true })
  events?: string[]

  @IsOptional()
  @Transform(toArray)
  @IsArray()
  @IsString({ each: true })
  campaignIds?: string[]

  @IsOptional()
  @IsString()
  urlSearch?: string

  @IsOptional()
  @IsString()
  utmSource?: string

  @IsOptional()
  @IsString()
  utmMedium?: string

  @IsOptional()
  @IsString()
  utmCampaign?: string

  @IsOptional()
  @IsUUID()
  visitorId?: string

  @IsOptional()
  @IsUUID()
  sessionId?: string

  @IsOptional()
  @IsString()
  formEmail?: string

  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  identifiedOnly?: boolean

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number = 25
}
