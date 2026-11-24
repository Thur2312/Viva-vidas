import { BadRequestException, Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common'
import { PgService } from '../pg.service'
import { AuditService, RequestCtx } from '../compliance/audit.service'
import { CryptoService } from '../compliance/crypto.service'

export interface SecretDef {
  name: string
  label: string
  group: 'IA' | 'Voz' | 'Telefonia' | 'Chat' | 'Meta' | 'Acesso'
  hint: string
}

/**
 * Lista fechada: só estes nomes podem ser cadastrados pelo painel.
 * Ficam FORA, de propósito, as chaves de bootstrap que a API precisa antes de ler o banco ou para decifrar
 * o que está nele: DATABASE_URL/PILOT_DATABASE_URL, SECRETKEY (JWT do painel), ENCRYPTION_KEY, PILOT_DATA_KEY*
 * e PILOT_PHONE_SALT. Essas seguem só no ambiente do servidor.
 */
export const SECRET_DEFS: SecretDef[] = [
  { name: 'GEMINI_API_KEY', label: 'Google Gemini', group: 'IA', hint: 'Provedor de IA do agente (padrão atual).' },
  { name: 'ANTHROPIC_API_KEY', label: 'Anthropic (Claude)', group: 'IA', hint: 'Provedor de IA alternativo.' },
  { name: 'ELEVENLABS_API_KEY', label: 'ElevenLabs', group: 'Voz', hint: 'Voz sintética e, sem STT próprio, transcrição.' },
  { name: 'STT_API_KEY', label: 'Transcrição (STT)', group: 'Voz', hint: 'Chave do provedor de transcrição.' },
  { name: 'TWILIO_ACCOUNT_SID', label: 'Twilio Account SID', group: 'Telefonia', hint: 'Começa com AC.' },
  { name: 'TWILIO_AUTH_TOKEN', label: 'Twilio Auth Token', group: 'Telefonia', hint: 'Token de autenticação da conta Twilio.' },
  { name: 'CHAT_BRIDGE_KEY', label: 'Chave da ponte do chat', group: 'Chat', hint: 'Autoriza o envio de mensagens pelo chat (API → chat).' },
  { name: 'PILOT_API_KEY', label: 'Chave de ingestão do piloto', group: 'Chat', hint: 'O chat usa esta chave para enviar mensagens à API (chat → API).' },
  { name: 'FB_APP_ID', label: 'Meta: App ID', group: 'Meta', hint: 'ID do aplicativo Meta.' },
  { name: 'FB_APP_SECRET', label: 'Meta: App Secret', group: 'Meta', hint: 'Segredo do aplicativo Meta (OAuth e assinatura).' },
  { name: 'WHATSAPP_WEBHOOK_VERIFY_TOKEN', label: 'WhatsApp: token do webhook', group: 'Meta', hint: 'Token de verificação do webhook do WhatsApp.' },
  { name: 'META_LEADS_WEBHOOK_VERIFY_TOKEN', label: 'Meta Leads: token do webhook', group: 'Meta', hint: 'Token de verificação do webhook de leads.' },
]

const NAMES = new Set(SECRET_DEFS.map((d) => d.name))
const VALUE_RE = /^[\x21-\x7e]{4,400}$/ // ASCII visível, sem espaços

export interface SecretStatus extends SecretDef {
  configured: boolean
  source: 'painel' | 'ambiente' | null
  last4: string | null
  updatedAt: string | null
}

/**
 * Chaves cadastradas no painel ficam criptografadas no banco e são aplicadas em `process.env`
 * (no boot e a cada alteração), assim todo o código que lê o ambiente passa a enxergá-las sem mudar.
 * O valor do ambiente original é guardado e restaurado se a chave do painel for removida.
 * O painel NUNCA recebe o valor de volta: só "configurada", origem e os 4 últimos caracteres.
 */
@Injectable()
export class SecretsService implements OnModuleInit {
  private readonly log = new Logger(SecretsService.name)
  private readonly crypto: CryptoService
  private readonly envOriginal = new Map<string, string | undefined>()
  private readonly fromPanel = new Set<string>()

  constructor(private readonly pg: PgService, @Optional() private readonly audit?: AuditService, @Optional() crypto?: CryptoService) {
    this.crypto = crypto ?? new CryptoService()
  }

  private tenant() {
    return process.env.PILOT_TENANT || 'alberto'
  }

  async onModuleInit() {
    try {
      await this.hydrate()
    } catch (e: any) {
      // Sem banco/chave de dados no boot não derruba a API: as chaves do ambiente seguem valendo.
      this.log.warn(`Chaves do painel não carregadas: ${e?.message ?? 'erro'}`)
    }
  }

  /** Lê as chaves do banco e as aplica em process.env. */
  async hydrate() {
    const rows = (await this.pg.query(`SELECT name, ciphertext FROM horizon_agent.integration_secrets WHERE tenant = $1`, [this.tenant()])).rows
    for (const r of rows) {
      if (!NAMES.has(r.name)) continue
      try {
        this.apply(r.name, this.crypto.decrypt(r.ciphertext))
      } catch {
        this.log.warn(`Não foi possível decifrar ${r.name} (chave de dados trocada?)`)
      }
    }
  }

  private apply(name: string, value: string) {
    if (!this.envOriginal.has(name)) this.envOriginal.set(name, process.env[name])
    process.env[name] = value
    this.fromPanel.add(name)
  }

  private restore(name: string) {
    const orig = this.envOriginal.get(name)
    if (orig === undefined) delete process.env[name]
    else process.env[name] = orig
    this.fromPanel.delete(name)
    this.envOriginal.delete(name)
  }

  async list(): Promise<SecretStatus[]> {
    const rows = (await this.pg.query(`SELECT name, last4, updated_at FROM horizon_agent.integration_secrets WHERE tenant = $1`, [this.tenant()])).rows
    const byName = new Map(rows.map((r: any) => [r.name, r]))
    return SECRET_DEFS.map((d) => {
      const row: any = byName.get(d.name)
      const env = !!(process.env[d.name] ?? '').trim()
      return {
        ...d,
        configured: !!row || env,
        source: row ? 'painel' : env ? 'ambiente' : null,
        last4: row?.last4 || null,
        updatedAt: row?.updated_at ? new Date(row.updated_at).toISOString() : null,
      }
    })
  }

  async set(name: string, rawValue: string, ctx: RequestCtx) {
    if (!NAMES.has(name)) throw new BadRequestException('Chave desconhecida.')
    const value = (rawValue ?? '').trim()
    if (!VALUE_RE.test(value)) throw new BadRequestException('Valor inválido: use de 4 a 400 caracteres, sem espaços nem quebras de linha.')
    this.crypto.assertReady()
    await this.pg.query(
      `INSERT INTO horizon_agent.integration_secrets (tenant, name, ciphertext, last4, updated_by)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (tenant, name) DO UPDATE SET ciphertext = excluded.ciphertext, last4 = excluded.last4, updated_by = excluded.updated_by, updated_at = now()`,
      [this.tenant(), name, this.crypto.encrypt(value), value.slice(-4), ctx.actor],
    )
    this.apply(name, value)
    await this.audit?.log({ ...ctx, action: 'config.secret.set', entity: 'integration_secret', entityId: name, details: { name } })
    return this.list()
  }

  async remove(name: string, ctx: RequestCtx) {
    if (!NAMES.has(name)) throw new BadRequestException('Chave desconhecida.')
    await this.pg.query(`DELETE FROM horizon_agent.integration_secrets WHERE tenant = $1 AND name = $2`, [this.tenant(), name])
    if (this.fromPanel.has(name)) this.restore(name)
    await this.audit?.log({ ...ctx, action: 'config.secret.remove', entity: 'integration_secret', entityId: name, details: { name } })
    return this.list()
  }
}
