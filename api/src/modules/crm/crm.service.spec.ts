import { CrmService } from './crm.service'
import { CrmApiError, CrmAdapter, CrmStatus } from './crm.types'
import { subjectHooks } from '../pilot/compliance/subject-hooks'

// Banco em memoria: so entende as consultas do CrmService. Prova a logica da fila (ordem, retry, idempotencia),
// nao o SQL real: isso fica para a suite de integracao com Postgres.
interface Item { id: number; tenant: string; lead_id: string; event_type: string; value: number | null; status: string; attempts: number; next_attempt_at: Date; claimed_at: Date | null; last_error: string | null; sent_at: Date | null }

class FakeDb {
  items: Item[] = []
  leads = new Map<string, any>()
  private seq = 0
  addLead(id: string, o: any = {}) { this.leads.set(id, { id, name: 'Maria Souza', phone: '5583999991234', opt_out: false, anonymized_at: null, pipedrive_ids: {}, ...o }) }
  enqueue(leadId: string, type: string, value: number | null = null) {
    this.items.push({ id: ++this.seq, tenant: 'alberto', lead_id: leadId, event_type: type, value, status: 'pending', attempts: 0, next_attempt_at: new Date(0), claimed_at: null, last_error: null, sent_at: null })
  }
  async query(sql: string, p: any[] = []): Promise<any> {
    const q = sql.replace(/\s+/g, ' ')
    if (/status = 'processing' AND claimed_at </.test(q)) return { rows: [], rowCount: 0 }
    if (/SET status = 'processing'/.test(q)) {
      const due = this.items
        .filter((c) => c.status === 'pending' && c.next_attempt_at <= p[1] && !this.items.some((o) => o.lead_id === c.lead_id && o.id < c.id && ['pending', 'processing'].includes(o.status)))
        .sort((a, b) => a.id - b.id).slice(0, p[2])
      due.forEach((i) => { i.status = 'processing'; i.claimed_at = new Date(); i.attempts += 1 })
      return { rows: due.map((i) => ({ ...i })), rowCount: due.length }
    }
    if (/SELECT id, name, phone, opt_out/.test(q)) return { rows: [this.leads.get(p[0])].filter(Boolean) }
    if (/SELECT pipedrive_ids FROM/.test(q)) return { rows: [this.leads.get(p[0])].filter(Boolean) }
    if (/UPDATE horizon_agent.leads SET pipedrive_ids/.test(q)) { this.leads.get(p[0]).pipedrive_ids = JSON.parse(p[1]); return { rows: [], rowCount: 1 } }
    const it = (id: number) => this.items.find((i) => i.id === id)!
    if (/attempts = attempts - 1/.test(q)) { const i = it(p[0]); Object.assign(i, { status: 'pending', attempts: i.attempts - 1, claimed_at: null, last_error: p[1], next_attempt_at: p[2] }); return { rows: [] } }
    if (/SET status = 'pending', claimed_at = NULL, last_error = \$2, next_attempt_at = \$3/.test(q)) { Object.assign(it(p[0]), { status: 'pending', claimed_at: null, last_error: p[1], next_attempt_at: p[2] }); return { rows: [] } }
    if (/SET status = \$2, last_error = \$3/.test(q)) { const i = it(p[0]); Object.assign(i, { status: p[1], last_error: p[2], claimed_at: null }); if (p[1] === 'sent') i.sent_at = new Date(); return { rows: [] } }
    if (/GROUP BY status/.test(q)) {
      const c = new Map<string, number>(); this.items.forEach((i) => c.set(i.status, (c.get(i.status) ?? 0) + 1))
      return { rows: [...c].map(([status, n]) => ({ status, n })) }
    }
    if (/SET status = 'pending', attempts = 0/.test(q)) { const d = this.items.filter((i) => i.status === 'dead'); d.forEach((i) => Object.assign(i, { status: 'pending', attempts: 0, next_attempt_at: new Date(0), last_error: null })); return { rows: [], rowCount: d.length } }
    throw new Error(`consulta nao prevista no teste: ${q.slice(0, 80)}`)
  }
}

