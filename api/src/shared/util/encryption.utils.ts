import * as crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

function getEncryptionKey(): Buffer {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) {
    throw new Error('ENCRYPTION_KEY environment variable is not set');
  }
  // Garante que a chave tenha 32 bytes (256 bits) para AES-256
  return crypto.createHash('sha256').update(key).digest();
}

export function encrypt(text: string): string {
  if (!text) return text;

  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const authTag = cipher.getAuthTag();

  // Formato: iv:authTag:encryptedData (tudo em hex)
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

export function decrypt(encryptedText: string): string {
  if (!encryptedText) return encryptedText;

  // Verifica se o texto está no formato criptografado (iv:authTag:data)
  if (!encryptedText.includes(':')) {
    // Retorna o texto original se não estiver criptografado (compatibilidade com dados antigos)
    return encryptedText;
  }

  try {
    const key = getEncryptionKey();
    const [ivHex, authTagHex, encrypted] = encryptedText.split(':');

    if (!ivHex || !authTagHex || !encrypted) {
      // Formato inválido, retorna o texto original
      return encryptedText;
    }

    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  } catch (error) {
    // Se falhar ao descriptografar, retorna o texto original (pode ser dado antigo não criptografado)
    console.warn('Failed to decrypt, returning original text:', error.message);
    return encryptedText;
  }
}

/**
 * O valor está no envelope `iv:authTag:ciphertext` (hex) que `encrypt` produz?
 *
 * Serve para o chamador detectar decriptação FALHA. `decrypt` devolve a entrada
 * intacta quando não consegue abrir (compatibilidade com linhas antigas em texto
 * puro), então "saiu igual ao que entrou E tinha formato de envelope" significa que
 * o segredo continua fechado — e não que ele é assim mesmo. Sem esse teste o
 * ciphertext acaba indo como credencial para o provedor.
 */
export function looksEncrypted(value: string | null | undefined): boolean {
  if (!value) return false;
  const parts = value.split(':');
  if (parts.length !== 3) return false;
  return parts.every((part) => part.length > 0 && /^[0-9a-f]+$/i.test(part));
}

/**
 * Campos sensíveis da tabela Integrations que devem ser criptografados
 */
export const SENSITIVE_INTEGRATION_FIELDS = [
  'apiKey',
  'clientId',
  'clientSecret',
  'basic',
  'smtpUsername',
  'smtpPassword',
  'metaAccessToken',
  'metaAppId',
  'metaAppSecret',
  'metaLeadsAppSecret',
  'whatsappAppSecret',
  'webinarApiKey',
  'imapUsername',
  'imapPassword',
  'webhookSecret',
] as const
// Nota: `hottok` não é criptografado pois é usado como chave de lookup em WHERE queries (webhook matching)

/**
 * Criptografa campos sensíveis de um objeto de integração.
 * Retorna uma cópia do objeto com os campos sensíveis criptografados.
 * Campos null/undefined/vazios são ignorados.
 */
export function encryptIntegrationData<T extends Record<string, any>>(data: T): T {
  const result = { ...data } as Record<string, any>
  for (const field of SENSITIVE_INTEGRATION_FIELDS) {
    if (field in result && result[field] != null && result[field] !== '') {
      result[field] = encrypt(result[field])
    }
  }
  return result as T
}

/**
 * Descriptografa campos sensíveis de um objeto de integração.
 * Retorna uma cópia do objeto com os campos sensíveis descriptografados.
 * Campos null/undefined/vazios são ignorados.
 */
export function decryptIntegrationData<T extends Record<string, any>>(data: T): T {
  if (!data) return data
  const result = { ...data } as Record<string, any>
  for (const field of SENSITIVE_INTEGRATION_FIELDS) {
    if (field in result && result[field] != null && result[field] !== '') {
      result[field] = decrypt(result[field])
    }
  }
  return result as T
}
