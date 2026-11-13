import { PgService } from '../pilot/pg.service'
import { PanelRole, isPanelRole } from './panel-roles'

/** O que o banco diz sobre o usuario DONO de um access token. E a fonte da verdade: o JWT so prova quem emitiu. */
export interface SessionState {
  active: boolean
  role: PanelRole
  tenant: string
  tokenVersion: number
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DEFAULT_CACHE_MS = 5_000
const MAX_CACHE_MS = 60_000
const MAX_ENTRIES = 500

/** Vazio/invalido => padrao. 0 desliga o cache (usado nos testes). Teto de 1 min: e o prazo maximo de uma revogacao. */
function cacheMs(): number {
  const raw = process.env.PANEL_SESSION_CACHE_MS
  if (raw === undefined || raw.trim() === '') return DEFAULT_CACHE_MS
  const n = Number(raw)
  return Number.isFinite(n) && n >= 0 ? Math.min(n, MAX_CACHE_MS) : DEFAULT_CACHE_MS
}

/**
 * Revogacao imediata do access token (JWT, sem estado): a cada requisicao a API confere se o usuario continua ativo,
 * com o mesmo papel e na mesma `token_version`. Redefinir senha, desativar ou rebaixar passa a valer em segundos
 * (o tempo do cache), nao em 15 min.
 *
 * O cache e por processo: a revogacao feita por outro processo (o script de reset) chega em ate `PANEL_SESSION_CACHE_MS`.
 * Falha FECHADA: se o banco cair, a excecao sobe (a requisicao nao passa) e nada fica em cache.
 */
export class SessionStateService {
  private readonly cache = new Map<string, { at: number; state: SessionState | null }>()
  private readonly inflight = new Map<string, Promise<SessionState | null>>()

  constructor(private readonly db: Pick<PgService, 'query'>) {}

  async get(userId: string): Promise<SessionState | null> {
    if (typeof userId !== 'string' || !UUID_RE.test(userId)) return null // evita erro 22P02 do Postgres com sub forjado
    const ttl = cacheMs()
    if (ttl > 0) {
      const hit = this.cache.get(userId)
      if (hit && Date.now() - hit.at < ttl) return hit.state
    }
    // Varias requisicoes simultaneas (o dashboard dispara muitas) compartilham a mesma consulta.
    let p = this.inflight.get(userId)
    if (!p) {
      p = this.load(userId).finally(() => this.inflight.delete(userId))
      this.inflight.set(userId, p)
    }
    const state = await p
    if (ttl > 0) this.remember(userId, state, ttl)
    return state
  }

  private async load(userId: string): Promise<SessionState | null> {
    const { rows } = await this.db.query(
      `SELECT tenant, role, active, token_version FROM horizon_agent.panel_users WHERE id = $1`,
      [userId],
    )
    const r = rows[0]
    if (!r || !isPanelRole(r.role)) return null
    return { active: r.active === true, role: r.role, tenant: String(r.tenant), tokenVersion: Number(r.token_version ?? 0) }
  }

  private remember(userId: string, state: SessionState | null, ttl: number) {
    if (this.cache.size >= MAX_ENTRIES) {
      const now = Date.now()
      this.cache.forEach((v, k) => {
        if (now - v.at >= ttl) this.cache.delete(k)
      })
      if (this.cache.size >= MAX_ENTRIES) this.cache.clear() // teto de memoria
    }
    this.cache.set(userId, { at: Date.now(), state })
  }
}
