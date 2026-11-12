import { ServiceUnavailableException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { S3Client } from '@aws-sdk/client-s3'

/**
 * Fonte única da configuração do MinIO.
 *
 * POR QUE EXISTE
 * A config do storage era lida em 7 lugares, em 4 estilos diferentes: uns com `process.env`
 * cru sem default, outros com `ConfigService` e default só em alguns campos. Com o `.env` de
 * dev vazio, `DocumentsService` montava o S3Client com `endpoint: ''` — o SDK então ignora o
 * MinIO e vai para o S3 real da Amazon — e credencial vazia, e gerar proposta devolvia 500 com
 * `AuthorizationHeaderMalformed`. Nada no boot avisava; o erro só aparecia no request, já
 * traduzido para um 500 genérico.
 *
 * DUAS DECISÕES QUE VALEM EXPLICAÇÃO
 *
 * 1. String vazia é tratada como AUSENTE, não como valor. Foi exatamente esse o buraco:
 *    `KEY=` no .env vira `''`, que passa por qualquer checagem de `undefined` e só quebra lá
 *    na frente, dentro do SDK.
 *
 * 2. `endpoint` NÃO tem default, ao contrário de `bucket` e `region`. Antes, dois arquivos
 *    caíam em `https://files.hdmfy.com` (produção) quando a variável faltava — ou seja, um
 *    .env incompleto em dev escrevia no bucket de PRODUÇÃO em silêncio. Errar alto é melhor:
 *    sem endpoint, `assertStorageConfigured` derruba a operação dizendo qual variável falta.
 *    A única exceção é `buildPublicUrl`, que só monta URL de exibição e nunca escreve nada.
 */

// Sem default: bucket/endpoint vem SEMPRE do ambiente (nada de nome de producao do HDM embutido).
export const DEFAULT_STORAGE_BUCKET = ''
export const DEFAULT_STORAGE_REGION = 'us-east-1'

/**
 * Usado SÓ para montar URL de leitura quando o endpoint não está configurado (imagem em
 * template de e-mail). Nunca é destino de escrita — para isso vale `assertStorageConfigured`.
 */
export const PUBLIC_ASSET_FALLBACK_ENDPOINT = ''

export interface StorageConfig {
  /** Vazio quando não configurado. Ver decisão 2 no cabeçalho. */
  endpoint: string
  bucket: string
  region: string
  accessKeyId: string
  secretAccessKey: string
  publicAccess: boolean
}

/** Campos sem os quais nenhuma operação de storage funciona. */
const REQUIRED_FIELDS = ['endpoint', 'bucket', 'accessKeyId', 'secretAccessKey'] as const

/** Para a mensagem de erro citar o nome que o dev precisa preencher no .env. */
const ENV_VAR: Record<(typeof REQUIRED_FIELDS)[number], string> = {
  endpoint: 'MINIO_PUBLIC_ENDPOINT',
  bucket: 'MINIO_BUCKET_NAME',
  accessKeyId: 'MINIO_ROOT_USER',
  secretAccessKey: 'MINIO_ROOT_PASSWORD',
}

/**
 * Lê do ConfigService quando há injeção disponível, senão de `process.env` — scripts de
 * `scripts/` e o `multer-config` não vivem dentro do container do Nest.
 */
function readEnv(key: string, configService?: ConfigService): string {
  const value = configService?.get<string>(key) ?? process.env[key]
  return typeof value === 'string' ? value.trim() : ''
}

function parseBoolean(raw: string, fallback: boolean): boolean {
  if (raw === '') return fallback
  return !['false', '0', 'no', 'off'].includes(raw.toLowerCase())
}

export function getStorageConfig(configService?: ConfigService): StorageConfig {
  return {
    endpoint: readEnv('MINIO_PUBLIC_ENDPOINT', configService),
    bucket: readEnv('MINIO_BUCKET_NAME', configService) || DEFAULT_STORAGE_BUCKET,
    region: readEnv('MINIO_REGION', configService) || DEFAULT_STORAGE_REGION,
    accessKeyId: readEnv('MINIO_ROOT_USER', configService),
    secretAccessKey: readEnv('MINIO_ROOT_PASSWORD', configService),
    // Default `true` preserva o comportamento histórico, mas agora um `false` explícito é
    // respeitado — antes era `configService.get(...) || true`, que é sempre true.
    publicAccess: parseBoolean(readEnv('MINIO_PUBLIC_ACCESS', configService), true),
  }
}

/** Nomes das variáveis de ambiente que faltam. Vazio = configuração completa. */
export function describeMissingStorageConfig(config: StorageConfig): string[] {
  return REQUIRED_FIELDS.filter(field => !config[field]).map(field => ENV_VAR[field])
}

/**
 * Barra a operação com 503 e diz o que preencher, em vez de deixar o AWS SDK falhar lá
 * dentro com `AuthorizationHeaderMalformed` embrulhado num 500 genérico.
 */
export function assertStorageConfigured(config: StorageConfig, operation = 'Operação de storage'): void {
  const missing = describeMissingStorageConfig(config)
  if (missing.length === 0) return

  throw new ServiceUnavailableException(`${operation} indisponível: storage não configurado. Preencha ${missing.join(', ')} no .env da API e reinicie o processo.`)
}

export function createStorageClient(config: StorageConfig): S3Client {
  return new S3Client({
    region: config.region,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    endpoint: config.endpoint || undefined,
    forcePathStyle: true, // Necessário para MinIO
  })
}

/** Remove a porta 443 explícita para que o endpoint do .env e o de uma URL gravada casem. */
export function normalizeEndpoint(endpoint: string): string {
  return (endpoint || '').replace(':443', '')
}

export function buildPublicUrl(config: StorageConfig, key: string): string {
  const base = (config.endpoint || PUBLIC_ASSET_FALLBACK_ENDPOINT).replace(/\/+$/, '')
  return `${base}/${config.bucket}/${key}`
}
