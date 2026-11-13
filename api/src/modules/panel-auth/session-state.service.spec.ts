import { SessionStateService } from './session-state.service'

const ID = '00000000-0000-4000-8000-000000000001'
// Os dubles de banco so implementam `query`; o tipo do PgService e generico, entao o cast fica num lugar so.
const mk = (db: unknown) => new SessionStateService(db as any)

function fakeDb(row: any = { tenant: 'alberto', role: 'manager', active: true, token_version: 0 }) {
  const calls: any[][] = []
  return {
    calls,
    row,
    async query(_sql: string, params: any[] = []) {
      calls.push(params)
      return { rows: this.row ? [this.row] : [], rowCount: this.row ? 1 : 0 }
    },
  }
}

describe('SessionStateService', () => {
  const saved = process.env.PANEL_SESSION_CACHE_MS
  afterEach(() => {
    if (saved === undefined) delete process.env.PANEL_SESSION_CACHE_MS
    else process.env.PANEL_SESSION_CACHE_MS = saved
  })

  it('le o estado do banco e mapeia os campos', async () => {
    process.env.PANEL_SESSION_CACHE_MS = '0'
    const svc = mk(fakeDb({ tenant: 't', role: 'owner', active: true, token_version: '4' }))
    await expect(svc.get(ID)).resolves.toEqual({ active: true, role: 'owner', tenant: 't', tokenVersion: 4 })
  })

  it('usuario inexistente ou com papel invalido => null; sub que nao e UUID nem consulta o banco', async () => {
    process.env.PANEL_SESSION_CACHE_MS = '0'
    const none = fakeDb(null)
    await expect(mk(none).get(ID)).resolves.toBeNull()
    await expect(mk(fakeDb({ tenant: 't', role: 'god', active: true })).get(ID)).resolves.toBeNull()
    await expect(mk(none).get("1'; DROP TABLE x;--")).resolves.toBeNull()
    expect(none.calls).toHaveLength(1)
  })

  it('cache: a segunda leitura nao consulta o banco; com TTL 0 consulta sempre', async () => {
    process.env.PANEL_SESSION_CACHE_MS = '60000'
    const db = fakeDb()
    const svc = mk(db)
    await svc.get(ID)
    await svc.get(ID)
    expect(db.calls).toHaveLength(1)

    process.env.PANEL_SESSION_CACHE_MS = '0'
    const db0 = fakeDb()
    const svc0 = mk(db0)
    await svc0.get(ID)
    await svc0.get(ID)
    expect(db0.calls).toHaveLength(2)
  })

  it('requisicoes simultaneas compartilham uma unica consulta', async () => {
    process.env.PANEL_SESSION_CACHE_MS = '0'
    const db = fakeDb()
    const svc = mk(db)
    await Promise.all([svc.get(ID), svc.get(ID), svc.get(ID)])
    expect(db.calls).toHaveLength(1)
  })

  it('falha fechada: erro do banco sobe e nada fica em cache', async () => {
    process.env.PANEL_SESSION_CACHE_MS = '60000'
    let fail = true
    const db = {
      calls: 0,
      async query() {
        this.calls++
        if (fail) throw new Error('db fora')
        return { rows: [{ tenant: 't', role: 'viewer', active: true, token_version: 0 }], rowCount: 1 }
      },
    }
    const svc = mk(db)
    await expect(svc.get(ID)).rejects.toThrow('db fora')
    fail = false
    await expect(svc.get(ID)).resolves.toMatchObject({ role: 'viewer' })
    expect(db.calls).toBe(2)
  })

  it('TTL invalido ou vazio cai no padrao (5 s), nao em 0', async () => {
    const db = fakeDb()
    for (const v of ['', 'abc', '-1']) {
      process.env.PANEL_SESSION_CACHE_MS = v
      db.calls.length = 0
      const s = mk(db)
      await s.get(ID)
      await s.get(ID)
      expect(db.calls).toHaveLength(1)
    }
  })
})
