import { BadRequestException, ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common'
import { Db, PgService } from '../pg.service'
import { AuditService, RequestCtx } from '../compliance/audit.service'
import { emptyPlaybookTemplate } from './playbook.template'
import { validatePlaybook } from './playbook.validate'
import { PlaybookData, Predicate } from './types'

const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : [])
const txt = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
const lines = (v: unknown) => arr<unknown>(v).map(txt).filter(Boolean)

function predicateText(p: any): string {
  if (!p || typeof p !== 'object') return ''
  if (typeof p.campo === 'string') return p.valor === undefined ? `${p.campo} ${p.op}` : `${p.campo} ${p.op} ${p.valor}`
  const join = (items: Predicate[], sep: string) => arr<Predicate>(items).map(predicateText).filter(Boolean).join(sep)
  const all = join(p.all, ' E ')
  const any = join(p.any, ' OU ')
  return [all && `(${all})`, any && `(${any})`].filter(Boolean).join(' E ')
}

/** Texto legível (pt-BR) do playbook, gravado em `body` por compatibilidade. Omite seções vazias; ignora `exemplos`. */
export function renderPlaybookText(d: PlaybookData): string {
  const out: string[] = []
  const section = (title: string, body: (string | false | 0 | undefined)[]) => {
    const b = body.filter(Boolean) as string[]
    if (b.length) out.push([`## ${title}`, ...b].join('\n'))
  }
  const bullets = (items: string[]) => items.map((i) => `- ${i}`)

  section('Oferta', [txt(d?.oferta?.descricao) && `O que vendemos: ${txt(d.oferta.descricao)}`, txt(d?.oferta?.publico) && `Público: ${txt(d.oferta.publico)}`])
  section('Campos de qualificação', arr<any>(d?.campos)
    .slice().sort((a, b) => (a?.ordem ?? 0) - (b?.ordem ?? 0))
    .map((c) => {
      const flags = [c?.obrigatorio && 'obrigatório', c?.sensivel && 'sensível (nunca perguntar)'].filter(Boolean).join(', ')
      return `- ${txt(c?.chave)}${flags ? ` [${flags}]` : ''}${txt(c?.pergunta) ? `: ${txt(c.pergunta)}` : ''}${txt(c?.porque) ? ` (por quê: ${txt(c.porque)})` : ''}`
    }))
  section('Critérios', [
    predicateText(d?.criterios?.qualificado) && `Qualificado: ${predicateText(d.criterios.qualificado)}`,
    predicateText(d?.criterios?.desqualificado) && `Desqualificado: ${predicateText(d.criterios.desqualificado)}`,
  ])
  section('Objeções', arr<any>(d?.objecoes).map((o) => {
    const nunca = lines(o?.nuncaDizer)
    return `- Quando: ${txt(o?.gatilho)}\n  Responder: ${txt(o?.resposta)}${nunca.length ? `\n  Nunca dizer: ${nunca.join('; ')}` : ''}`
  }))
  section('Fatos aprovados', bullets(arr<any>(d?.fatos).map((f) => txt(f?.texto)).filter(Boolean)))
  const tom = d?.tom
  section('Tom de voz', [
    txt(tom?.formalidade) && `Formalidade: ${txt(tom.formalidade)}`,
    txt(tom?.tamanho) && `Tamanho das mensagens: ${txt(tom.tamanho)}`,
    txt(tom?.emoji) && `Emoji: ${txt(tom.emoji)}`,
    ...lines(tom?.frases).map((f) => `- Frase: ${f}`),
  ])
  section('Regras proibidas', bullets(lines(d?.regrasProibidas)))
  section('Passagem para humano', bullets(lines(d?.passagemHumano?.quando)))
  const ag = d?.agenda
  section('Agenda', [
    lines(ag?.tiposReuniao).length > 0 && `Tipos de reunião: ${lines(ag.tiposReuniao).join('; ')}`,
    ag?.duracaoMin > 0 && `Duração: ${ag.duracaoMin} minutos`,
    txt(ag?.janelas) && `Janelas: ${txt(ag.janelas)}`,
    txt(ag?.prometer) && `O que prometer: ${txt(ag.prometer)}`,
  ])
  const cad = d?.cadencia
  section('Cadência', [
    cad?.maxTentativas > 0 && `Máximo de tentativas sem resposta: ${cad.maxTentativas}`,
    txt(cad?.mensagem) && `Mensagem: ${txt(cad.mensagem)}`,
  ])
  return out.join('\n\n')
}

const VERSION_COLS = 'version, status, source, notes, created_at, data'

@Injectable()
export class PlaybookService {
  constructor(private readonly pg: PgService, private readonly audit: AuditService) {}

