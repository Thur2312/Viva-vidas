import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common'
import { MinioStorageAdapter } from './storage-adapter'
import { FileUploadInput, FileUploadResult } from './file-storage.types'

/**
 * TRIMMED: so o `upload` simples (usado pelo meta-ads para re-hospedar thumbnails).
 * Removidos: uploadTrackedDocument, cota, OrganizationDocuments/Proposals do HDM.
 */
@Injectable()
export class FileStorageService {
  private readonly logger = new Logger(FileStorageService.name)

  constructor(private readonly storage: MinioStorageAdapter) {}

  async upload(input: FileUploadInput): Promise<FileUploadResult> {
    try {
      return await this.storage.upload(input)
    } catch (error) {
      this.logger.error(`Upload falhou: ${error.message}`, error.stack)
      throw new HttpException(
        `Erro ao fazer upload do arquivo: ${error.message || 'Erro desconhecido'}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      )
    }
  }
}
