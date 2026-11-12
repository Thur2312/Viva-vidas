import { ArgumentMetadata, PipeTransform, ValidationPipe, ValidationPipeOptions } from '@nestjs/common'
import { isFreeFormDto } from './free-form-dto.decorator'

/**
 * ValidationPipe global do hdm-api.
 *
 * - DTO com decorators do `class-validator`: `whitelist: true` (remove campos fora do DTO, defesa
 *   contra mass assignment, API-04).
 * - DTO marcado com `@FreeFormDto()`: sem `whitelist`, todos os campos chegam ao controller.
 * - `whitelistEnabled = false` (kill-switch `VALIDATION_WHITELIST_DISABLED=true`): sem `whitelist`
 *   em nenhum DTO, comportamento anterior à API-04.
 *
 * Os demais comportamentos (`transform`, validação) são os do `ValidationPipe` padrão.
 */
export class HdmValidationPipe implements PipeTransform {
  private readonly strict: ValidationPipe
  private readonly loose: ValidationPipe

  constructor(
    options: ValidationPipeOptions = {},
    private readonly whitelistEnabled: boolean = true,
  ) {
    this.strict = new ValidationPipe({ ...options, whitelist: true })
    this.loose = new ValidationPipe({ ...options, whitelist: false })
  }

  transform(value: unknown, metadata: ArgumentMetadata): Promise<unknown> {
    const useWhitelist = this.whitelistEnabled && !isFreeFormDto(metadata.metatype)
    return (useWhitelist ? this.strict : this.loose).transform(value, metadata)
  }
}
