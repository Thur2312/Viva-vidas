import { Body, Controller, HttpCode, Post, ServiceUnavailableException } from '@nestjs/common'
import { IsString, MaxLength } from 'class-validator'
import { NoTenant } from '../../auth/no-tenant.decorator'
import { Roles } from '../../panel-auth/roles.decorator'
import { ShadowService } from '../shadow.service'
import { LlmError } from './llm'
import { checkPdfBase64 } from './playbook-import'

export class ImportPdfDto {
  /** PDF em base64 (até ~2,5 MB). Validado a fundo em checkPdfBase64. */
  @IsString() @MaxLength(3_500_000) data!: string
}

/** Converte um PDF em Markdown para o dono revisar no editor. Não grava nada. */
@Controller('pilot/playbook')
@NoTenant()
export class PlaybookImportController {
  constructor(private readonly shadow: ShadowService) {}

  @Roles('owner') @Post('import-pdf') @HttpCode(200)
  async importPdf(@Body() dto: ImportPdfDto) {
    const b64 = checkPdfBase64(dto.data)
    try {
      return { markdown: await this.shadow.importPdf(b64) }
    } catch (e) {
      if (e instanceof LlmError) {
        if (e.code === 'disabled') {
          throw new ServiceUnavailableException({ code: 'ia_desligada', message: 'A IA está desligada: cadastre a chave do provedor em "Chaves e integrações".' })
        }
        throw new ServiceUnavailableException({ code: 'ia_indisponivel', message: 'O provedor de IA não respondeu a tempo. Tente de novo.' })
      }
      throw e
    }
  }
}
