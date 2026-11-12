import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { MinioStorageAdapter } from './storage/storage-adapter'
import { FileStorageService } from './storage/file-storage.service'

// TRIMMED: sem controller, cron de limpeza, cota de storage nem MailModule.
@Module({
  imports: [ConfigModule],
  providers: [MinioStorageAdapter, FileStorageService],
  exports: [FileStorageService, MinioStorageAdapter],
})
export class FilesModule {}
