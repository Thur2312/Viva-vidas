import { CanActivate, ExecutionContext, Logger, INestApplication, UnauthorizedException, ValidationPipe } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'
import { Test } from '@nestjs/testing'
import * as request from 'supertest'
import { RolesGuard } from '../../panel-auth/roles.guard'
import { PgService } from '../pg.service'
import { PilotModule } from '../pilot.module'
import { testPlaybook } from './fixtures/test-playbook'
import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { CreatePlaybookDto } from './playbook.dto'
import { emptyPlaybookTemplate } from './playbook.template'

// Autenticação de teste: o papel vem do header x-test-role (sem ele, 401). O RolesGuard é o REAL.
class HeaderAuthGuard implements CanActivate {
  canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest()
    const role = req.headers['x-test-role']
    if (!role) throw new UnauthorizedException()
    req.user = { userId: 'user-1', role }
    return true
  }
}

describe('PlaybookController (HTTP)', () => {
  let app: INestApplication
  let sqls: { sql: string; params: any[] }[]
  let txLog: string[]
  let rows: Record<number, any>
  let active: any
  let failView = false
  let uniqueFailures = 0

  const norm = (s: string) => s.replace(/\s+/g, ' ').trim()
  const run = async (sql: string, params: any[] = []) => {
    const s = norm(sql)
    sqls.push({ sql: s, params })
    if (/FROM horizon_agent\.agent_readiness_by_action/.test(s)) {
      if (failView) throw Object.assign(new Error('relation does not exist: secreto'), { code: '42P01' })
      return { rows: [{ action: 'perguntar_campo', drafts: 3, compared: 2, usable_rate: 0.5, guard_failures: 0 }], rowCount: 1 }
    }
    if (/FROM horizon_agent\.agent_readiness/.test(s)) return { rows: [{ stage: 'novo', drafts: 1 }], rowCount: 1 }
    if (/INSERT INTO horizon_agent\.playbook_versions/.test(s)) {
      if (uniqueFailures > 0) { uniqueFailures--; throw Object.assign(new Error('dup'), { code: '23505' }) }
      return { rows: [{ version: 7 }], rowCount: 1 }
    }
    if (/^SELECT .* FROM horizon_agent\.playbook_versions WHERE active/.test(s)) return { rows: active ? [active] : [], rowCount: active ? 1 : 0 }
    if (/^SELECT .* FROM horizon_agent\.playbook_versions WHERE version = \$1/.test(s)) {
      const r = rows[params[0]]
      return { rows: r ? [r] : [], rowCount: r ? 1 : 0 }
    }
    if (/^SELECT .* FROM horizon_agent\.playbook_versions/.test(s)) return { rows: Object.values(rows), rowCount: 1 }
    if (/^UPDATE horizon_agent\.playbook_versions/.test(s)) return { rows: [{ version: params[0] }], rowCount: 1 }
    return { rows: [], rowCount: 0 }
  }
  const fakePg = {
    query: run,
    tx: async (fn: (db: any) => Promise<any>) => {
      txLog.push('BEGIN')
      try { const r = await fn({ query: run }); txLog.push('COMMIT'); return r } catch (e) { txLog.push('ROLLBACK'); throw e }
    },
  }

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      imports: [PilotModule],
      providers: [{ provide: APP_GUARD, useClass: HeaderAuthGuard }, { provide: APP_GUARD, useClass: RolesGuard }],
    }).overrideProvider(PgService).useValue(fakePg).compile()
    app = mod.createNestApplication()
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))
    await app.init()
  })
  afterAll(async () => { await app.close() })
  beforeEach(() => {
    sqls = []; txLog = []; failView = false; uniqueFailures = 0
    rows = {
      1: { version: 1, status: 'ativo', source: 'manual', notes: null, created_at: 'x', data: testPlaybook },
      2: { version: 2, status: 'rascunho', source: 'manual', notes: 'n', created_at: 'x', data: testPlaybook },
      3: { version: 3, status: 'rascunho', source: 'manual', notes: null, created_at: 'x', data: emptyPlaybookTemplate() },
    }
    active = rows[1]
  })
  const http = () => request(app.getHttpServer())
  const as = (role: string, r: request.Test) => r.set('x-test-role', role)
  const audits = () => sqls.filter((q) => /INSERT INTO horizon_agent\.audit_log/.test(q.sql))
  const dataParam = (q: { params: any[] }) => JSON.parse(q.params.find((p) => typeof p === 'string' && p.startsWith('{')))

  it('GET sem JWT: 401', async () => {
    await http().get('/pilot/playbook').expect(401)
  })

  it('GET (viewer): ativo, versões e modelo', async () => {
    const r = await as('viewer', http().get('/pilot/playbook')).expect(200)
    expect(r.body.active).toMatchObject({ version: 1, status: 'ativo' })
    expect(r.body.versions.length).toBe(3)
    expect(r.body.template.campos).toEqual([])
  })

  it('GET sem versão ativa: active null', async () => {
    active = null
    const r = await as('viewer', http().get('/pilot/playbook')).expect(200)
    expect(r.body.active).toBeNull()
  })

  it('GET /:version: devolve, 404 se não existe, 400 se não for inteiro positivo', async () => {
    const r = await as('viewer', http().get('/pilot/playbook/2')).expect(200)
    expect(r.body).toMatchObject({ version: 2, status: 'rascunho', notes: 'n', source: 'manual' })
    await as('viewer', http().get('/pilot/playbook/99')).expect(404)
    await as('viewer', http().get('/pilot/playbook/abc')).expect(400)
    await as('viewer', http().get('/pilot/playbook/0')).expect(400)
  })

  it('viewer e manager não escrevem: POST, PUT e activate dão 403', async () => {
    await as('viewer', http().post('/pilot/playbook').send({})).expect(403)
    await as('viewer', http().put('/pilot/playbook/2').send({ notes: 'x' })).expect(403)
    await as('viewer', http().post('/pilot/playbook/2/activate')).expect(403)
    await as('manager', http().post('/pilot/playbook/2/activate')).expect(403)
    expect(sqls.length).toBe(0)
  })

  it('POST com corpo vazio cria rascunho a partir do ativo e audita só a versão', async () => {
    const r = await as('owner', http().post('/pilot/playbook').send({})).expect(201)
    expect(r.body).toEqual({ version: 7 })
    const ins = sqls.find((q) => /INSERT INTO horizon_agent\.playbook_versions/.test(q.sql))!
    expect(ins.sql).toMatch(/coalesce\(max\(version\), ?0\) ?\+ ?1/)
    expect(ins.sql).toMatch(/'rascunho'/)
    expect(ins.sql).toMatch(/'manual'/)
    expect(dataParam(ins)).toMatchObject({ oferta: testPlaybook.oferta })
    expect(audits().length).toBe(1)
    expect(audits()[0].params[1]).toBe('playbook.create')
    expect(JSON.parse(audits()[0].params[5])).toEqual({ version: 7 })
  })

  it('POST sem ativo e sem corpo parte do modelo vazio', async () => {
    active = null
    await as('owner', http().post('/pilot/playbook').send({})).expect(201)
    const ins = sqls.find((q) => /INSERT INTO horizon_agent\.playbook_versions/.test(q.sql))!
    expect(dataParam(ins).campos).toEqual([])
  })

  it('POST com fromVersion usa os dados dessa versão; inexistente dá 404', async () => {
    await as('owner', http().post('/pilot/playbook').send({ fromVersion: 3 })).expect(201)
    await as('owner', http().post('/pilot/playbook').send({ fromVersion: 99 })).expect(404)
  })

  it('POST tenta de novo uma vez em violação de unicidade (23505)', async () => {
    uniqueFailures = 1
    await as('owner', http().post('/pilot/playbook').send({})).expect(201)
    expect(sqls.filter((q) => /INSERT INTO horizon_agent\.playbook_versions/.test(q.sql)).length).toBe(2)
    sqls = []; uniqueFailures = 2
    await as('owner', http().post('/pilot/playbook').send({})).expect(500)
  })

  it('valida limites: notes > 500, data não-objeto, data > 200 KB', async () => {
    await as('owner', http().post('/pilot/playbook').send({ notes: 'x'.repeat(501) })).expect(400)
    await as('owner', http().post('/pilot/playbook').send({ data: 'texto' })).expect(400)
    // Acima de 200 KB: 413 do parser do Express (limite padrão do teste, 100 KB) ou 400 do DTO (em produção BODY_LIMIT é 1mb).
    const tooBig = (r: request.Response) => expect([400, 413]).toContain(r.status)
    await as('owner', http().post('/pilot/playbook').send({ data: { oferta: { descricao: 'x'.repeat(200_001), publico: '' } } })).expect(tooBig)
    await as('owner', http().put('/pilot/playbook/2').send({ data: { fatos: 'x'.repeat(200_001) } })).expect(tooBig)
    expect(sqls.length).toBe(0)
  })

  it('DTO rejeita data acima de 200 KB e aceita abaixo', async () => {
    const big = plainToInstance(CreatePlaybookDto, { data: { oferta: { descricao: 'x'.repeat(205_000) } } })
    expect((await validate(big)).length).toBe(1)
    const ok = plainToInstance(CreatePlaybookDto, { data: { oferta: { descricao: 'x'.repeat(1000) } } })
    expect((await validate(ok)).length).toBe(0)
  })

  it('PUT em versão ativa: 409; inexistente: 404', async () => {
    await as('owner', http().put('/pilot/playbook/1').send({ notes: 'x' })).expect(409)
    await as('owner', http().put('/pilot/playbook/99').send({ notes: 'x' })).expect(404)
    expect(sqls.some((q) => /^UPDATE/.test(q.sql))).toBe(false)
  })

  it('PUT em rascunho atualiza dados e re-renderiza o body; audita só a versão', async () => {
    await as('owner', http().put('/pilot/playbook/3').send({ data: testPlaybook, notes: 'ajuste' })).expect(200)
    const up = sqls.find((q) => /^UPDATE horizon_agent\.playbook_versions/.test(q.sql))!
    expect(up.sql).toMatch(/status = 'rascunho'/)
    expect(up.params).toContain('ajuste')
    expect(up.params.some((p) => typeof p === 'string' && p.includes('EXEMPLO FICTÍCIO DE TESTE') && !p.startsWith('{'))).toBe(true)
    expect(audits()[0].params[1]).toBe('playbook.update')
    expect(JSON.parse(audits()[0].params[5])).toEqual({ version: 3 })
  })

  it('activate de versão que não é rascunho (inclusive a ativa): 409', async () => {
    await as('owner', http().post('/pilot/playbook/1/activate')).expect(409)
    expect(txLog).toEqual([])
  })

  it('activate com playbook incompleto: 422 com code, message e missing', async () => {
    const r = await as('owner', http().post('/pilot/playbook/3/activate')).expect(422)
    expect(r.body.code).toBe('playbook_incompleto')
    expect(r.body.message).toMatch(/^Playbook incompleto/)
    expect(r.body.missing.length).toBeGreaterThan(3)
    expect(txLog).toEqual([])
  })

  it('I5: activate de playbook estruturalmente parcial/malformado dá 422, nunca 500', async () => {
    for (const data of [
      { oferta: { descricao: 5, publico: ['x'] }, campos: 'y', objecoes: [{ gatilho: 1 }], fatos: [null], agenda: 'z' },
      { campos: [{ chave: 'a', pergunta: 1, obrigatorio: true }], criterios: { qualificado: { all: 'x' } } },
      'texto',
    ]) {
      rows[4] = { version: 4, status: 'rascunho', source: 'manual', notes: null, created_at: 'x', data }
      const r = await as('owner', http().post('/pilot/playbook/4/activate')).expect(422)
      expect(r.body.code).toBe('playbook_incompleto')
    }
    expect(txLog).toEqual([])
  })

  it('I5: POST e PUT gravam o playbook normalizado (chaves conhecidas, padrões, sem exemplos)', async () => {
    const raw = { oferta: { descricao: 'd' }, campos: [{ chave: 'c', sensivel: true, obrigatorio: true }], lixo: 1, exemplos: { a: 'b' } }
    await as('owner', http().post('/pilot/playbook').send({ data: raw })).expect(201)
    const ins = dataParam(sqls.find((q) => /INSERT INTO horizon_agent\.playbook_versions/.test(q.sql))!)
    expect(ins).not.toHaveProperty('lixo')
    expect(ins).not.toHaveProperty('exemplos')
    expect(ins.regrasProibidas).toEqual([])
    expect(ins.tom.frases).toEqual([])
    expect(ins.campos[0]).toMatchObject({ chave: 'c', sensivel: true, obrigatorio: false })
    sqls = []
    await as('owner', http().put('/pilot/playbook/3').send({ data: raw })).expect(200)
    const up = dataParam(sqls.find((q) => /^UPDATE horizon_agent\.playbook_versions/.test(q.sql))!)
    expect(up).not.toHaveProperty('lixo')
    expect(up.objecoes).toEqual([])
  })

  it('activate completo: 200; arquiva o ativo e ativa, nessa ordem, dentro da transação', async () => {
    await as('owner', http().post('/pilot/playbook/2/activate')).expect(200)
    expect(txLog).toEqual(['BEGIN', 'COMMIT'])
    const ups = sqls.filter((q) => /^UPDATE horizon_agent\.playbook_versions/.test(q.sql))
    expect(ups.length).toBe(2)
    expect(ups[0].sql).toMatch(/SET active = false, status = 'arquivado' WHERE active/)
    expect(ups[1].sql).toMatch(/SET active = true, status = 'ativo', body = \$2 WHERE version = \$1/)
    expect(ups[1].params[0]).toBe(2)
    expect(ups[1].params[1]).toContain('EXEMPLO FICTÍCIO DE TESTE')
    expect(audits()[0].params[1]).toBe('playbook.activate')
    expect(JSON.parse(audits()[0].params[5])).toEqual({ version: 2 })
  })

  it('readiness traz byAction e tolera a view ausente (migration 011 não aplicada)', async () => {
    const ok = await as('viewer', http().get('/pilot/readiness')).expect(200)
    expect(ok.body.byAction[0]).toMatchObject({ action: 'perguntar_campo', drafts: 3 })
    expect(ok.body.stages.length).toBe(1)
    failView = true
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation()
    const r = await as('viewer', http().get('/pilot/readiness')).expect(200)
    expect(r.body.byAction).toEqual([])
    expect(JSON.stringify(warn.mock.calls)).not.toContain('secreto')
    warn.mockRestore()
    expect(r.body.stages.length).toBe(1)
  })
})
