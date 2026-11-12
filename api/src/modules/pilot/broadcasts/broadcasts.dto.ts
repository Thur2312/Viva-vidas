import { Type } from 'class-transformer'
import {
  IsArray, IsBoolean, IsIn, IsInt, IsISO8601, IsObject, IsOptional, IsString, Matches, Max, MaxLength, Min, ValidateNested, IsNumber,
} from 'class-validator'

const HHMM = /^([01][0-9]|2[0-3]):[0-5][0-9]$/

class BroadcastFieldsDto {
  @IsOptional() @IsString() @MaxLength(500) objective?: string
  @IsOptional() @IsIn(['template', 'text_in_window']) kind?: 'template' | 'text_in_window'
  @IsOptional() @IsString() @MaxLength(512) templateName?: string
  @IsOptional() @IsString() @MaxLength(10) templateLanguage?: string
  @IsOptional() @IsString() @MaxLength(1024) textBody?: string
  @IsOptional() @IsObject() variablesMap?: Record<string, any>
  @IsOptional() @IsObject() audienceFilter?: Record<string, any>
  @IsOptional() @IsISO8601() scheduledAt?: string | null
  @IsOptional() @Matches(HHMM) windowStart?: string
  @IsOptional() @Matches(HHMM) windowEnd?: string
  @IsOptional() @IsArray() @IsInt({ each: true }) @Min(0, { each: true }) @Max(6, { each: true }) windowDays?: number[]
  @IsOptional() @IsInt() @Min(1) @Max(60) ratePerMinute?: number
  @IsOptional() @IsInt() @Min(1) @Max(1000) dailyCap?: number
  @IsOptional() @IsBoolean() dryRun?: boolean
}

export class BroadcastBodyDto extends BroadcastFieldsDto {
  @IsOptional() @IsString() @MaxLength(120) name?: string
}

export class CreateBroadcastDto extends BroadcastFieldsDto {
  @IsString() @MaxLength(120) name!: string
}

export class PreviewDto {
  @IsOptional() @IsObject() audienceFilter?: Record<string, any>
  @IsOptional() @IsIn(['template', 'text_in_window']) kind?: 'template' | 'text_in_window'
  @IsOptional() @IsString() @MaxLength(512) templateName?: string
  @IsOptional() @IsString() @MaxLength(10) templateLanguage?: string
  @IsOptional() @IsObject() variablesMap?: Record<string, any>
}

export class StartDto {
  @IsBoolean() confirm!: boolean
  @IsInt() @Min(0) expectedRecipients!: number
}

export class RecipientsQuery {
  @IsOptional() @IsIn(['pending', 'queued', 'sent', 'delivered', 'read', 'replied', 'failed', 'skipped']) status?: string
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number
}

class ButtonDto {
  @IsIn(['QUICK_REPLY', 'URL', 'PHONE_NUMBER']) type!: 'QUICK_REPLY' | 'URL' | 'PHONE_NUMBER'
  @IsString() @MaxLength(25) text!: string
  @IsOptional() @IsString() @MaxLength(2000) url?: string
  @IsOptional() @IsString() @MaxLength(20) phone_number?: string
}

export class CreateTemplateDto {
  @IsString() @MaxLength(512) name!: string
  @IsIn(['MARKETING', 'UTILITY']) category!: 'MARKETING' | 'UTILITY'
  @IsOptional() @IsString() @MaxLength(10) language?: string
  @IsString() @MaxLength(1024) bodyText!: string
  @IsOptional() @IsArray() @IsString({ each: true }) @MaxLength(100, { each: true }) bodyExamples?: string[]
  @IsOptional() @IsString() @MaxLength(60) footerText?: string
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => ButtonDto) buttons?: ButtonDto[]
}

export class StatusWebhookDto {
  @IsString() @MaxLength(300) wid!: string
  @IsIn(['delivered', 'read', 'failed']) status!: 'delivered' | 'read' | 'failed'
  @IsOptional() @IsString() @MaxLength(60) errorCode?: string
  @IsOptional() @IsNumber() timestamp?: number
}

export class ResumeDto {
  @IsBoolean() confirm!: boolean
}

export class QualityWebhookDto {
  @IsString() @MaxLength(60) event!: string
  @IsOptional() @IsString() @MaxLength(30) currentLimit?: string
  @IsOptional() @IsString() @MaxLength(40) displayPhoneNumber?: string
}
