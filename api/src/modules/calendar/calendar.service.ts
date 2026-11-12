import { BadGatewayException, ConflictException, Inject, Injectable, Logger, NotFoundException, OnModuleInit, ServiceUnavailableException } from '@nestjs/common'
import { Db, PgService } from '../pilot/pg.service'
import { registerSubjectHook } from '../pilot/compliance/subject-hooks'
import { PilotService } from '../pilot/pilot.service'
import { AuditService, RequestCtx } from '../pilot/compliance/audit.service'
import { AdvisoryLockService } from '../pilot/broadcasts/advisory-lock.service'
import { CalendarRules, calendarEnabled, freeSlots, isBookable, parseRules } from './calendar.rules'
import { CALENDAR_ADAPTER, CalendarAdapter, CalendarApiError, CalendarNotConfiguredError } from './calendar.types'

export const CALENDAR_LOCK_KEY = 7_204_009

/**
 * Agenda do Alberto (Google Calendar). Horarios livres = regras (dias, janela, duracao, antecedencia) menos o que a
 * agenda ja tem ocupado. Agendar: trava (um agendamento por vez), confere de novo que o horario esta livre, cria o evento
 * e registra `reuniao_marcada` no funil (que por sua vez entra na fila do CRM). Se o registro falhar depois de criar o
 * evento, o evento e desfeito: nao fica reuniao fantasma na agenda.
 */
@Injectable()
export class CalendarService implements OnModuleInit {
  private readonly log = new Logger('Calendar')

  constructor(
    private readonly pg: PgService,
    private readonly pilot: PilotService,
    private readonly audit: AuditService,
    private readonly lock: AdvisoryLockService,
    @Inject(CALENDAR_ADAPTER) private readonly cal: CalendarAdapter,
  ) {}

  onModuleInit() {
    // Direito de exclusao/anonimizacao (LGPD): apaga da agenda os eventos criados para o lead. Roda ANTES de o payload dos
    // eventos do funil ser limpo (e la que mora o id). Falha ALTO: se nao conseguir apagar, o pedido do titular fica em andamento.
    const purge = async (leadId: string, _ctx: unknown, db: Db) => {
      const ids = (await db.query(`SELECT payload->>'calendarEventId' AS id FROM horizon_agent.lead_events WHERE lead_id = $1 AND type = 'reuniao_marcada' AND payload ? 'calendarEventId'`, [leadId])).rows
        .map((r: any) => r.id).filter((x: unknown): x is string => typeof x === 'string' && x.length > 0)
      for (const id of ids) await this.cal.deleteEvent(id) // nao configurado => lanca, de proposito
      return { agenda_eventos: ids.length }
    }
    registerSubjectHook({ name: 'calendar', eraseLead: purge, anonymizeLead: purge })
  }

  get rules(): CalendarRules { return parseRules(process.env.CALENDAR_RULES) }

  status() {
    return { enabled: calendarEnabled(), ...this.cal.status(), rules: this.rules }
  }

  private async busy(rules: CalendarRules, now: Date) {
    const to = new Date(now.getTime() + (rules.horizonDays + 1) * 86_400_000)
    try {
      return await this.cal.busy(now, to, rules.timezone)
    } catch (e) {
      throw this.toHttp(e)
    }
  }

  private toHttp(e: unknown): Error {
    if (e instanceof CalendarNotConfiguredError) return new ServiceUnavailableException('Agenda não configurada')
    if (e instanceof CalendarApiError) return new BadGatewayException('Agenda indisponível no momento')
    return e as Error
  }

  async slots(limit = 20, now: Date = new Date()) {
    const rules = this.rules
    const busy = await this.busy(rules, now)
    return { timezone: rules.timezone, durationMin: rules.durationMin, slots: freeSlots(rules, busy, now, Math.min(50, Math.max(1, limit))) }
  }

  async book(leadId: string, startIso: string, ctx: RequestCtx, now: Date = new Date()) {
    const lead = (await this.pg.query(`SELECT id, name, phone, opt_out, anonymized_at FROM horizon_agent.leads WHERE id = $1 AND tenant = $2`, [leadId, this.pilot.tenant])).rows[0]
    if (!lead) throw new NotFoundException('Lead não encontrado')
    if (lead.anonymized_at || lead.opt_out) throw new ConflictException('Lead não pode ser contatado')
    const has = await this.pg.query(`SELECT 1 FROM horizon_agent.lead_events WHERE lead_id = $1 AND type = 'reuniao_marcada' LIMIT 1`, [leadId])
    if (has.rowCount) throw new ConflictException('Este lead já tem reunião marcada')

    const rules = this.rules
    const r = await this.lock.withLock(CALENDAR_LOCK_KEY, async () => {
      const slot = isBookable(rules, await this.busy(rules, now), now, startIso)
      if (!slot) throw new ConflictException('Horário indisponível')

      let eventId: string
      try {
        const first = (lead.name ?? '').trim().split(/\s+/)[0] || 'Lead'
        eventId = await this.cal.createEvent({
          start: new Date(slot.start), end: new Date(slot.end), timezone: rules.timezone,
          summary: `Reunião · ${first.slice(0, 40)}`,
          description: `Lead: ${lead.name ?? 'sem nome'}\nTelefone: ${lead.phone}\nMarcada pelo painel Horizon Agent.`,
        })
      } catch (e) {
        throw this.toHttp(e)
      }

      try {
        await this.pilot.addEvent(leadId, 'reuniao_marcada', { actor: 'humano', payload: { calendarEventId: eventId, start: slot.start } })
        await this.audit.log({ ...ctx, action: 'calendar.book', entity: 'lead', entityId: leadId, details: { start: slot.start } })
      } catch (e) {
        await this.cal.deleteEvent(eventId).catch(() => this.log.error('Nao foi possivel desfazer o evento criado')) // compensacao
        throw e
      }
      return { start: slot.start, end: slot.end, eventId }
    })
    if (!r.ran) throw new ConflictException('Já existe um agendamento em andamento. Tente de novo.')
    return r.result!
  }
}
