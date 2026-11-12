import { hashPassword } from 'src/modules/panel-auth/password.util'

/** Dublê em memória do PgService, so para as consultas do PanelAuthService. */
export class FakePg {
  users: any[] = []
  tokens: any[] = []
  private seq = 0
  queries: string[] = []

  async addUser(p: { email: string; password: string; role?: string; tenant?: string; active?: boolean }) {
    const u = {
      id: `00000000-0000-4000-8000-${String(++this.seq).padStart(12, '0')}`,
      tenant: p.tenant ?? 'alberto',
      email: p.email.toLowerCase(),
      name: 'Teste',
      role: p.role ?? 'viewer',
      password_hash: await hashPassword(p.password),
      active: p.active ?? true,
      failed_attempts: 0,
      locked_until: null as Date | null,
      last_login_at: null as Date | null,
    }
    this.users.push(u)
    return u
  }

  async query(text: string, params: any[] = []) {
    const sql = text.replace(/\s+/g, ' ').trim()
    this.queries.push(sql)
    const ok = (rows: any[] = []) => ({ rows, rowCount: rows.length })

    if (/FROM horizon_agent\.panel_users WHERE lower\(email\) = \$1/.test(sql)) return ok(this.users.filter((u) => u.email === params[0]))
    if (/UPDATE horizon_agent\.panel_users SET failed_attempts = CASE/.test(sql)) {
      const u = this.users.find((x) => x.id === params[0])
      if (u) {
        if (u.failed_attempts + 1 >= params[1]) {
          u.failed_attempts = 0
          u.locked_until = new Date(Date.now() + params[2] * 60_000)
        } else u.failed_attempts += 1
      }
      return ok()
    }
    if (/SET failed_attempts = 0, locked_until = NULL/.test(sql)) {
      const u = this.users.find((x) => x.id === params[0])
      if (u) Object.assign(u, { failed_attempts: 0, locked_until: null, last_login_at: new Date() })
      return ok()
    }
    if (/UPDATE horizon_agent\.panel_refresh_tokens SET revoked_at = now\(\) WHERE token_hash = \$1/.test(sql)) {
      const t = this.tokens.find((x) => x.token_hash === params[0] && !x.revoked_at && x.expires_at > new Date())
      if (!t) return ok()
      t.revoked_at = new Date()
      return ok([{ id: t.id, user_id: t.user_id, family_id: t.family_id }])
    }
    if (/SELECT family_id, revoked_at FROM horizon_agent\.panel_refresh_tokens WHERE token_hash/.test(sql))
      return ok(this.tokens.filter((x) => x.token_hash === params[0]))
    if (/SELECT family_id FROM horizon_agent\.panel_refresh_tokens WHERE token_hash/.test(sql))
      return ok(this.tokens.filter((x) => x.token_hash === params[0]))
    if (/FROM horizon_agent\.panel_users WHERE id = \$1/.test(sql)) return ok(this.users.filter((u) => u.id === params[0]))
    if (/INSERT INTO horizon_agent\.panel_refresh_tokens/.test(sql)) {
      const t = {
        id: `10000000-0000-4000-8000-${String(++this.seq).padStart(12, '0')}`,
        user_id: params[0],
        family_id: params[1],
        token_hash: params[2],
        expires_at: new Date(Date.now() + params[3] * 1000),
        revoked_at: null as Date | null,
        replaced_by: null as string | null,
        user_agent_hash: params[4],
      }
      this.tokens.push(t)
      return ok([{ id: t.id }])
    }
    if (/SET replaced_by = \$2 WHERE id = \$1/.test(sql)) {
      const t = this.tokens.find((x) => x.id === params[0])
      if (t) t.replaced_by = params[1]
      return ok()
    }
    if (/SET revoked_at = now\(\) WHERE family_id = \$1 AND revoked_at IS NULL/.test(sql)) {
      this.tokens.filter((x) => x.family_id === params[0] && !x.revoked_at).forEach((x) => (x.revoked_at = new Date()))
      return ok()
    }
    return ok()
  }
}
