import { DEFAULT_WINDOW, parseWindowEnv, isValidWindow, toE164 } from './voice.config'
import { evaluateGates, GateInput, isWithinWindow, nextStatus } from './voice-gates'
import { statusesBefore } from './voice.service'

// 2026-11-12 é uma quinta-feira. America/Sao_Paulo = UTC-3 (sem horário de verão desde 2019).
const at = (iso: string) => new Date(iso)
const THU_10H = at('2026-11-12T13:00:00Z') // 10:00 em Brasília
const THU_08H = at('2026-11-12T11:00:00Z') // 08:00
const THU_18H = at('2026-11-12T21:00:00Z') // 18:00 (fim exclusivo)
const THU_1759 = at('2026-11-12T20:59:00Z')
const SAT_10H = at('2026-11-14T13:00:00Z')
const SUN_10H = at('2026-11-15T13:00:00Z')

const ok = (): GateInput => ({
  lead: { id: 'l1', phone: '5583999991234', opt_out: false, anonymized_at: null },
  canContact: { allowed: true, reason: 'ok' },
  hasAtendimentoConsent: true,
  announcementText: 'Esta ligação pode ser gravada para fins de atendimento.',
  window: DEFAULT_WINDOW,
  now: THU_10H,
  dncEnabled: false,
  dnc: null,
  phoneE164: '+5583999991234',
})
const code = (patch: Partial<GateInput>) => evaluateGates({ ...ok(), ...patch })?.code ?? null

describe('janela de horário', () => {
  it('padrão seg-sex 09:00-18:00 em America/Sao_Paulo', () => {
    expect(isWithinWindow(THU_10H, DEFAULT_WINDOW)).toBe(true)
    expect(isWithinWindow(THU_08H, DEFAULT_WINDOW)).toBe(false)
    expect(isWithinWindow(THU_1759, DEFAULT_WINDOW)).toBe(true)
    expect(isWithinWindow(THU_18H, DEFAULT_WINDOW)).toBe(false)
    expect(isWithinWindow(SAT_10H, DEFAULT_WINDOW)).toBe(false)
    expect(isWithinWindow(SUN_10H, DEFAULT_WINDOW)).toBe(false)
  })
  it('usa o fuso da janela, não o do servidor', () => {
    // 13:00Z = 09:00 em Manaus (UTC-4)
    expect(isWithinWindow(THU_10H, { ...DEFAULT_WINDOW, tz: 'America/Manaus' })).toBe(true)
    expect(isWithinWindow(at('2026-11-12T12:30:00Z'), { ...DEFAULT_WINDOW, tz: 'America/Manaus' })).toBe(false)
  })
  it('parse de VOICE_CALL_WINDOW; inválido vira null (nunca relaxa)', () => {
    expect(parseWindowEnv('1-5@09:00-18:00')).toEqual(DEFAULT_WINDOW)
    expect(parseWindowEnv('1,3,5@08:30-12:00@America/Manaus')).toEqual({ days: [1, 3, 5], start: '08:30', end: '12:00', tz: 'America/Manaus' })
    for (const bad of ['', 'lixo', '1-5@18:00-09:00', '1-5@09:00-25:00', '7@09:00-18:00', '1-5@09:00-18:00@Nao/Existe']) expect(parseWindowEnv(bad)).toBeNull()
    expect(isValidWindow({ days: [], start: '09:00', end: '18:00', tz: 'America/Sao_Paulo' })).toBe(false)
  })
  it('E.164 do telefone brasileiro', () => {
    expect(toE164('5583999991234')).toBe('+5583999991234')
    expect(toE164('83999991234')).toBe('+5583999991234')
    expect(toE164('123')).toBeNull()
    expect(toE164('anon:abc')).toBeNull()
  })
})

