import { ConflictException, Injectable, Logger, UnauthorizedException } from '@nestjs/common'
import { randomBytes, randomUUID } from 'crypto'
import { PgService } from '../pilot/pg.service'
import { hashPassword, verifyPassword } from './password.util'
import { ACCESS_TOKEN_TTL_SECONDS, PanelRole, REFRESH_TOKEN_TTL_SECONDS } from './panel-roles'
import { hashToken, hashUserAgent, newRefreshToken, signAccessToken } from './tokens.util'

export const MAX_FAILED_ATTEMPTS = 5
export const LOCK_MINUTES = 15
/** Requisicoes simultaneas do painel podem apresentar o mesmo refresh token logo apos a rotacao: nao e roubo. */
export const REUSE_GRACE_SECONDS = 10

export interface PanelUserView {
  id: string
  name: string
  email: string
  role: PanelRole
}
export interface AuthResult {
  accessToken: string
  refreshToken: string
  expiresIn: number
  user: PanelUserView
}

const GENERIC = 'Credenciais invalidas'
const toView = (u: any): PanelUserView => ({ id: u.id, name: u.name, email: u.email, role: u.role })

@Injectable()
export class PanelAuthService {
  private readonly logger = new Logger(PanelAuthService.name)
  private dummyHash?: Promise<string>

  constructor(private readonly db: Pick<PgService, 'query'>) {}

  /** Hash de uma senha aleatoria: usuario inexistente gasta o mesmo tempo de scrypt. */
  private getDummyHash() {
    this.dummyHash ??= hashPassword(randomBytes(24).toString('hex'))
    return this.dummyHash
  }

  async login(email: unknown, password: unknown, userAgent?: string): Promise<AuthResult> {
    const mail = typeof email === 'string' ? email.trim().toLowerCase().slice(0, 254) : ''
    const pass = typeof password === 'string' && password.length <= 1024 ? password : ''
    const { rows } = mail
      ? await this.db.query(
          `SELECT id, tenant, email, name, role, password_hash, active, locked_until, token_version
             FROM horizon_agent.panel_users WHERE lower(email) = $1`,
          [mail],
        )
      : { rows: [] as any[] }
    const user = rows[0]

    // Sempre executa um scrypt, exista o usuario ou nao, esteja ele bloqueado ou nao.
    const ok = await verifyPassword(pass, user ? user.password_hash : await this.getDummyHash())
    const locked = user?.locked_until && new Date(user.locked_until).getTime() > Date.now()

    if (!user || !user.active || locked) throw new UnauthorizedException(GENERIC)

    if (!ok) {
      // Atomico: incrementa e, ao atingir o limite, trava e zera o contador.
      await this.db.query(
        `UPDATE horizon_agent.panel_users
            SET failed_attempts = CASE WHEN failed_attempts + 1 >= $2 THEN 0 ELSE failed_attempts + 1 END,
                locked_until = CASE WHEN failed_attempts + 1 >= $2 THEN now() + make_interval(mins => $3) ELSE locked_until END
          WHERE id = $1`,
        [user.id, MAX_FAILED_ATTEMPTS, LOCK_MINUTES],
      )
      throw new UnauthorizedException(GENERIC)
    }

    await this.db.query(
      `UPDATE horizon_agent.panel_users SET failed_attempts = 0, locked_until = NULL, last_login_at = now() WHERE id = $1`,
      [user.id],
    )
    return this.issue(user, randomUUID(), userAgent)
  }

  async refresh(refreshToken: unknown, userAgent?: string): Promise<AuthResult> {
    if (typeof refreshToken !== 'string' || refreshToken.length < 20 || refreshToken.length > 200) throw new UnauthorizedException(GENERIC)
    const hash = hashToken(refreshToken)

    // Reivindica o token de forma atomica: so uma requisicao concorrente vence.
    const claimed = await this.db.query(
      `UPDATE horizon_agent.panel_refresh_tokens SET revoked_at = now()
        WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now()
        RETURNING id, user_id, family_id`,
      [hash],
    )
    if (!claimed.rows[0]) {
      // Nao reivindicou: desconhecido, expirado ou JA USADO. Se ja foi usado, ha reuso -> derruba a familia.
      const prev = await this.db.query(`SELECT family_id, revoked_at, replaced_by FROM horizon_agent.panel_refresh_tokens WHERE token_hash = $1`, [hash])
      const revokedAt = prev.rows[0]?.revoked_at ? new Date(prev.rows[0].revoked_at).getTime() : 0
      // Rotacionado ha poucos segundos por outra requisicao: o cliente so precisa tentar de novo com o cookie novo.
      if (revokedAt && prev.rows[0]?.replaced_by && Date.now() - revokedAt < REUSE_GRACE_SECONDS * 1000) {
        throw new ConflictException('refresh_in_progress')
      }
      if (prev.rows[0]?.revoked_at) {
        await this.revokeFamily(prev.rows[0].family_id)
        this.logger.warn(`reuso de refresh token detectado; familia ${prev.rows[0].family_id} revogada`)
      }
      throw new UnauthorizedException(GENERIC)
    }
    const { id: oldId, user_id, family_id } = claimed.rows[0]

    const u = await this.db.query(
      `SELECT id, tenant, email, name, role, active, locked_until, token_version FROM horizon_agent.panel_users WHERE id = $1`,
      [user_id],
    )
    const user = u.rows[0]
    if (!user || !user.active) {
      await this.revokeFamily(family_id)
      throw new UnauthorizedException(GENERIC)
    }
    return this.issue(user, family_id, userAgent, oldId)
  }

  /** Revoga a familia (sessao inteira). Idempotente: token desconhecido tambem retorna normalmente. */
  async logout(refreshToken: unknown): Promise<void> {
    if (typeof refreshToken !== 'string' || refreshToken.length > 200) return
    const { rows } = await this.db.query(`SELECT family_id FROM horizon_agent.panel_refresh_tokens WHERE token_hash = $1`, [hashToken(refreshToken)])
    if (rows[0]) await this.revokeFamily(rows[0].family_id)
  }

  async me(userId: string): Promise<PanelUserView> {
    const { rows } = await this.db.query(`SELECT id, name, email, role, active FROM horizon_agent.panel_users WHERE id = $1`, [userId])
    if (!rows[0] || !rows[0].active) throw new UnauthorizedException(GENERIC)
    return toView(rows[0])
  }

  private async revokeFamily(familyId: string) {
    await this.db.query(`UPDATE horizon_agent.panel_refresh_tokens SET revoked_at = now() WHERE family_id = $1 AND revoked_at IS NULL`, [familyId])
  }

  private async issue(user: any, familyId: string, userAgent?: string, replacesId?: string): Promise<AuthResult> {
    const rt = newRefreshToken()
    const ins = await this.db.query(
      `INSERT INTO horizon_agent.panel_refresh_tokens (user_id, family_id, token_hash, expires_at, user_agent_hash)
       VALUES ($1, $2, $3, now() + make_interval(secs => $4), $5) RETURNING id`,
      [user.id, familyId, rt.hash, REFRESH_TOKEN_TTL_SECONDS, hashUserAgent(userAgent)],
    )
    if (replacesId) {
      await this.db.query(`UPDATE horizon_agent.panel_refresh_tokens SET replaced_by = $2 WHERE id = $1`, [replacesId, ins.rows[0]?.id ?? null])
    }
    return {
      accessToken: signAccessToken({ id: user.id, tenant: user.tenant, role: user.role, tokenVersion: Number(user.token_version ?? 0) }),
      refreshToken: rt.token,
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
      user: toView(user),
    }
  }
}

