import { Injectable } from '@nestjs/common'
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'crypto'

/**
 * Criptografia em repouso, na camada da aplicação, para `messages.body` e `agent_drafts.draft_body`.
 * AES-256-GCM, IV aleatório de 12 bytes por valor. Formato: `enc:v<N>:` + base64(iv | tag | cifrado).
 *
 * Rotação: a versão atual é `PILOT_DATA_KEY_VERSION` (padrão 1) e usa `PILOT_DATA_KEY`.
 * Ao rotacionar, suba a versão, ponha a chave nova em `PILOT_DATA_KEY` e guarde a antiga em
 * `PILOT_DATA_KEY_V<n>` (n = versão antiga). Valores antigos continuam legíveis; os novos saem na versão nova.
 *
 * NÃO se criptografa `leads.phone`: ele é usado em buscas e no índice único (tenant, phone).
 * Em compensação, o telefone é mascarado nas listagens e eliminado/hasheado na anonimização.
 *
 * Sem chave, falha FECHADO (lança erro claro), exceto com NODE_ENV=test, onde vira passagem direta.
 */
const PREFIX = 'enc:v'

export function parseKey(b64: string | undefined, name: string): Buffer {
  const key = Buffer.from((b64 ?? '').trim(), 'base64')
  if (key.length !== 32) throw new Error(`${name} inválida: precisa ser 32 bytes em base64`)
  return key
}

@Injectable()
export class CryptoService {
  private get currentVersion() {
    const v = Number(process.env.PILOT_DATA_KEY_VERSION ?? 1)
    return Number.isInteger(v) && v > 0 ? v : 1
  }

  private get passthrough() {
    return !process.env.PILOT_DATA_KEY && process.env.NODE_ENV === 'test'
  }

  private keyFor(version: number): Buffer {
    const name = version === this.currentVersion ? 'PILOT_DATA_KEY' : `PILOT_DATA_KEY_V${version}`
    const raw = process.env[name]
    if (!raw) throw new Error(`${name} ausente: não é possível processar dados criptografados (fail closed)`)
    return parseKey(raw, name)
  }

  /** Falha cedo, com mensagem clara, se a chave de criptografia não estiver configurada. */
  assertReady() {
    if (this.passthrough) return
    if (!process.env.PILOT_DATA_KEY) throw new Error('PILOT_DATA_KEY ausente: a ingestão do piloto está desativada (fail closed)')
    this.keyFor(this.currentVersion)
  }

  isEncrypted(v: string | null | undefined) {
    return typeof v === 'string' && v.startsWith(PREFIX)
  }

  encrypt(plain: string): string {
    if (plain == null) return plain
    if (this.passthrough) return plain
    this.assertReady()
    const version = this.currentVersion
    const iv = randomBytes(12)
    const c = createCipheriv('aes-256-gcm', this.keyFor(version), iv)
    const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()])
    return `${PREFIX}${version}:${Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64')}`
  }

  /** Valores sem o prefixo (linhas anteriores à criptografia) são devolvidos como estão. */
  decrypt(stored: string): string {
    if (stored == null || !this.isEncrypted(stored)) return stored
    const m = /^enc:v(\d+):(.+)$/.exec(stored)
    if (!m) throw new Error('Valor criptografado malformado')
    const raw = Buffer.from(m[2], 'base64')
    if (raw.length < 28) throw new Error('Valor criptografado malformado')
    const d = createDecipheriv('aes-256-gcm', this.keyFor(Number(m[1])), raw.subarray(0, 12))
    d.setAuthTag(raw.subarray(12, 28))
    return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8')
  }

  /**
   * HMAC-SHA256 salgado do telefone, para manter só o bloqueio de opt-out após anonimizar.
   * Sal: PILOT_PHONE_SALT; na falta, deriva-se da chave de dados.
   */
  hashPhone(phone: string): string {
    const salt = process.env.PILOT_PHONE_SALT || process.env.PILOT_DATA_KEY || (process.env.NODE_ENV === 'test' ? 'sal-de-teste' : '')
    if (!salt) throw new Error('PILOT_PHONE_SALT (ou PILOT_DATA_KEY) ausente: não é possível calcular o hash do telefone')
    return createHmac('sha256', salt).update(phone).digest('hex')
  }
}