  async overview() {
    const act = await this.pg.query(`SELECT ${VERSION_COLS} FROM horizon_agent.playbook_versions WHERE active LIMIT 1`)
    const list = await this.pg.query(`SELECT ${VERSION_COLS} FROM horizon_agent.playbook_versions ORDER BY version DESC LIMIT 200`)
    const a = act.rows[0]
    return {
      active: a ? { version: a.version, data: a.data, status: a.status } : null,
      versions: list.rows.map((r: any) => ({ version: r.version, status: r.status, source: r.source, created_at: r.created_at })),
      template: emptyPlaybookTemplate(),
    }
  }

  private async row(version: number, db: Db = this.pg) {
    const { rows } = await db.query(`SELECT ${VERSION_COLS} FROM horizon_agent.playbook_versions WHERE version = $1`, [version])
    if (!rows[0]) throw new NotFoundException('Versão não encontrada')
    return rows[0]
  }

  async get(version: number) {
    const r = await this.row(version)
    return { version: r.version, data: r.data, status: r.status, notes: r.notes, source: r.source, created_at: r.created_at }
  }

  async create(dto: { data?: PlaybookData; notes?: string; fromVersion?: number }, ctx: RequestCtx) {
    let data: PlaybookData
    if (dto.data) data = dto.data
    else if (dto.fromVersion) data = (await this.row(dto.fromVersion)).data ?? emptyPlaybookTemplate()
    else {
      const { rows } = await this.pg.query(`SELECT ${VERSION_COLS} FROM horizon_agent.playbook_versions WHERE active LIMIT 1`)
      data = rows[0]?.data ?? emptyPlaybookTemplate()
    }
    const sql = `INSERT INTO horizon_agent.playbook_versions (version, body, notes, source, active, status, data)
      SELECT coalesce(max(version), 0) + 1, $1, $2, 'manual', false, 'rascunho', $3::jsonb FROM horizon_agent.playbook_versions
      RETURNING version`
    const params = [renderPlaybookText(data), dto.notes ?? null, JSON.stringify(data)]
    let version: number
    try {
      version = (await this.pg.query(sql, params)).rows[0].version
    } catch (e: any) {
      if (e?.code !== '23505') throw e
      version = (await this.pg.query(sql, params)).rows[0].version // corrida pelo mesmo número: uma nova tentativa
    }
    await this.audit.log({ ...ctx, action: 'playbook.create', entity: 'playbook', entityId: String(version), details: { version } })
    return { version }
  }

  async update(version: number, dto: { data?: PlaybookData; notes?: string }, ctx: RequestCtx) {
    if (dto.data === undefined && dto.notes === undefined) throw new BadRequestException('Nada para atualizar')
    const cur = await this.row(version)
    if (cur.status !== 'rascunho') throw new ConflictException('Só é possível editar um rascunho')
    const data: PlaybookData = dto.data ?? cur.data ?? emptyPlaybookTemplate()
    const { rowCount } = await this.pg.query(
      `UPDATE horizon_agent.playbook_versions SET data = $2::jsonb, body = $3, notes = coalesce($4, notes)
       WHERE version = $1 AND status = 'rascunho'`,
      [version, JSON.stringify(data), renderPlaybookText(data), dto.notes ?? null],
    )
    if (!rowCount) throw new ConflictException('Só é possível editar um rascunho')
    await this.audit.log({ ...ctx, action: 'playbook.update', entity: 'playbook', entityId: String(version), details: { version } })
    return { version }
  }

  async activate(version: number, ctx: RequestCtx) {
    const cur = await this.row(version)
    if (cur.status !== 'rascunho') throw new ConflictException('Só é possível ativar um rascunho')
    const data: PlaybookData = cur.data ?? emptyPlaybookTemplate()
    const check = validatePlaybook(data)
    if (!check.complete) {
      throw new UnprocessableEntityException({
        code: 'playbook_incompleto',
        message: `Playbook incompleto: ${check.missing.length} pendência(s).`,
        missing: check.missing,
      })
    }
    const body = renderPlaybookText(data)
    await this.pg.tx(async (db) => {
      // Ordem importa: o índice parcial playbook_one_active só admite uma linha ativa.
      await db.query(`UPDATE horizon_agent.playbook_versions SET active = false, status = 'arquivado' WHERE active`)
      const r = await db.query(
        `UPDATE horizon_agent.playbook_versions SET active = true, status = 'ativo', body = $2 WHERE version = $1 AND status = 'rascunho'`,
        [version, body],
      )
      if (!r.rowCount) throw new ConflictException('Só é possível ativar um rascunho') // desfaz o arquivamento
      await this.audit.log({ ...ctx, action: 'playbook.activate', entity: 'playbook', entityId: String(version), details: { version } }, db)
    })
    return { version, status: 'ativo' }
  }
}