class FakeCrm implements CrmAdapter {
  readonly id = 'fake'
  calls: string[] = []
  configured = true
  failNext: unknown[] = []
  private n = 100
  status(): CrmStatus { return { provider: 'fake', configured: this.configured, missing: this.configured ? [] : ['TOKEN'] } }
  private async go<T>(name: string, v: T): Promise<T> { this.calls.push(name); const f = this.failNext.shift(); if (f) throw f; return v }
  findPersonByPhone() { return this.go('findPerson', null as number | null) }
  createPerson() { return this.go('createPerson', ++this.n) }
  findOpenDeal() { return this.go('findDeal', null as number | null) }
  createDeal() { return this.go('createDeal', ++this.n) }
  updateDeal() { return this.go('updateDeal', undefined as void) }
  addNote() { return this.go('addNote', undefined as void) }
  deletePerson() { return this.go('deletePerson', undefined as void) }
}

const MAP = JSON.stringify({ qualificado: 12, reuniao_marcada: 13 })
const T0 = new Date('2026-11-12T12:00:00Z')

describe('CrmService (fila do CRM)', () => {
  let db: FakeDb, crm: FakeCrm, svc: CrmService
  const env = { ...process.env }
  beforeEach(() => {
    process.env.PIPEDRIVE_STAGE_MAP = MAP
    db = new FakeDb(); crm = new FakeCrm()
    db.addLead('L1')
    svc = new CrmService(db as any, { tenant: 'alberto' } as any, { log: jest.fn() } as any, { withLock: async (_k: number, fn: () => any) => ({ ran: true, result: await fn() }) } as any, crm)
  })
  afterAll(() => { process.env = env })

  it('qualificado cria pessoa e negocio, grava os ids e marca como enviado', async () => {
    db.enqueue('L1', 'qualificado')
    await svc.runOnce(T0)
    expect(crm.calls).toEqual(['findPerson', 'createPerson', 'findDeal', 'createDeal', 'updateDeal', 'addNote'])
    expect(db.leads.get('L1').pipedrive_ids).toEqual({ person_id: 101, deal_id: 102 })
    expect(db.items[0]).toMatchObject({ status: 'sent', attempts: 1 })
  })

  it('o evento seguinte reaproveita os ids: nao cria nada de novo', async () => {
    db.enqueue('L1', 'qualificado'); await svc.runOnce(T0)
    crm.calls = []
    db.enqueue('L1', 'reuniao_marcada'); await svc.runOnce(T0)
    expect(crm.calls).toEqual(['updateDeal', 'addNote'])
  })

  it('preserva a ordem: de um mesmo lead so o item mais antigo sai por ciclo', async () => {
    db.enqueue('L1', 'qualificado'); db.enqueue('L1', 'reuniao_marcada')
    const r = await svc.runOnce(T0)
    expect(r.processed).toBe(1)
    expect(db.items.map((i) => i.status)).toEqual(['sent', 'pending'])
    await svc.runOnce(T0)
    expect(db.items.map((i) => i.status)).toEqual(['sent', 'sent'])
  })

  it('falha de rede: volta para a fila com espera, e a proxima tentativa conclui', async () => {
    db.enqueue('L1', 'qualificado')
    crm.failNext = [new CrmApiError(503)]
    await svc.runOnce(T0)
    expect(db.items[0].status).toBe('pending')
    expect(db.items[0].next_attempt_at.getTime()).toBe(T0.getTime() + 30_000)
    expect(db.items[0].last_error).toBe('crm: HTTP 503')
    expect((await svc.runOnce(new Date(T0.getTime() + 10_000))).processed).toBe(0) // ainda esperando
    await svc.runOnce(new Date(T0.getTime() + 31_000))
    expect(db.items[0].status).toBe('sent')
  })

  it('queda depois de criar a pessoa nao duplica: a nova tentativa reaproveita o id salvo', async () => {
    db.enqueue('L1', 'qualificado')
    crm.failNext = [null, null, null, new CrmApiError(500)] // findPerson, createPerson, findDeal ok; createDeal cai
    await svc.runOnce(T0)
    expect(db.leads.get('L1').pipedrive_ids.person_id).toBe(101)
    crm.calls = []
    await svc.runOnce(new Date(T0.getTime() + 60_000))
    expect(crm.calls).not.toContain('createPerson')
    expect(db.items[0].status).toBe('sent')
  })

  it('erro 4xx vai direto para dead, sem tentar de novo e sem corpo de resposta', async () => {
    db.enqueue('L1', 'qualificado')
    crm.failNext = [new CrmApiError(401, 'GET /persons/search')]
    await svc.runOnce(T0)
    expect(db.items[0]).toMatchObject({ status: 'dead', last_error: 'GET /persons/search: HTTP 401' })
  })

  it('apos 8 tentativas com falha transitoria vai para dead', async () => {
    db.enqueue('L1', 'qualificado')
    let t = T0.getTime()
    for (let i = 0; i < 8; i++) { crm.failNext = [new CrmApiError(503)]; await svc.runOnce(new Date(t)); t += 3_700_000 }
    expect(db.items[0]).toMatchObject({ status: 'dead', attempts: 8 })
  })

  it('lead em opt-out ou sem etapa mapeada e pulado, sem chamar o CRM', async () => {
    db.addLead('L2', { opt_out: true })
    db.enqueue('L2', 'qualificado'); db.enqueue('L1', 'compareceu')
    await svc.runOnce(T0)
    expect(crm.calls).toEqual([])
    expect(db.items.map((i) => [i.status, i.last_error])).toEqual([['skipped', 'opt_out'], ['skipped', 'sem_etapa_mapeada']])
  })

  it('credencial que sumiu no meio devolve o item sem gastar tentativa', async () => {
    db.enqueue('L1', 'qualificado')
    const { CrmNotConfiguredError } = await import('./crm.types')
    crm.failNext = [new CrmNotConfiguredError(['TOKEN'])]
    await svc.runOnce(T0)
    expect(db.items[0]).toMatchObject({ status: 'pending', attempts: 0 })
  })

  it('tick nao roda sem credencial (a fila acumula) e o status mostra a fila', async () => {
    db.enqueue('L1', 'qualificado')
    crm.configured = false
    expect((await svc.tick(T0)).ran).toBe(false)
    expect(db.items[0].status).toBe('pending')
    const s = await svc.status()
    expect(s).toMatchObject({ configured: false, missing: ['TOKEN'], queue: { pending: 1, dead: 0 } })
  })

  it('o dono reenfileira o que estava em dead', async () => {
    db.enqueue('L1', 'qualificado'); db.items[0].status = 'dead'
    expect(await svc.retryDead({ actor: 'owner' })).toEqual({ requeued: 1 })
    expect(db.items[0].status).toBe('pending')
  })

  describe('direito de exclusao (LGPD)', () => {
    const hook = () => { svc.onModuleInit(); return subjectHooks().find((h) => h.name === 'crm')! }
    it('apaga a pessoa no CRM antes de o lead ser apagado', async () => {
      db.leads.get('L1').pipedrive_ids = { person_id: 55, deal_id: 56 }
      expect(await hook().eraseLead!('L1', { actor: 'x' }, db as any)).toEqual({ crm_pessoas: 1 })
      expect(crm.calls).toEqual(['deletePerson'])
    })
    it('lead que nunca foi ao CRM nao chama a API', async () => {
      expect(await hook().eraseLead!('L1', { actor: 'x' }, db as any)).toEqual({ crm_pessoas: 0 })
      expect(crm.calls).toEqual([])
    })
    it('se nao conseguir apagar, falha alto (o pedido do titular nao e dado como concluido)', async () => {
      db.leads.get('L1').pipedrive_ids = { person_id: 55 }
      crm.failNext = [new CrmApiError(500)]
      await expect(hook().eraseLead!('L1', { actor: 'x' }, db as any)).rejects.toBeInstanceOf(CrmApiError)
    })
  })
})
