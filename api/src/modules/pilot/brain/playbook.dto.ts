import { IsInt, IsObject, IsOptional, IsString, Min, MaxLength, registerDecorator, ValidationOptions } from 'class-validator'
import { PlaybookData } from './types'

export const PLAYBOOK_MAX_BYTES = 200 * 1024

/** Rejeita (400) objeto cujo JSON passe do limite. */
function MaxJsonBytes(max: number, options?: ValidationOptions) {
  return (target: object, propertyName: string) =>
    registerDecorator({
      name: 'maxJsonBytes',
      target: target.constructor,
      propertyName,
      options: { message: `${propertyName} excede ${Math.round(max / 1024)} KB`, ...options },
      validator: {
        validate: (v: unknown) => {
          try { return Buffer.byteLength(JSON.stringify(v) ?? '', 'utf8') <= max } catch { return false }
        },
      },
    })
}

export class CreatePlaybookDto {
  @IsOptional() @IsObject() @MaxJsonBytes(PLAYBOOK_MAX_BYTES) data?: PlaybookData
  @IsOptional() @IsString() @MaxLength(500) notes?: string
  @IsOptional() @IsInt() @Min(1) fromVersion?: number
}

export class UpdatePlaybookDto {
  @IsOptional() @IsObject() @MaxJsonBytes(PLAYBOOK_MAX_BYTES) data?: PlaybookData
  @IsOptional() @IsString() @MaxLength(500) notes?: string
}