describe('portões de conformidade (fail closed)', () => {
  it('libera quando todos passam', () => expect(code({})).toBeNull())

  it('lead inexistente', () => expect(code({ lead: null })).toBe('lead_nao_encontrado'))
  it('lead anonimizado (coluna ou telefone anon:)', () => {
    expect(code({ lead: { ...ok().lead!, anonymized_at: new Date() } })).toBe('lead_anonimizado')
    expect(code({ lead: { ...ok().lead!, phone: 'anon:abc' } })).toBe('lead_anonimizado')
  })
  it('can_contact falso, opt-out ou resultado ausente bloqueiam', () => {
    expect(code({ canContact: { allowed: false, reason: 'opt_out' } })).toBe('contato_bloqueado')
    expect(code({ canContact: null })).toBe('contato_bloqueado')
    expect(code({ lead: { ...ok().lead!, opt_out: true } })).toBe('contato_bloqueado')
  })
  it('exige consentimento ativo da finalidade atendimento', () => expect(code({ hasAtendimentoConsent: false })).toBe('sem_consentimento_atendimento'))
  it('sem texto de aviso de gravação não liga (nulo, vazio ou só espaços)', () => {
    for (const t of [null, undefined, '', '   ']) expect(code({ announcementText: t })).toBe('aviso_gravacao_ausente')
  })
  it('telefone inválido', () => expect(code({ phoneE164: null })).toBe('telefone_invalido'))
  it('fora da janela', () => {
    expect(code({ now: THU_08H })).toBe('fora_da_janela')
    expect(code({ now: SAT_10H })).toBe('fora_da_janela')
  })
  it('DNC ligado sem verificador: recusa', () => {
    expect(code({ dncEnabled: true, dnc: null })).toBe('dnc_sem_verificador')
    expect(code({ dncEnabled: true, dnc: { configured: false } })).toBe('dnc_sem_verificador')
  })
  it('DNC: bloqueado recusa; só `blocked === false` libera; resultado indefinido recusa', () => {
    expect(code({ dncEnabled: true, dnc: { configured: true, blocked: true } })).toBe('dnc_bloqueado')
    expect(code({ dncEnabled: true, dnc: { configured: true } })).toBe('dnc_bloqueado')
    expect(code({ dncEnabled: true, dnc: { configured: true, blocked: false } })).toBeNull()
  })
  it('DNC desligado não consulta nada', () => expect(code({ dncEnabled: false, dnc: null })).toBeNull())
  it('a ordem é fixa: o primeiro portão que falha é o reportado', () => {
    expect(code({ lead: null, now: SAT_10H })).toBe('lead_nao_encontrado')
    expect(code({ hasAtendimentoConsent: false, announcementText: null })).toBe('sem_consentimento_atendimento')
  })
  it('as mensagens não carregam telefone nem nome', () => {
    const r = evaluateGates({ ...ok(), announcementText: '' })!
    expect(r.message).not.toMatch(/\d{8}/)
  })
})

describe('máquina de estados', () => {
  it('só avança', () => {
    expect(nextStatus('queued', 'ringing')).toEqual({ apply: true, status: 'ringing' })
    expect(nextStatus('ringing', 'in_progress').apply).toBe(true)
    expect(nextStatus('in_progress', 'completed').apply).toBe(true)
    expect(nextStatus('queued', 'no_answer').apply).toBe(true)
  })
  it('evento atrasado ou repetido não regride', () => {
    expect(nextStatus('in_progress', 'ringing').apply).toBe(false)
    expect(nextStatus('ringing', 'ringing').apply).toBe(false)
    expect(nextStatus('in_progress', 'queued').apply).toBe(false)
  })
  it('estado terminal é final', () => {
    for (const t of ['completed', 'busy', 'no_answer', 'failed', 'canceled'] as const) {
      expect(nextStatus(t, 'in_progress').apply).toBe(false)
      expect(nextStatus(t, 'failed').apply).toBe(false)
    }
  })
  it('statusesBefore coincide com a máquina (usado no UPDATE atômico)', () => {
    expect(statusesBefore('queued')).toEqual([])
    expect(statusesBefore('ringing')).toEqual(['queued'])
    expect(statusesBefore('in_progress')).toEqual(['queued', 'ringing'])
    expect(statusesBefore('completed')).toEqual(['queued', 'ringing', 'in_progress'])
  })
})
