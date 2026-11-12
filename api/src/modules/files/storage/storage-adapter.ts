import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { S3Client, PutObjectCommand, DeleteObjectCommand, ListObjectsV2Command, HeadObjectCommand } from '@aws-sdk/client-s3'
import { extname } from 'path'
import { IStorageAdapter, FileUploadInput, FileUploadResult } from './file-storage.types'
import { assertStorageConfigured, buildPublicUrl, createStorageClient, getStorageConfig, normalizeEndpoint, StorageConfig } from '../config/storage.config'

@Injectable()
export class MinioStorageAdapter implements IStorageAdapter {
  private readonly s3: S3Client
  private readonly storage: StorageConfig
  private readonly bucketName: string
  private readonly publicEndpoint: string
  private readonly logger = new Logger(MinioStorageAdapter.name)

  constructor(private readonly configService: ConfigService) {
    this.storage = getStorageConfig(this.configService)
    this.bucketName = this.storage.bucket
    this.publicEndpoint = this.storage.endpoint
    this.s3 = createStorageClient(this.storage)
  }

  async upload(input: FileUploadInput): Promise<FileUploadResult> {
    assertStorageConfigured(this.storage, 'Upload de arquivo')

    const key = input.key ?? this.generateKey(input.originalName)
    const body = input.stream ?? input.buffer
    const fileSize = input.size ?? input.buffer?.length ?? 0

    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucketName,
        Key: key,
        Body: body,
        ACL: 'public-read',
        ContentType: input.contentType,
      }),
    )

    return {
      key,
      url: this.getPublicUrl(key),
      fileSizeBytes: fileSize,
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await this.s3.send(
        new DeleteObjectCommand({
          Bucket: this.bucketName,
          Key: key,
        }),
      )
    } catch (error) {
      this.logger.warn(`Falha ao deletar objeto do storage: ${key} — ${error.message}`)
    }
  }

  async listObjects(prefix?: string): Promise<string[]> {
    const keys: string[] = []
    let continuationToken: string | undefined

    do {
      const result = await this.s3.send(
        new ListObjectsV2Command({
          Bucket: this.bucketName,
          Prefix: prefix,
          ContinuationToken: continuationToken,
          MaxKeys: 1000,
        }),
      )

      if (result.Contents) {
        keys.push(...result.Contents.map(obj => obj.Key).filter(Boolean))
      }

      continuationToken = result.IsTruncated ? result.NextContinuationToken : undefined
    } while (continuationToken)

    return keys
  }

  async headObject(key: string): Promise<{ sizeBytes: number } | null> {
    try {
      const result = await this.s3.send(
        new HeadObjectCommand({
          Bucket: this.bucketName,
          Key: key,
        }),
      )
      return { sizeBytes: result.ContentLength ?? 0 }
    } catch {
      return null
    }
  }

  /**
   * Obtem o tamanho de um arquivo a partir da URL completa.
   * Usa ListObjectsV2 (que retorna Size) em vez de HeadObject (que pode nao retornar ContentLength em alguns MinIO).
   * Ex: "https://files.hdmfy.com/hdm-arquivos/abc.pdf" → endpoint=files.hdmfy.com, bucket=hdm-arquivos, key=abc.pdf
   */
  async getFileSizeByUrl(url: string): Promise<{ sizeBytes: number } | null> {
    try {
      const parsed = new URL(url)
      const pathParts = parsed.pathname.split('/').filter(Boolean)
      if (pathParts.length < 2) return null

      const bucket = pathParts[0]
      const key = pathParts.slice(1).join('/')
      const endpoint = `${parsed.protocol}//${parsed.host}`

      const client = this.getClientForEndpoint(endpoint)

      const result = await client.send(
        new ListObjectsV2Command({ Bucket: bucket, Prefix: key, MaxKeys: 1 }),
      )

      const obj = result.Contents?.[0]
      if (obj && obj.Key === key && obj.Size != null) {
        return { sizeBytes: obj.Size }
      }
      return null
    } catch (error) {
      this.logger.warn(`[GetFileSize] Falha: ${error.message} — URL: ${url}`)
      return null
    }
  }

  private clientCache = new Map<string, S3Client>()

  private getClientForEndpoint(endpoint: string): S3Client {
    // Normalizar endpoint (remover porta default 443 para HTTPS).
    // `normalizeEndpoint` tolera vazio: antes, com MINIO_PUBLIC_ENDPOINT em branco,
    // `this.publicEndpoint.replace(...)` estourava TypeError em undefined.
    const normalized = normalizeEndpoint(endpoint)
    const configNormalized = normalizeEndpoint(this.publicEndpoint)

    if (normalized === configNormalized) return this.s3

    if (this.clientCache.has(normalized)) return this.clientCache.get(normalized)

    const client = createStorageClient({ ...this.storage, endpoint: normalized })
    this.clientCache.set(normalized, client)
    return client
  }

  getPublicUrl(key: string): string {
    return buildPublicUrl(this.storage, key)
  }

  private generateKey(originalName: string): string {
    return Date.now() + '-' + Math.round(Math.random() * 1e9) + extname(originalName)
  }
}
