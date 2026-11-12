import { randomBytes } from 'crypto'
import { Client } from 'pg'
import { PilotService } from '../pilot.service'
import { AuditService } from './audit.service'
import { ConsentService } from './consent.service'
import { CryptoService } from './crypto.service'
import { DataSubjectService } from './data-subject.service'
import { RetentionService } from './retention.service'

// Banco real, SEMPRE dentro de uma transação que sofre ROLLBACK, com tenant exclusivo de teste.
// Sem PILOT_TEST_DATABASE_URL a suíte é ignorada.
const url = process.env.PILOT_TEST_DATABASE_URL
const d = url ? describe : describe.skip

jest.setTimeout(120_000) // banco remoto: cada teste faz dezenas de idas e voltas

const CTX = { actor: 'tester', ip: '127.0.0.1' }
const ago = (days: number) => new Date(Date.now() - days * 86_400_000)

d('Conformidade LGPD (banco real, com rollback)', () => {
  let client: Client
  let svc: PilotService
  let subjects: DataSubjectService
  let consents: ConsentService
  let retention: RetentionService
  let crypto: CryptoService
  const saved = { ...process.env }

  beforeAll(async () => {
    process.env.PILOT_DATA_KEY = randomBytes(32).toString('base64')
    process.env.PILOT_PHONE_SALT = 'sal-de-teste-' + randomBytes(4).toString('hex')
    client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
    await client.connect()
  })
  afterAll(async () => { await client.end(); process.env = { ...saved } })
  beforeEach(async () => {
    await client.query('BEGIN')
    const c = client as any
    const audit = new AuditService(c)
    crypto = new CryptoService()
    consents = new ConsentService(c, audit)
    svc = new PilotService(c, crypto, consents, audit)
    subjects = new DataSubjectService(c, crypto, consents, audit)
    retention = new RetentionService(c, subjects, audit)
    for (const s of [svc, subjects, retention]) (s as any).tenant = 'teste_rollback'
  })
  afterEach(async () => { await client.query('ROLLBACK') })

  const db = () => client as any
  const q = async (sql: string, p: any[] = []) => (await client.query(sql, p)).rows
  const msg = (phone: string, body: string, extra: any = {}) => ({ phone, direction: 'in' as const, author: 'lead' as const, body, ...extra })

  // ───────────── Consentimento ─────────────
  describe('consentimento', () => {
    it('lead criado sem origem de opt-in (importação) NÃO ganha consentimento algum', async () => {
      const l = await svc.upsertLead({ phone: '83999990090', name: 'Importado' }, db())
      expect(await consents.list(l.id, db())).toEqual([])
      expect(await consents.hasActive(l.id, 'atendimento', db())).toBe(false)
    })

    it('lead que escreve primeiro ganha atendimento e qualificação com origem "mensagem_do_lead"', async () => {
      const r = await svc.ingestMessage(msg('83999990091', 'Oi, quero uma cotação', { wid: 'w-init-1' }), db())
      const rows = await consents.list(r.leadId, db())
      expect(rows.map((x: any) => x.purpose).sort()).toEqual(['atendimento', 'qualificacao'])
      expect(rows.every((x: any) => x.source === 'mensagem_do_lead')).toBe(true)
    })

    it('primeira mensagem enviada pela equipe (lead não escreveu antes) não cria consentimento', async () => {
      const r = await svc.ingestMessage({ phone: '83999990092', direction: 'out' as const, author: 'humano' as const, body: 'Olá!', wid: 'w-out-1' }, db())
      expect(await consents.list(r.leadId, db())).toEqual([])
    })

    it('marketing recusa origem em texto livre mesmo com versão do texto', async () => {
      const l = await svc.upsertLead({ phone: '83999990093', optInOrigin: 'teste_integracao' }, db())
      await expect(consents.grant(l.id, { purpose: 'marketing', textVersion: 'v1', source: 'planilha antiga' }, CTX, db())).rejects.toThrow(/tipo:referencia/)
    })

    it('lead novo registra atendimento e qualificação com a origem do opt-in', async () => {
      const l = await svc.upsertLead({ phone: '83999990001', optInOrigin: 'ctwa:anuncio-1' }, db())
      const rows = await consents.list(l.id, db())
      expect(rows.map((r: any) => r.purpose).sort()).toEqual(['atendimento', 'qualificacao'])
      expect(rows.every((r: any) => r.source === 'ctwa:anuncio-1' && r.legal_basis === 'procedimentos_preliminares')).toBe(true)
      expect(await consents.hasActive(l.id, 'marketing', db())).toBe(false)
      expect(await consents.hasActive(l.id, 'aprendizado_agente', db())).toBe(false)
    })

    it('marketing e aprendizado só com registro explícito completo', async () => {
      await expect(svc.upsertLead({ phone: '83999990002', consents: [{ purpose: 'marketing' }] }, db())).rejects.toThrow(/textVersion/)
    })

    it('concede explicitamente, é idempotente e revoga preservando o histórico', async () => {
      const l = await svc.upsertLead({ phone: '83999990003', consents: [{ purpose: 'marketing', textVersion: 'v1', source: 'formulario_com_aviso:teste-formulario-1' }] }, db())
      expect(await consents.hasActive(l.id, 'marketing', db())).toBe(true)
      const again = await consents.grant(l.id, { purpose: 'marketing', textVersion: 'v1', source: 'formulario_com_aviso:teste-formulario-1' }, CTX, db())
      expect(again.created).toBe(false)
      expect((await consents.revoke(l.id, 'marketing', 'teste', CTX, db())).revoked).toBe(1)
      expect((await consents.revoke(l.id, 'marketing', 'teste', CTX, db())).revoked).toBe(0)
      const mk = (await consents.list(l.id, db())).filter((r: any) => r.purpose === 'marketing')
      expect(mk).toHaveLength(1)
      expect(mk[0].revoked_at).not.toBeNull()
    })

    it('can_contact: opt-out e marketing revogado bloqueiam; lead normal não', async () => {
      const a = await svc.upsertLead({ phone: '83999990004', optInOrigin: 'teste_integracao' }, db())
      expect((await consents.canContact(a, db())).allowed).toBe(true)

      const b = await svc.upsertLead({ phone: '83999990005', consents: [{ purpose: 'marketing', textVersion: 'v1', source: 'formulario_com_aviso:teste-f-1' }] }, db())
      expect((await consents.canContact(b, db())).allowed).toBe(true)
      await consents.revoke(b.id, 'marketing', 'x', CTX, db())
      expect(await consents.canContact(b, db())).toEqual({ allowed: false, reason: 'marketing_revogado' })

      const c = await svc.upsertLead({ phone: '83999990006', optInOrigin: 'teste_integracao' }, db())
      await svc.addEvent(c.id, 'opt_out', {}, db())
      const fresh = (await q('SELECT * FROM horizon_agent.leads WHERE id=$1', [c.id]))[0]
      expect(await consents.canContact(fresh, db())).toEqual({ allowed: false, reason: 'opt_out' })
    })

    it('mensagem do agente é recusada para quem não pode ser contatado', async () => {
      const ok = await svc.ingestMessage({ ...msg('83999990007', 'oi'), direction: 'out', author: 'agente', wid: 'a1' }, db())
      expect(ok.duplicated).toBe(false)

      const l = await svc.upsertLead({ phone: '83999990008', optInOrigin: 'teste_integracao' }, db())
      await svc.addEvent(l.id, 'opt_out', {}, db())
      await expect(svc.ingestMessage({ ...msg('83999990008', 'oi'), direction: 'out', author: 'agente', wid: 'a2' }, db())).rejects.toThrow(/opt_out/)
      expect(await q(`SELECT 1 FROM horizon_agent.messages WHERE wid='a2'`)).toHaveLength(0)
      // o colaborador humano e o próprio lead continuam sendo registrados (é o histórico do que ocorreu)
      await expect(svc.ingestMessage({ ...msg('83999990008', 'pare'), wid: 'a3' }, db())).resolves.toMatchObject({ duplicated: false })
    })

    it('opt-out revoga todos os consentimentos e interrompe o aprendizado', async () => {
      const num = '83999990009'
      const l = await svc.upsertLead({ phone: num, name: 'Maria Oliveira', consents: [{ purpose: 'aprendizado_agente', textVersion: 'v1', source: 'formulario_com_aviso:teste-form-1' }] }, db())
      await svc.ingestMessage(msg(num, 'Quero um plano', { wid: 'l1' }), db())
      await svc.ingestMessage({ ...msg(num, 'Claro! Quantas vidas?', { wid: 'h1' }), direction: 'out', author: 'humano' }, db())
      expect(await q('SELECT 1 FROM horizon_agent.learned_examples WHERE source_lead_id=$1', [l.id])).toHaveLength(1)

      await svc.addEvent(l.id, 'opt_out', {}, db())
      const active = await q('SELECT 1 FROM horizon_agent.consents WHERE lead_id=$1 AND revoked_at IS NULL', [l.id])
      expect(active).toHaveLength(0)

      await svc.ingestMessage(msg(num, 'Outra pergunta', { wid: 'l2' }), db())
      await svc.ingestMessage({ ...msg(num, 'Resposta', { wid: 'h2' }), direction: 'out', author: 'humano' }, db())
      expect(await q('SELECT 1 FROM horizon_agent.learned_examples WHERE source_lead_id=$1', [l.id])).toHaveLength(1)
      expect((await q(`SELECT 1 FROM horizon_agent.audit_log WHERE action='lead.opt_out' AND entity_id=$1`, [l.id]))).toHaveLength(1)
    })
  })

  // ───────────── Aprendizado com redação ─────────────
  it('exemplo aprendido nasce redigido, não aprovado e marcado quando sensível', async () => {
    const num = '83999990010'
    await svc.upsertLead({ phone: num, name: 'João da Silva', consents: [{ purpose: 'aprendizado_agente', textVersion: 'v1', source: 'formulario_com_aviso:teste-form-1' }] }, db())
    await svc.ingestMessage(msg(num, 'Oi, sou João da Silva, CPF 529.982.247-25, tenho diabetes. Ligue 83 99999-0010', { wid: 'l1' }), db())
    const out = await svc.ingestMessage({ ...msg(num, 'Olá João! Vamos ver as opções.', { wid: 'h1' }), direction: 'out', author: 'humano' }, db())
    const ex = (await q('SELECT * FROM horizon_agent.learned_examples WHERE source_message_id=$1', [out.messageId]))[0]
    expect(ex.approved).toBe(false)
    expect(ex.pii_redacted).toBe(true)
    expect(ex.contains_sensitive).toBe(true)
    expect(ex.lead_message).not.toMatch(/João|Silva|529|99999/)
    expect(ex.lead_message).toContain('[CPF]')
    expect(ex.human_reply).toBe('Olá [LEAD]! Vamos ver as opções.')
  })

  it('sem consentimento de aprendizado nada é aprendido', async () => {
    const num = '83999990011'
    await svc.ingestMessage(msg(num, 'Quero cotar', { wid: 'l1' }), db())
    const out = await svc.ingestMessage({ ...msg(num, 'Claro', { wid: 'h1' }), direction: 'out', author: 'humano' }, db())
    expect(await q('SELECT 1 FROM horizon_agent.learned_examples WHERE source_message_id=$1', [out.messageId])).toHaveLength(0)
  })

  // ───────────── Criptografia em repouso ─────────────
  it('corpo da mensagem e do rascunho ficam cifrados no banco e decifrados na leitura', async () => {
    const num = '83999990012'
    const inbound = await svc.ingestMessage(msg(num, 'Tomo insulina todo dia', { wid: 'l1' }), db())
    const raw = (await q('SELECT body, contains_sensitive FROM horizon_agent.messages WHERE id=$1', [inbound.messageId]))[0]
    expect(raw.body).toMatch(/^enc:v1:/)
    expect(raw.body).not.toContain('insulina')
    expect(raw.contains_sensitive).toBe(true)

    await client.query(
      `INSERT INTO horizon_agent.agent_drafts (conversation_id, trigger_message_id, draft_body, model) VALUES ($1,$2,$3,'teste')`,
      [inbound.conversationId, inbound.messageId, crypto.encrypt('Entendi. Há quanto tempo usa?')],
    )
    const out = await svc.ingestMessage({ ...msg(num, 'Entendi! Há quanto tempo usa?', { wid: 'h1' }), direction: 'out', author: 'humano' }, db())
    expect(out.comparison?.humanAction).toBe('igual')

    const detail = await svc.getLead(inbound.leadId)
    expect(detail.messages.map((m: any) => m.body)).toContain('Tomo insulina todo dia')
    expect(detail.drafts[0].draft_body).toBe('Entendi. Há quanto tempo usa?')
  })

  it('ingestão sem PILOT_DATA_KEY falha fechado fora de teste', async () => {
    const key = process.env.PILOT_DATA_KEY
    const env = process.env.NODE_ENV
    delete process.env.PILOT_DATA_KEY
    process.env.NODE_ENV = 'production'
    try {
      await expect(svc.ingestMessage(msg('83999990013', 'oi'), db())).rejects.toThrow(/PILOT_DATA_KEY ausente/)
    } finally {
      process.env.PILOT_DATA_KEY = key
      process.env.NODE_ENV = env
    }
  })

  // ───────────── Minimização e auditoria ─────────────
  it('listagem mascara o telefone; detalhe mostra o completo; leitura é auditada sem dado pessoal', async () => {
    const num = '83999991234'
    const first = await svc.ingestMessage(msg(num, 'Boa tarde, tudo bem? ' + 'x'.repeat(300), { wid: 'l1' }), db())
    const list = await svc.listLeads({ pageSize: 100 })
    const row = list.data.find((r: any) => r.id === first.leadId)
    expect(row.phone).toBe('+55 83 9****-1234')
    expect(row.last_message.length).toBeLessThanOrEqual(120)

    const detail = await svc.getLead(first.leadId, CTX)
    expect(detail.lead.phone).toBe('5583999991234')
    expect(detail.lead).not.toHaveProperty('phone_hash')

    const audit = await q(`SELECT * FROM horizon_agent.audit_log WHERE action='lead.read' AND entity_id=$1`, [first.leadId])
    expect(audit).toHaveLength(1)
    expect(audit[0].actor).toBe('tester')
    expect(JSON.stringify(audit[0])).not.toMatch(/99999|1234|Boa tarde/)
  })

  // ───────────── Direitos do titular ─────────────
  describe('direitos do titular', () => {
    const num = '83999990020'
    let leadId: string

    beforeEach(async () => {
      const l = await svc.upsertLead({ phone: num, name: 'Ana Souza', optInOrigin: 'teste_integracao', source: { campaign_id: 'c9', campaign_name: 'Camp', ctwa_clid: 'abc', email: 'ana@x.com' }, consents: [{ purpose: 'aprendizado_agente', textVersion: 'v1', source: 'formulario_com_aviso:teste-f-1' }] }, db())
      leadId = l.id
      await svc.updateQualification(leadId, { qualification: { plano: 'Unimed', doenca: 'diabetes' } })
      const inb = await svc.ingestMessage(msg(num, 'Tenho diabetes, pago 1900', { wid: 'l1' }), db())
      await client.query(
        `INSERT INTO horizon_agent.agent_drafts (conversation_id, trigger_message_id, draft_body, model) VALUES ($1,$2,$3,'t')`,
        [inb.conversationId, inb.messageId, crypto.encrypt('Entendi, qual o plano?')],
      )
      await svc.ingestMessage({ ...msg(num, 'Qual o plano atual?', { wid: 'h1' }), direction: 'out', author: 'humano' }, db())
      await svc.addEvent(leadId, 'qualificado', { payload: { obs: 'conversa por telefone' } }, db())
    })

    it('acesso: exporta tudo em claro, registra pedido com prazo de 15 dias e audita', async () => {
      const ex = await subjects.exportLead(leadId, CTX, db())
      expect(ex.lead.phone).toBe('5583999991234'.replace('5583999991234', '55' + num))
      expect(ex.messages.map((m: any) => m.body)).toEqual(['Tenho diabetes, pago 1900', 'Qual o plano atual?'])
      expect(ex.drafts[0].draft_body).toBe('Entendi, qual o plano?')
      expect(ex.learnedExamples).toHaveLength(1)
      expect(ex.consents.length).toBeGreaterThanOrEqual(3)
      expect(ex.events.length).toBeGreaterThanOrEqual(2)

      const req = (await q('SELECT *, (due_at - requested_at) AS sla FROM horizon_agent.data_subject_requests WHERE lead_id=$1', [leadId]))[0]
      expect(req.type).toBe('acesso')
      expect(req.status).toBe('concluido')
      expect(req.completed_at).not.toBeNull()
      expect(req.sla.days).toBe(15)
      expect(await q(`SELECT 1 FROM horizon_agent.audit_log WHERE action='lead.export' AND entity_id=$1`, [leadId])).toHaveLength(1)
    })

    it('correção atualiza nome, telefone e qualificação; telefone duplicado dá conflito', async () => {
      const upd = await subjects.correct(leadId, { name: 'Ana Souza Lima', phone: '(83) 98888-0000', qualification: { vidas: 3 } }, CTX, db())
      expect(upd.name).toBe('Ana Souza Lima')
      expect(upd.phone).toBe('5583988880000')
      expect(upd.qualification).toMatchObject({ plano: 'Unimed', vidas: 3 })

      await svc.upsertLead({ phone: '83977770000', optInOrigin: 'teste_integracao' }, db())
      await expect(subjects.correct(leadId, { phone: '83977770000' }, CTX, db())).rejects.toThrow(/outro lead/)
      await expect(subjects.correct(leadId, {}, CTX, db())).rejects.toThrow(/Nada para corrigir/)
      const audits = await q(`SELECT details FROM horizon_agent.audit_log WHERE action='lead.correct' AND entity_id=$1`, [leadId])
      expect(JSON.stringify(audits)).not.toMatch(/Lima|98888/)
    })

    it('anonimização é irreversível e apaga conteúdo e derivados', async () => {
      const r = await subjects.anonymizeLead(leadId, CTX, {}, db())
      expect(r).toMatchObject({ anonymized: true, optOutBlockKept: false, messages: 2, learnedExamples: 1 })
      const lead = (await q('SELECT * FROM horizon_agent.leads WHERE id=$1', [leadId]))[0]
      expect(lead.name).toBeNull()
      expect(lead.phone).toMatch(/^anon:/)
      expect(lead.phone_hash).toBeNull()
      expect(lead.anonymized_at).not.toBeNull()
      expect(lead.qualification).toEqual({})
      expect(lead.source).toEqual({ campaign_id: 'c9', campaign_name: 'Camp' })
      for (const t of ['conversations', 'agent_drafts']) {
        const n = t === 'conversations'
          ? await q('SELECT 1 FROM horizon_agent.conversations WHERE lead_id=$1', [leadId])
          : await q('SELECT 1 FROM horizon_agent.agent_drafts d JOIN horizon_agent.conversations c ON c.id=d.conversation_id WHERE c.lead_id=$1', [leadId])
        expect(n).toHaveLength(0)
      }
      expect(await q('SELECT 1 FROM horizon_agent.learned_examples WHERE source_lead_id=$1', [leadId])).toHaveLength(0)
      expect((await q(`SELECT payload FROM horizon_agent.lead_events WHERE lead_id=$1`, [leadId])).every((e: any) => Object.keys(e.payload).length === 0)).toBe(true)
      expect(await q('SELECT 1 FROM horizon_agent.consents WHERE lead_id=$1 AND revoked_at IS NULL', [leadId])).toHaveLength(0)
      // idempotente
      await expect(subjects.anonymizeLead(leadId, CTX, {}, db())).resolves.toMatchObject({ anonymized: true, messages: 0 })
      // o mesmo telefone, sem opt-out, volta como lead novo
      const again = await svc.upsertLead({ phone: num, optInOrigin: 'teste_integracao' }, db())
      expect(again.id).not.toBe(leadId)
    })

    it('anonimização de lead com opt-out mantém só o hash do telefone e o bloqueio', async () => {
      await svc.addEvent(leadId, 'opt_out', {}, db())
      const r = await subjects.anonymizeLead(leadId, CTX, {}, db())
      expect(r.optOutBlockKept).toBe(true)
      const lead = (await q('SELECT * FROM horizon_agent.leads WHERE id=$1', [leadId]))[0]
      expect(lead.phone_hash).toMatch(/^[0-9a-f]{64}$/)
      expect(lead.phone).toBe(`anon:${lead.phone_hash}`)
      expect(lead.opt_out).toBe(true)
      expect(JSON.stringify(lead)).not.toContain(num)

      // o número continua bloqueado: nada é criado nem gravado
      const res = await svc.ingestMessage(msg(num, 'voltei', { wid: 'z1' }), db())
      expect(res).toMatchObject({ blocked: true, leadId })
      expect(await q('SELECT 1 FROM horizon_agent.leads WHERE tenant=$1', ['teste_rollback'])).toHaveLength(1)
      await expect(svc.registerEventByPhone(num, 'respondeu')).resolves.toMatchObject({ blocked: true })
    })

    it('eliminação apaga o lead em cascata, mas guarda o pedido; com opt-out vira anonimização', async () => {
      const r = await subjects.eraseLead(leadId, CTX, db())
      expect(r.erased).toBe(true)
      expect(await q('SELECT 1 FROM horizon_agent.leads WHERE id=$1', [leadId])).toHaveLength(0)
      expect(await q('SELECT 1 FROM horizon_agent.learned_examples WHERE source_lead_id=$1', [leadId])).toHaveLength(0)
      expect(await q('SELECT 1 FROM horizon_agent.messages m JOIN horizon_agent.conversations c ON c.id=m.conversation_id WHERE c.lead_id=$1', [leadId])).toHaveLength(0)
      const req = (await q(`SELECT * FROM horizon_agent.data_subject_requests WHERE lead_id=$1 AND type='eliminacao'`, [leadId]))[0]
      expect(req.status).toBe('concluido')

      const o = await svc.upsertLead({ phone: '83999990021', optInOrigin: 'teste_integracao' }, db())
      await svc.addEvent(o.id, 'opt_out', {}, db())
      const r2 = await subjects.eraseLead(o.id, CTX, db())
      expect(r2.erased).toBe(false)
      expect((await q('SELECT anonymized_at, phone_hash FROM horizon_agent.leads WHERE id=$1', [o.id]))[0].phone_hash).toMatch(/^[0-9a-f]{64}$/)
    })

    it('revogação de consentimento gera pedido concluído', async () => {
      const r = await subjects.revokeConsent(leadId, 'aprendizado_agente', CTX, db())
      expect(r.revoked).toBe(1)
      const req = (await q(`SELECT * FROM horizon_agent.data_subject_requests WHERE lead_id=$1 AND type='revogacao_consentimento'`, [leadId]))[0]
      expect(req.status).toBe('concluido')
      const list = await subjects.listRequests({ limit: 200 }, db())
      expect(list.some((x: any) => x.id === req.id && x.overdue === false)).toBe(true)
    })

    it('a trilha de auditoria desses pedidos não contém dado pessoal', async () => {
      await subjects.exportLead(leadId, CTX, db())
      await subjects.anonymizeLead(leadId, CTX, {}, db())
      const rows = await q(`SELECT actor, action, entity, entity_id, ip, details FROM horizon_agent.audit_log WHERE entity_id=$1`, [leadId])
      expect(rows.length).toBeGreaterThanOrEqual(3)
      expect(JSON.stringify(rows)).not.toMatch(/Ana|Souza|diabetes|99999|ana@x|83999990020/)
    })
  })

  // ───────────── Retenção ─────────────
  describe('retenção', () => {
    it('apaga mensagens/rascunhos vencidos, anonimiza lead inativo, preserva o resto e é idempotente', async () => {
      // A: inativo há 3 anos
      const a = await svc.ingestMessage(msg('83999990030', 'mensagem velha A', { wid: 'a1' }), db())
      // B: ativo, mas com mensagem e rascunho de 200 dias
      const bOld = await svc.ingestMessage(msg('83999990031', 'mensagem velha B', { wid: 'b1' }), db())
      await svc.ingestMessage(msg('83999990031', 'mensagem recente B', { wid: 'b2' }), db())
      // C: venda antiga, não é anonimizado automaticamente
      const c = await svc.ingestMessage(msg('83999990032', 'mensagem velha C', { wid: 'c1' }), db())
      await svc.addEvent(c.leadId, 'venda', { value: 1000 }, db())

      await client.query(
        `INSERT INTO horizon_agent.agent_drafts (conversation_id, trigger_message_id, draft_body, model, created_at) VALUES ($1,$2,$3,'t',$4)`,
        [bOld.conversationId, bOld.messageId, crypto.encrypt('rascunho velho'), ago(200)],
      )
      await client.query(`UPDATE horizon_agent.messages SET created_at=$2 WHERE id=$1`, [bOld.messageId, ago(200)])
      for (const x of [a, c]) {
        await client.query(`UPDATE horizon_agent.messages SET created_at=$2 WHERE conversation_id=$1`, [x.conversationId, ago(1100)])
        await client.query(`UPDATE horizon_agent.lead_events SET occurred_at=$2 WHERE lead_id=$1`, [x.leadId, ago(1100)])
        await client.query(`UPDATE horizon_agent.leads SET created_at=$2, updated_at=$2 WHERE id=$1`, [x.leadId, ago(1100)])
      }

      const r1 = await retention.run({ db: db() })
      expect(r1).toMatchObject({ messagesDays: 180, draftsDays: 180, leadsDays: 730, leadsAnonymized: 1 })
      expect(r1.messages).toBe(3) // A, B velha, C
      expect(r1.drafts).toBe(1)

      const la = (await q('SELECT anonymized_at, phone FROM horizon_agent.leads WHERE id=$1', [a.leadId]))[0]
      expect(la.anonymized_at).not.toBeNull()
      expect(la.phone).toMatch(/^anon:/)
      expect((await q('SELECT anonymized_at FROM horizon_agent.leads WHERE id=$1', [c.leadId]))[0].anonymized_at).toBeNull()
      expect((await q('SELECT anonymized_at FROM horizon_agent.leads WHERE id=$1', [bOld.leadId]))[0].anonymized_at).toBeNull()
      const left = await q('SELECT wid FROM horizon_agent.messages m JOIN horizon_agent.conversations c ON c.id=m.conversation_id JOIN horizon_agent.leads l ON l.id=c.lead_id WHERE l.tenant=$1', ['teste_rollback'])
      expect(left.map((m: any) => m.wid)).toEqual(['b2'])

      const r2 = await retention.run({ db: db() })
      expect(r2).toMatchObject({ drafts: 0, messages: 0, leadsAnonymized: 0 })

      const log = await q(`SELECT details, actor FROM horizon_agent.audit_log WHERE action='retention.purge'`)
      expect(log.length).toBeGreaterThanOrEqual(2)
      expect(log.every((l: any) => l.actor === 'sistema')).toBe(true)
      expect(log.map((l: any) => l.details.leadsAnonymized)).toEqual(expect.arrayContaining([1, 0]))
    })

    it('prazos vêm do ambiente', async () => {
      process.env.PILOT_RETENTION_MESSAGES_DAYS = '10'
      process.env.PILOT_RETENTION_DRAFTS_DAYS = 'abc'
      try {
        expect(retention.config()).toEqual({ messagesDays: 10, draftsDays: 180, leadsDays: 730 })
      } finally {
        delete process.env.PILOT_RETENTION_MESSAGES_DAYS
        delete process.env.PILOT_RETENTION_DRAFTS_DAYS
      }
    })
  })
})
