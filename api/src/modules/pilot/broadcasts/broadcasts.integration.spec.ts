import { randomBytes } from 'crypto'
import { Client } from 'pg'
import { PilotService } from '../pilot.service'
import { AuditService } from '../compliance/audit.service'
import { ConsentService } from '../compliance/consent.service'
import { CryptoService } from '../compliance/crypto.service'
import { BroadcastsService } from './broadcasts.service'
import { BroadcastsWorker } from './broadcasts.worker'
import { HealthService } from './health.service'
import { TemplatesService } from './templates.service'

// Banco real, SEMPRE dentro de uma transação com ROLLBACK, tenant exclusivo de teste. NENHUMA chamada real ao chat/Meta:
// o gateway é um dublê. Sem PILOT_TEST_DATABASE_URL a suíte é ignorada.
const url = process.env.PILOT_TEST_DATABASE_URL
const d = url ? describe : describe.skip
jest.setTimeout(240_000)

const CTX = { actor: 'tester', ip: '127.0.0.1' }
const ALLDAYS = { windowDays: [0, 1, 2, 3, 4, 5, 6], windowStart: '00:00', windowEnd: '23:59' }
const TENANT = 'teste_rollback'

d('Disparos (banco real, com rollback)', () => {
  let client: Client
  let svc: PilotService
  let consents: ConsentService
  let service: BroadcastsService
  let worker: BroadcastsWorker
  let health: HealthService
  const saved = { ...process.env }

  const gw: any = {
    configured: () => true,
    status: () => ({ configured: true, missing: [], connectionId: '1' }),
    sendTemplate: jest.fn(),
    sendText: jest.fn(async () => { throw new Error('texto livre não é usado nestes testes') }),
    listTemplates: jest.fn(async () => []),
    createTemplate: jest.fn(),
    numberHealth: jest.fn(async () => ({ ok: false, error: 'chat_indisponivel' })),
  }
  const lock = { withLock: async (_k: number, fn: () => Promise<any>) => ({ ran: true, result: await fn() }) }

  beforeAll(async () => {
    process.env.PILOT_DATA_KEY = randomBytes(32).toString('base64')
    process.env.PILOT_PHONE_SALT = 'sal-de-teste-' + randomBytes(4).toString('hex')
    client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
    await client.connect()
  })
  afterAll(async () => {
    await client.end()
    process.env = { ...saved }
  })
  beforeEach(async () => {
    await client.query('BEGIN')
    const c = client as any
    const audit = new AuditService(c)
    consents = new ConsentService(c, audit)
    svc = new PilotService(c, new CryptoService(), consents, audit)
    ;(svc as any).tenant = TENANT
    gw.sendTemplate.mockReset()
    gw.sendTemplate.mockImplementation(async () => ({ wid: 'wamid.' + randomBytes(6).toString('hex') }))
    health = new HealthService(c, svc, gw, audit)
    const templates = new TemplatesService(c, gw, audit)
    service = new BroadcastsService(c, svc, audit, templates, gw, health)
    worker = new BroadcastsWorker(c, svc, audit, lock as any, gw, templates, service, health)
    delete process.env.BROADCASTS_ENABLED
    await seedTemplate()
    await seedHealth('GREEN', 'TIER_1K', 1000)
  })
  afterEach(async () => { await client.query('ROLLBACK') })

  const q = async (sql: string, p: any[] = []) => (await client.query(sql, p)).rows
  const seedTemplate = (status = 'APPROVED') =>
    q(
      `INSERT INTO horizon_agent.message_templates_cache (name, language, category, status, body_text, buttons, synced_at)
       VALUES ('retomada_contato','pt_BR','MARKETING',$1,'Olá {{1}}, aqui é da equipe de {{2}}. Quer retomar a conversa?','[{"type":"QUICK_REPLY","text":"Sim, quero"},{"type":"QUICK_REPLY","text":"Parar mensagens"}]'::jsonb, now())
       ON CONFLICT (name, language) DO UPDATE SET status = $1, synced_at = now(), body_text = EXCLUDED.body_text, buttons = EXCLUDED.buttons, category = 'MARKETING'`,
      [status],
    )
  const seedHealth = (quality: string, tier: string, limit: number | null, status = 'CONNECTED', ageMin = 1) =>
    q(
      `INSERT INTO horizon_agent.number_health_snapshots (tenant, checked_at, quality_rating, limit_tier, daily_limit, status, account_review_status)
       VALUES ($1, now() - ($2 || ' minutes')::interval, $3, $4, $5, $6, 'APPROVED')`,
      [TENANT, String(ageMin), quality, tier, limit, status],
    )
  let n = 0
  const phone = () => `839${String(81000000 + ++n * 7919 + Math.floor(Math.random() * 1000) * 100000).slice(0, 8)}`
  const mkLead = async (o: { name?: string; marketing?: boolean } = {}) =>
    svc.upsertLead(
      {
        phone: phone(), name: o.name ?? 'Maria Souza', optInOrigin: 'form_site',
        consents: o.marketing === false ? [] : [{ purpose: 'marketing', textVersion: 'mkt-v1', source: 'formulario_com_aviso:form_site_teste' }],
      },
      client as any,
    )
  const VARS = { '1': { source: 'lead.first_name' }, '2': { source: 'custom', value: 'Equipe Alberto' } }
  const mkBroadcast = async (o: Record<string, any> = {}) =>
    service.create({ name: 'Teste', templateName: 'retomada_contato', variablesMap: VARS, ...ALLDAYS, dryRun: false, ratePerMinute: 60, dailyCap: 200, ...o } as any, CTX)
  const start = async (id: string) => {
    const pv = await service.preview(id)
    return service.start(id, { confirm: true, expectedRecipients: pv.eligible }, CTX)
  }
  const recs = (id: string) => q(`SELECT lead_id, status, skip_reason, wid, error_code, attempts, next_attempt_at FROM horizon_agent.broadcast_recipients WHERE broadcast_id = $1 ORDER BY id`, [id])
  const statusOf = async (id: string) => (await q(`SELECT status, paused_reason, backoff_until FROM horizon_agent.broadcasts WHERE id = $1`, [id]))[0]

  it('público: cada porta de conformidade barra o lead certo, e bate com ConsentService.canContact', async () => {
    const ok = await mkLead()
    const noMkt = await mkLead({ marketing: false })
    const optOut = await mkLead(); await svc.addEvent(optOut.id, 'opt_out', { actor: 'sistema' }, client as any)
    const revoked = await mkLead(); await consents.revoke(revoked.id, 'marketing', 'teste', CTX, client as any)
    const anon = await mkLead(); await q(`UPDATE horizon_agent.leads SET anonymized_at = now() WHERE id = $1`, [anon.id])
    const badPhone = await mkLead(); await q(`UPDATE horizon_agent.leads SET phone = '1234' WHERE id = $1`, [badPhone.id])
    const noSource = await mkLead(); await q(`UPDATE horizon_agent.consents SET source = '' WHERE lead_id = $1 AND purpose = 'marketing'`, [noSource.id])

    const b = await mkBroadcast()
    const pv = await service.preview(b.id)
    expect(pv.total).toBe(7)
    expect(pv.eligible).toBe(1)
    const by = Object.fromEntries(pv.reasons.map((r: any) => [r.reason, r.n]))
    expect(by).toMatchObject({
      sem_consentimento_marketing: 1, opt_out: 1, marketing_revogado: 1, anonimizado: 1, telefone_invalido: 1, consentimento_sem_origem: 1,
    })
    // paridade com can_contact para quem tem opt-out/anonimização/revogação
    for (const [lead, expectBlocked] of [[ok, false], [optOut, true], [revoked, true]] as const) {
      const row = (await q(`SELECT * FROM horizon_agent.leads WHERE id = $1`, [lead.id]))[0]
      expect((await consents.canContact(row, client as any)).allowed).toBe(!expectBlocked)
    }
    expect(pv.warnings).toEqual([])
  })

  it('início: interruptor desligado barra o envio real; confirmação e contagem precisam bater; início único', async () => {
    await mkLead(); await mkLead(); await mkLead({ marketing: false })
    const b = await mkBroadcast()
    await expect(service.start(b.id, { confirm: true, expectedRecipients: 2 }, CTX)).rejects.toMatchObject({ status: 403 })
    expect(await recs(b.id)).toHaveLength(0)

    process.env.BROADCASTS_ENABLED = 'true'
    await expect(service.start(b.id, { confirm: false, expectedRecipients: 2 }, CTX)).rejects.toMatchObject({ status: 400 })
    await expect(service.start(b.id, { confirm: true, expectedRecipients: 3 }, CTX)).rejects.toMatchObject({ status: 409 })
    expect(await recs(b.id)).toHaveLength(0) // nada materializado em caso de divergência

    const started = await service.start(b.id, { confirm: true, expectedRecipients: 2 }, CTX)
    expect(started.status).toBe('running')
    const r = await recs(b.id)
    expect(r.filter((x: any) => x.status === 'pending')).toHaveLength(2)
    expect(r.find((x: any) => x.status === 'skipped')?.skip_reason).toBe('sem_consentimento_marketing')
    await expect(service.start(b.id, { confirm: true, expectedRecipients: 2 }, CTX)).rejects.toMatchObject({ status: 409 })
    // auditoria sem dado pessoal
    const audit = await q(`SELECT details::text AS d FROM horizon_agent.audit_log WHERE entity = 'broadcast' AND entity_id = $1`, [b.id])
    expect(audit.length).toBeGreaterThan(0)
    expect(audit.every((a: any) => !/\d{10,}/.test(a.d))).toBe(true)
  })

  it('unicidade: um lead nunca entra duas vezes no mesmo disparo (constraint)', async () => {
    const l = await mkLead()
    const b = await mkBroadcast()
    await q(`INSERT INTO horizon_agent.broadcast_recipients (broadcast_id, lead_id) VALUES ($1, $2)`, [b.id, l.id])
    await q('SAVEPOINT dup')
    await expect(client.query(`INSERT INTO horizon_agent.broadcast_recipients (broadcast_id, lead_id) VALUES ($1, $2)`, [b.id, l.id])).rejects.toThrow(/duplicate key|unique/i)
    await q('ROLLBACK TO dup')
  })

  it('reivindicação atômica: duas reivindicações seguidas nunca pegam o mesmo destinatário', async () => {
    const leads = [await mkLead(), await mkLead(), await mkLead()]
    const b = await mkBroadcast()
    for (const l of leads) await q(`INSERT INTO horizon_agent.broadcast_recipients (broadcast_id, lead_id) VALUES ($1, $2)`, [b.id, l.id])
    const claim = `UPDATE horizon_agent.broadcast_recipients SET status = 'queued', claimed_at = now(), attempts = attempts + 1
      WHERE id IN (SELECT id FROM horizon_agent.broadcast_recipients WHERE broadcast_id = $1 AND status = 'pending' ORDER BY id LIMIT 2 FOR UPDATE SKIP LOCKED) RETURNING id`
    const a = (await q(claim, [b.id])).map((r: any) => r.id)
    const c2 = (await q(claim, [b.id])).map((r: any) => r.id)
    expect(a).toHaveLength(2)
    expect(c2).toHaveLength(1)
    expect(new Set([...a, ...c2]).size).toBe(3)
  })

  it('simulação (dry-run): não chama o chat, mesmo com o interruptor desligado; registra o que SERIA enviado', async () => {
    await mkLead(); await mkLead()
    const b = await mkBroadcast({ dryRun: true })
    await start(b.id)
    expect((await worker.tick()).ran).toBe(true)
    expect(gw.sendTemplate).not.toHaveBeenCalled()
    expect(gw.sendText).not.toHaveBeenCalled()
    const r = await recs(b.id)
    expect(r.every((x: any) => x.status === 'sent' && x.wid === null)).toBe(true)
    expect((await statusOf(b.id)).status).toBe('completed')
    expect((await q(`SELECT 1 FROM horizon_agent.audit_log WHERE action = 'broadcast.batch' AND entity_id = $1`, [b.id])).length).toBe(1)
  })

  it('envio real: variáveis certas, wid gravado, sem reenvio no ciclo seguinte, frequência de 7 dias vale para o próximo disparo', async () => {
    process.env.BROADCASTS_ENABLED = 'true'
    const l1 = await mkLead({ name: 'Maria Souza' }); await mkLead({ name: 'João' })
    const b = await mkBroadcast()
    await start(b.id)
    await worker.tick()
    expect(gw.sendTemplate).toHaveBeenCalledTimes(2)
    const call = gw.sendTemplate.mock.calls.find((c: any) => c[0].variables[0] === 'Maria')[0]
    expect(call).toMatchObject({ templateName: 'retomada_contato', language: 'pt_BR', variables: ['Maria', 'Equipe Alberto'], requestedBy: `disparo:${b.id}` })
    expect(call.phone).toMatch(/^55\d{10,11}$/)
    const r = await recs(b.id)
    expect(r.every((x: any) => x.status === 'sent' && /^wamid\./.test(x.wid))).toBe(true)
    expect((await statusOf(b.id)).status).toBe('completed')
    await worker.tick(); await worker.tick()
    expect(gw.sendTemplate).toHaveBeenCalledTimes(2) // nunca duas vezes
    // novo disparo para os mesmos leads: bloqueado pela frequência
    const b2 = await mkBroadcast({ name: 'Outro' })
    const pv = await service.preview(b2.id)
    expect(pv.eligible).toBe(0)
    expect(pv.reasons.find((x: any) => x.reason === 'limite_frequencia')?.n).toBe(2)
    expect(l1.id).toBeTruthy()
  })

  it('porta no momento do envio: consentimento revogado depois do início pula o lead', async () => {
    process.env.BROADCASTS_ENABLED = 'true'
    const a = await mkLead(); const b2 = await mkLead()
    const b = await mkBroadcast()
    await start(b.id)
    await consents.revoke(b2.id, 'marketing', 'teste', CTX, client as any)
    await worker.tick()
    expect(gw.sendTemplate).toHaveBeenCalledTimes(1)
    const r = await recs(b.id)
    expect(r.find((x: any) => x.lead_id === b2.id)).toMatchObject({ status: 'skipped', skip_reason: 'marketing_revogado' })
    expect(r.find((x: any) => x.lead_id === a.id).status).toBe('sent')
  })

  it('teto diário efetivo nunca passa do limite real do número', async () => {
    process.env.BROADCASTS_ENABLED = 'true'
    await q(`DELETE FROM horizon_agent.number_health_snapshots WHERE tenant = $1`, [TENANT])
    await seedHealth('GREEN', 'TIER_50', 1) // limite real = 1/dia (simulado)
    await mkLead(); await mkLead(); await mkLead()
    const b = await mkBroadcast({ dailyCap: 200 })
    await start(b.id)
    await worker.tick()
    expect(gw.sendTemplate).toHaveBeenCalledTimes(1)
    expect((await statusOf(b.id)).status).toBe('running')
    await worker.tick()
    expect(gw.sendTemplate).toHaveBeenCalledTimes(1)
  })

  it('janela de envio: fora do horário (domingo) nada sai; dentro, sai', async () => {
    await mkLead()
    const b = await service.create({ name: 'Janela', templateName: 'retomada_contato', variablesMap: VARS, dryRun: true } as any, CTX) // janela padrão seg-sex 09-18
    await start(b.id)
    await worker.tick(new Date('2026-11-15T15:00:00Z')) // domingo
    expect((await recs(b.id))[0].status).toBe('pending')
    await worker.tick(new Date('2026-11-11T15:00:00Z')) // quarta 12:00 BRT
    expect((await recs(b.id))[0].status).toBe('sent')
  })

  it('template deixou de estar APROVADO: pausa e não envia', async () => {
    process.env.BROADCASTS_ENABLED = 'true'
    await mkLead()
    const b = await mkBroadcast()
    await start(b.id)
    await seedTemplate('PAUSED')
    await worker.tick()
    expect(gw.sendTemplate).not.toHaveBeenCalled()
    expect(await statusOf(b.id)).toMatchObject({ status: 'paused', paused_reason: 'template_nao_aprovado' })
  })

  it('auto-pausa: mais de 30% de falha nos últimos 20 envios pausa o disparo', async () => {
    process.env.BROADCASTS_ENABLED = 'true'
    gw.sendTemplate.mockImplementation(async () => { throw Object.assign(new Error('Chat respondeu 400'), { getStatus: () => 502 }) })
    for (let i = 0; i < 6; i++) await mkLead()
    const b = await mkBroadcast()
    await start(b.id)
    await worker.tick()
    expect(await statusOf(b.id)).toMatchObject({ status: 'paused', paused_reason: 'taxa_falha_alta' })
    const r = await recs(b.id)
    expect(r.every((x: any) => x.status === 'failed' && x.error_code === 'chat_400')).toBe(true)
    expect((await q(`SELECT 1 FROM horizon_agent.audit_log WHERE action = 'broadcast.autopause' AND entity_id = $1`, [b.id])).length).toBe(1)
    await worker.tick() // pausado: nada mais é tentado
    expect(gw.sendTemplate).toHaveBeenCalledTimes(6)
  })

  it('429 do chat: backoff exponencial, destinatário volta à fila, sem reenvio imediato', async () => {
    process.env.BROADCASTS_ENABLED = 'true'
    gw.sendTemplate.mockImplementation(async () => { throw Object.assign(new Error('Chat respondeu 429'), { getStatus: () => 502 }) })
    await mkLead(); await mkLead()
    const b = await mkBroadcast()
    await start(b.id)
    await worker.tick()
    expect(gw.sendTemplate).toHaveBeenCalledTimes(1)
    const r = await recs(b.id)
    expect(r.map((x: any) => x.status)).toEqual(['pending', 'pending'])
    const tried = r.find((x: any) => x.next_attempt_at)
    const untouched = r.find((x: any) => !x.next_attempt_at)
    expect(new Date(tried.next_attempt_at).getTime()).toBeGreaterThan(Date.now() + 20_000)
    expect(tried.attempts).toBe(1)
    expect(untouched.attempts).toBe(0) // o outro foi devolvido sem gastar tentativa
    const st = await statusOf(b.id)
    expect(st.status).toBe('running')
    expect(new Date(st.backoff_until).getTime()).toBeGreaterThan(Date.now())
    await worker.tick()
    expect(gw.sendTemplate).toHaveBeenCalledTimes(1) // em backoff
  })

  it('processo caiu no meio do envio: "em fila" antigo vira falha e NUNCA é reenviado', async () => {
    process.env.BROADCASTS_ENABLED = 'true'
    const l = await mkLead()
    const b = await mkBroadcast()
    await start(b.id)
    await q(`UPDATE horizon_agent.broadcast_recipients SET status = 'queued', claimed_at = now() - interval '10 minutes', attempts = 1 WHERE broadcast_id = $1 AND lead_id = $2`, [b.id, l.id])
    await worker.tick()
    expect(gw.sendTemplate).not.toHaveBeenCalled()
    expect((await recs(b.id))[0]).toMatchObject({ status: 'failed', error_code: 'envio_interrompido' })
  })

  it('retorno de entrega só avança; resposta em até 72h marca replied (e só envio real)', async () => {
    process.env.BROADCASTS_ENABLED = 'true'
    const l = await mkLead()
    const b = await mkBroadcast()
    await start(b.id)
    await worker.tick()
    const wid = (await recs(b.id))[0].wid
    expect(await service.applyStatus(wid, 'delivered')).toEqual({ updated: 1 })
    expect(await service.applyStatus(wid, 'read')).toEqual({ updated: 1 })
    expect(await service.applyStatus(wid, 'delivered')).toEqual({ updated: 0 }) // não regride
    expect(await service.applyStatus(wid, 'failed', '131026')).toEqual({ updated: 0 }) // lido não vira falha
    expect((await recs(b.id))[0].status).toBe('read')
    await svc.ingestMessage({ phone: (await q(`SELECT phone FROM horizon_agent.leads WHERE id = $1`, [l.id]))[0].phone, direction: 'in', author: 'lead', body: 'oi', wid: 'in-1' }, client as any)
    expect((await recs(b.id))[0].status).toBe('replied')
    const det = await service.get(b.id)
    expect(det.funnel).toMatchObject({ sent: 1, delivered: 1, read: 1, replied: 1 })
    expect(det.broadcast.id).toBe(b.id)

    // simulação não vira resposta
    const l2 = await mkLead()
    const bd = await mkBroadcast({ dryRun: true })
    await start(bd.id)
    await worker.tick()
    await svc.ingestMessage({ phone: (await q(`SELECT phone FROM horizon_agent.leads WHERE id = $1`, [l2.id]))[0].phone, direction: 'in', author: 'lead', body: 'oi', wid: 'in-2' }, client as any)
    expect((await recs(bd.id)).find((x: any) => x.lead_id === l2.id).status).toBe('sent')
  })

  it('saúde do número: vermelho pausa o que está rodando, bloqueia novos inícios e a retomada exige saúde', async () => {
    process.env.BROADCASTS_ENABLED = 'true'
    await mkLead(); await mkLead()
    const b = await mkBroadcast({ ratePerMinute: 1 })
    await start(b.id)
    await seedHealth('RED', 'TIER_1K', 1000, 'CONNECTED', 0)
    expect(await health.enforce()).toBe(1)
    expect(await statusOf(b.id)).toMatchObject({ status: 'paused', paused_reason: 'saude_numero' })
    expect((await q(`SELECT details::text AS d FROM horizon_agent.audit_log WHERE action = 'broadcast.autopause' AND entity_id = $1`, [b.id]))[0].d).toMatch(/saude_numero/)
    await expect(service.resume(b.id, CTX)).rejects.toMatchObject({ status: 409 })
    const b2 = await mkBroadcast({ name: 'Novo' })
    await expect(start(b2.id)).rejects.toMatchObject({ status: 409 })
    expect(gw.sendTemplate).not.toHaveBeenCalled()
    // recuperou: volta a GREEN e a retomada é manual, com auditoria
    await seedHealth('GREEN', 'TIER_1K', 1000, 'CONNECTED', 0)
    await q(`UPDATE horizon_agent.number_health_snapshots SET checked_at = now() + interval '1 second' WHERE id = (SELECT max(id) FROM horizon_agent.number_health_snapshots WHERE tenant = $1)`, [TENANT])
    const resumed = await service.resume(b.id, CTX)
    expect(resumed.status).toBe('running')
    expect((await q(`SELECT 1 FROM horizon_agent.audit_log WHERE action = 'broadcast.resume' AND entity_id = $1`, [b.id])).length).toBe(1)
  })

  it('saúde do número: leitura com mais de 60 min é insegura para quem está rodando', async () => {
    process.env.BROADCASTS_ENABLED = 'true'
    await q(`DELETE FROM horizon_agent.number_health_snapshots WHERE tenant = $1`, [TENANT])
    await seedHealth('GREEN', 'TIER_1K', 1000, 'CONNECTED', 1)
    await mkLead()
    const b = await mkBroadcast()
    await start(b.id)
    await q(`UPDATE horizon_agent.number_health_snapshots SET checked_at = now() - interval '2 hours' WHERE tenant = $1`, [TENANT])
    expect(await health.enforce()).toBe(1)
    expect((await statusOf(b.id)).paused_reason).toBe('saude_numero')
  })

  it('cancelar libera a fila e a trilha de auditoria não guarda telefone', async () => {
    await mkLead(); await mkLead()
    const b = await mkBroadcast({ dryRun: true })
    await start(b.id)
    await service.cancel(b.id, CTX)
    expect((await recs(b.id)).every((x: any) => x.status === 'skipped' && x.skip_reason === 'disparo_cancelado')).toBe(true)
    const rows = await q(`SELECT details::text AS d FROM horizon_agent.audit_log WHERE entity_id = $1`, [b.id])
    expect(rows.some((r: any) => /55\d{10}|\b83\d{9}\b/.test(r.d))).toBe(false)
  })
})

d('Disparos: sem resíduo no banco', () => {
  it('nenhum dado do tenant de teste ficou para trás', async () => {
    const c = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
    await c.connect()
    try {
      const r = await c.query(
        `SELECT (SELECT count(*) FROM horizon_agent.broadcasts WHERE tenant = $1)::int AS b,
                (SELECT count(*) FROM horizon_agent.leads WHERE tenant = $1)::int AS l,
                (SELECT count(*) FROM horizon_agent.number_health_snapshots WHERE tenant = $1)::int AS h,
                (SELECT count(*) FROM horizon_agent.message_templates_cache WHERE name = 'retomada_contato')::int AS t`,
        [TENANT],
      )
      expect(r.rows[0]).toEqual({ b: 0, l: 0, h: 0, t: 0 })
    } finally { await c.end() }
  })
})
