import { Injectable, Optional } from '@nestjs/common'
import { Db, PgService } from '../pg.service'
import { redactPii } from './redaction'

export interface AuditEntry {
  actor: string
  action: string
  entity: string
  entityId?: string | null
  ip?: string | null
  details?: Record<string, unknown>
}

export interface RequestCtx { actor: string; ip?: string | null }
export const SYSTEM_CTX: RequestCtx = { actor: 'sistema' }

// Chaves que nunca entram em `details`, mesmo que alguém tente.
const FORBIDDEN_KEYS = /^(name|nome|phone|telefone|fone|body|text|texto|message|mensagem|draft|email|cpf|cnpj|rg|address|endereco|summary|resumo|qualification|content)$/i

/** Remove chaves de dado pessoal e mascara strings que pareçam identificadores. */
export function sanitizeDetails(value: unknown, depth = 0): any {
  if (value == null || typeof value === 'number' || typeof value === 'boolean') return value
  if (typeof value === 'string') return redactPii(value).text.slice(0, 200)
  if (depth >= 3) return '[omitido]'
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => sanitizeDetails(v, depth + 1))
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as any)) {
      if (!FORBIDDEN_KEYS.test(k)) out[k] = sanitizeDetails(v, depth + 1)
    }
    return out
  }
  return String(value)
}

/** Contexto do request (painel): só o id do operador e o IP, nunca e-mail ou nome. */
export function requestCtx(req: any): RequestCtx {
  const u = req?.user
  const actor = u?.userId ?? u?.id ?? u?.sub ?? 'painel'
  return { actor: String(actor).slice(0, 80), ip: req?.ip ?? null }
}

@Injectable()
export class AuditService {
  constructor(@Optional() private readonly pg: PgService) {}

  async log(e: AuditEntry, db: Db = this.pg) {
    await db.query(
      `INSERT INTO horizon_agent.audit_log (actor, action, entity, entity_id, ip, details)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
      [e.actor, e.action, e.entity, e.entityId ?? null, e.ip ?? null, JSON.stringify(sanitizeDetails(e.details ?? {}))],
    )
  }

  async list(opts: { limit?: number; offset?: number; action?: string; entityId?: string } = {}, db: Db = this.pg) {
    const where: string[] = []
    const params: any[] = []
    if (opts.action) { params.push(opts.action); where.push(`action = $${params.length}`) }
    if (opts.entityId) { params.push(opts.entityId); where.push(`entity_id = $${params.length}`) }
    params.push(Math.min(200, Math.max(1, opts.limit ?? 50)), Math.max(0, opts.offset ?? 0))
    const { rows } = await db.query(
      `SELECT id, actor, action, entity, entity_id, ip, at, details FROM horizon_agent.audit_log
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY at DESC, id DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    )
    return rows
  }
}
