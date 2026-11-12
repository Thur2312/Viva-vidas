import { IsArray, IsIn, IsObject, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator'
import { Type } from 'class-transformer'
import { LEGAL_BASES, LegalBasis, PURPOSES, Purpose } from './consent.service'

export class ConsentDto {
  @IsIn(PURPOSES as unknown as string[]) purpose!: Purpose
  @IsOptional() @IsIn(LEGAL_BASES as unknown as string[]) legalBasis?: LegalBasis
  @IsOptional() @IsString() @MaxLength(60) textVersion?: string
  @IsOptional() @IsString() @MaxLength(200) source?: string
}

export class ConsentsField {
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => ConsentDto) consents?: ConsentDto[]
}

export class RevokeConsentDto {
  @IsIn(PURPOSES as unknown as string[]) purpose!: Purpose
}

export class CorrectLeadDto {
  @IsOptional() @IsString() @MaxLength(120) name?: string
  @IsOptional() @IsString() @MaxLength(32) phone?: string
  @IsOptional() @IsObject() qualification?: Record<string, unknown>
}
