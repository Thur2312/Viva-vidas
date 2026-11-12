import { Type } from 'class-transformer'
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator'

/**
 * Uma linha do catalogo: o que a acao `action` vira quando chega na Meta.
 *
 * `metaEventName` e `eventValue` NAO sao validados aqui com regex/range: quem
 * decide o que e valido e `sanitizeEventName()` / `normalizeEventValue()` do
 * modulo de trigger, que ja e a fonte da verdade da normalizacao Meta e trata
 * caixa, acento, teto de 50 caracteres e virgula decimal. Duplicar a regra num
 * decorator faria as duas camadas divergirem no primeiro ajuste.
 */
export class TrackingActionConfigItemDto {
  /** Valor cru de `Tracking.action`. O service baixa a caixa antes de gravar. */
  @IsString()
  @MaxLength(200)
  action: string

  @IsOptional()
  @IsString()
  @MaxLength(120)
  label?: string | null

  @IsOptional()
  @IsString()
  @MaxLength(200)
  metaEventName?: string | null

  /** Aceita numero ou string (o input do formulario manda texto, com virgula). */
  @IsOptional()
  eventValue?: number | string | null

  @IsOptional()
  @IsBoolean()
  isActive?: boolean
}

export class UpsertTrackingActionConfigDto {
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => TrackingActionConfigItemDto)
  items: TrackingActionConfigItemDto[]
}
