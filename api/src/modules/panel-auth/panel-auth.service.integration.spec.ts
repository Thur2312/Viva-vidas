import { Client } from 'pg'
import { PanelAuthService } from './panel-auth.service'
import { hashPassword } from './password.util'

// Banco real, SEMPRE dentro de transacao com ROLLBACK. Sem PILOT_TEST_DATABASE_URL a suite e ignorada.
const url = process.env.PILOT_TEST_DATABASE_URL
const d = url ? describe : describe.skip
const PASS = 'Zebra-Lunar-4421-ok'

d('PanelAuthService (banco real, com rollback)', () => {
  let client: Client
  let svc: PanelAuthService
  const TENANT = 'teste_rollback_panel'

  beforeAll(async () => {
    process.env.SECRETKEY = 'integration-secret-' + 'k'.repeat(32)
    client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
    await client.connect()
  })
  afterAll(async () => {
    const r = await client.query(`SELECT (SELECT count(*) FROM horizon_agent.panel_users WHERE tenant = $1)::int u,
                                         (SELECT count(*) FROM horizon_agent.panel_refresh_tokens t JOIN horizon_agent.panel_users p ON p.id = t.user_id WHERE p.tenant = $1)::int t`, [TENANT])
    await client.end()
    expect(r.rows[0]).toEqual({ u: 0, t: 0 }) // nada sobrou
  })
  beforeEach(async () => {
    await client.query('BEGIN')
    svc = new PanelAuthService(client as any)
  })
  afterEach(async () => { await client.query('ROLLBACK') })

  const mkUser = async (email = 'int@exemplo.com', active = true) =>
    (await client.query(
      `INSERT INTO horizon_agent.panel_users (tenant, email, name, role, password_hash, active) VALUES ($1,$2,'Int','manager',$3,$4) RETURNING id`,
      [TENANT, email, await hashPassword(PASS), active],
    )).rows[0].id as string

  it('login, rotacao, reuso e logout contra o schema real', async () => {
    const id = await mkUser()
    const a = await svc.login('INT@exemplo.com', PASS, 'jest')
    expect(a.user.id).toBe(id)
    const b = await svc.refresh(a.refreshToken)
    await client.query(`UPDATE horizon_agent.panel_refresh_tokens SET revoked_at = now() - interval '11 seconds' WHERE user_id = $1 AND revoked_at IS NOT NULL`, [id])
    await expect(svc.refresh(a.refreshToken)).rejects.toThrow()
    await expect(svc.refresh(b.refreshToken)).rejects.toThrow() // familia revogada
    const rows = (await client.query(`SELECT revoked_at, replaced_by FROM horizon_agent.panel_refresh_tokens WHERE user_id = $1`, [id])).rows
    expect(rows).toHaveLength(2)
    expect(rows.every((r) => r.revoked_at)).toBe(true)
    expect(rows.filter((r) => r.replaced_by)).toHaveLength(1)
    const c = await svc.login('int@exemplo.com', PASS)
    await svc.logout(c.refreshToken)
    await expect(svc.refresh(c.refreshToken)).rejects.toThrow()
  })

  it('bloqueio por 5 falhas e e-mail unico (case-insensitive)', async () => {
    const id = await mkUser()
    for (let i = 0; i < 5; i++) await expect(svc.login('int@exemplo.com', 'errada')).rejects.toThrow()
    await expect(svc.login('int@exemplo.com', PASS)).rejects.toThrow()
    const u = (await client.query(`SELECT locked_until > now() AS locked FROM horizon_agent.panel_users WHERE id = $1`, [id])).rows[0]
    expect(u.locked).toBe(true)
    await client.query('SAVEPOINT s')
    await expect(mkUser('INT@EXEMPLO.COM')).rejects.toThrow() // CHECK lower(email)
    await client.query('ROLLBACK TO s')
  })

  it('RLS ligado e sem policies nas duas tabelas', async () => {
    const r = await client.query(`SELECT c.relname, c.relrowsecurity,
        (SELECT count(*) FROM pg_policies p WHERE p.schemaname='horizon_agent' AND p.tablename=c.relname)::int AS policies
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='horizon_agent' AND c.relname IN ('panel_users','panel_refresh_tokens')`)
    expect(r.rows).toHaveLength(2)
    r.rows.forEach((x) => expect(x).toMatchObject({ relrowsecurity: true, policies: 0 }))
  })
})
