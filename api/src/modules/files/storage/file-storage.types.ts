import { Readable } from 'stream'

export interface FileUploadInput {
  buffer?: Buffer
  stream?: Readable
  originalName: string
  contentType?: string
  key?: string
  size?: number
}

export interface FileUploadResult {
  key: string
  url: string
  fileSizeBytes: number
}

export interface TrackedUploadOptions {
  companyId: string
  organizationId: string
  name: string
  fileType: string
  tags?: string[]
  remark?: string
  uploaderUserId?: string
  uploaderName?: string
  uploaderEmail?: string
  uploaderIp?: string
}

export interface TrackedDeleteOptions {
  companyId: string
}

export interface IStorageAdapter {
  upload(input: FileUploadInput): Promise<FileUploadResult>
  delete(key: string): Promise<void>
  getPublicUrl(key: string): string
  listObjects(prefix?: string): Promise<string[]>
}
