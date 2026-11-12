import { LeadFacts, DEFAULT_FREQUENCY_DAYS, decideLead, isValidBrPhone, summarizeReasons } from './gates'
import {
  AUTOPAUSE_THRESHOLD, DEFAULT_WINDOW, backoffMs, batchBudget, inSendWindow, isTransientStatus, parseGatewayStatus, shouldAutoPause,
} from './throttle'
import { hasOptOutHint, renderPreview, resolveVariables, validateTemplateInput, validateVariablesMap, DRAFT_TEMPLATES } from './template-rules'
import { broadcastsEnabled, decideRecipient, sanitizeAudienceFilter } from './broadcasts.service'

const NOW = new Date('2026-11-11T15:00:00Z') // quarta, 12:00 em Brasília
const base = (o: Partial<LeadFacts> = {}): LeadFacts => ({
  id: 'l1', name: 'Maria Souza', phone: '5583999990001', opt_out: false, anonymized_at: null,
  marketing_active: true, marketing_active_has_source: true, marketing_revoked: false,
  atendimento_active: true, atendimento_active_has_source: true,
  last_marketing_sent_at: null, last_inbound_at: null, ...o,
})
const mkt = { kind: 'template' as const, category: 'MARKETING' as const, now: NOW, frequencyDays: DEFAULT_FREQUENCY_DAYS }
const util = { ...mkt, category: 'UTILITY' as const }

describe('portas de conformidade (decideLead)', () => {
  it('libera lead com consentimento de marketing ativo, com origem', () => {
    expect(decideLead(base(), mkt)).toBeNull()
  })
  it('falha fechado: lead inexistente', () => expect(decideLead(null, mkt)).toBe('lead_inexistente'))
  it('opt-out bloqueia mesmo com consentimento ativo', () => expect(decideLead(base({ opt_out: true }), mkt)).toBe('opt_out'))
  it('anonimizado bloqueia', () => expect(decideLead(base({ anonymized_at: new Date() }), mkt)).toBe('anonimizado'))
  it('marketing revogado (can_contact falso) bloqueia', () => expect(decideLead(base({ marketing_revoked: true, marketing_active: false }), mkt)).toBe('marketing_revogado'))
  it('telefone inválido bloqueia (curto, anon, sem 55, DDD inválido)', () => {
    for (const p of [null, '', '123', 'anon:abc', '4412345678901', '5503999990001', '558399999']) {
      expect(decideLead(base({ phone: p as any }), mkt)).toBe('telefone_invalido')
    }
  })
  it('marketing sem consentimento de marketing ativo bloqueia, mesmo com atendimento', () => {
    expect(decideLead(base({ marketing_active: false, marketing_active_has_source: false }), mkt)).toBe('sem_consentimento_marketing')
  })
  it('consentimento sem origem registrada bloqueia', () => {
    expect(decideLead(base({ marketing_active_has_source: false }), mkt)).toBe('consentimento_sem_origem')
    expect(decideLead(base({ atendimento_active_has_source: false }), util)).toBe('consentimento_sem_origem')
  })
  it('utility exige atendimento (não marketing)', () => {
    expect(decideLead(base({ marketing_active: false, marketing_active_has_source: false }), util)).toBeNull()
    expect(decideLead(base({ atendimento_active: false, atendimento_active_has_source: false }), util)).toBe('sem_consentimento_atendimento')
  })
  it('limite de frequência: 1 marketing a cada 7 dias', () => {
    const d = (days: number) => new Date(NOW.getTime() - days * 86_400_000)
    expect(decideLead(base({ last_marketing_sent_at: d(3) }), mkt)).toBe('limite_frequencia')
    expect(decideLead(base({ last_marketing_sent_at: d(7.01) }), mkt)).toBeNull()
    expect(decideLead(base({ last_marketing_sent_at: d(1) }), util)).toBeNull() // utility não conta
  })
  it('texto livre só dentro das 24h da última mensagem do lead', () => {
    const t = { ...util, kind: 'text_in_window' as const }
    expect(decideLead(base(), t)).toBe('fora_janela_24h')
    expect(decideLead(base({ last_inbound_at: new Date(NOW.getTime() - 25 * 3600_000) }), t)).toBe('fora_janela_24h')
    expect(decideLead(base({ last_inbound_at: new Date(NOW.getTime() - 23 * 3600_000) }), t)).toBeNull()
  })
  it('a ordem de gravidade é estável: opt-out vem antes de tudo', () => {
    expect(decideLead(base({ opt_out: true, marketing_active: false, phone: '1' }), mkt)).toBe('opt_out')
  })
  it('valida telefone BR', () => {
    expect(isValidBrPhone('5583999990001')).toBe(true)
    expect(isValidBrPhone('558333334444')).toBe(true)
    expect(isValidBrPhone('558311112222')).toBe(false) // fixo começando em 1
  })
  it('summarizeReasons conta elegíveis e motivos', () => {
    expect(summarizeReasons([null, 'opt_out', 'opt_out', 'telefone_invalido'])).toEqual({ total: 4, eligible: 1, skipped: { opt_out: 2, telefone_invalido: 1 }, skippedTotal: 3 })
  })
  it('decideRecipient: variável que ficaria vazia pula o lead', () => {
    const ctx = { kind: 'template' as const, category: 'MARKETING' as const, variablesMap: { '1': { source: 'lead.first_name' as const } }, varCount: 1, now: NOW }
    expect(decideRecipient(base({ name: null }), ctx)).toBe('variavel_vazia')
    expect(decideRecipient(base(), ctx)).toBeNull()
  })
})

describe('vazão (throttling)', () => {
  it('respeita o teto por ciclo: 20/min em ciclos de 15s = 5', () => {
    expect(batchBudget({ ratePerMinute: 20, sentLast60s: 0, dailyCap: 200, sentToday: 0 })).toBe(5)
  })
  it('janela deslizante: não passa de rate por 60s', () => {
    expect(batchBudget({ ratePerMinute: 20, sentLast60s: 18, dailyCap: 200, sentToday: 18 })).toBe(2)
    expect(batchBudget({ ratePerMinute: 20, sentLast60s: 20, dailyCap: 200, sentToday: 20 })).toBe(0)
  })
  it('teto diário e teto global limitam', () => {
    expect(batchBudget({ ratePerMinute: 60, sentLast60s: 0, dailyCap: 200, sentToday: 198 })).toBe(2)
    expect(batchBudget({ ratePerMinute: 60, sentLast60s: 0, dailyCap: 200, sentToday: 200 })).toBe(0)
    expect(batchBudget({ ratePerMinute: 60, sentLast60s: 0, dailyCap: 200, sentToday: 0, globalRemaining: 1 })).toBe(1)
    expect(batchBudget({ ratePerMinute: 60, sentLast60s: 0, dailyCap: 200, sentToday: 0, globalRemaining: -5 })).toBe(0)
  })
  it('nunca é negativo e sempre libera ao menos 1 por ciclo com taxa baixa', () => {
    expect(batchBudget({ ratePerMinute: 1, sentLast60s: 0, dailyCap: 10, sentToday: 0 })).toBe(1)
    expect(batchBudget({ ratePerMinute: 5, sentLast60s: 99, dailyCap: 10, sentToday: 99 })).toBe(0)
  })
  it('backoff exponencial com teto de 1h', () => {
    expect([1, 2, 3, 4].map(backoffMs)).toEqual([30_000, 60_000, 120_000, 240_000])
    expect(backoffMs(20)).toBe(3_600_000)
  })
  it('classifica erro transitório x definitivo', () => {
    expect(isTransientStatus(429)).toBe(true)
    expect(isTransientStatus(502)).toBe(true)
    expect(isTransientStatus(null)).toBe(true)
    expect(isTransientStatus(400)).toBe(false)
    expect(isTransientStatus(404)).toBe(false)
    expect(parseGatewayStatus('Chat respondeu 429')).toBe(429)
    expect(parseGatewayStatus('Falha ao falar com o chat')).toBeNull()
  })
})

describe('auto-pausa por taxa de falha', () => {
  const fails = (n: number, total: number) => Array.from({ length: total }, (_, i) => i < n)
  it('pausa acima de 30% nos últimos 20', () => {
    expect(AUTOPAUSE_THRESHOLD).toBe(0.3)
    expect(shouldAutoPause(fails(7, 20)).pause).toBe(true) // 35%
    expect(shouldAutoPause(fails(6, 20)).pause).toBe(false) // exatamente 30% não passa
  })
  it('amostra pequena não dispara', () => {
    expect(shouldAutoPause([true, true, true]).pause).toBe(false)
    expect(shouldAutoPause(fails(5, 5)).pause).toBe(true)
  })
  it('só os 20 mais recentes contam', () => {
    const recentOk = [...Array(20).fill(false), ...Array(30).fill(true)]
    expect(shouldAutoPause(recentOk).pause).toBe(false)
  })
})

describe('janela de envio (fuso America/Sao_Paulo)', () => {
  it('dentro: quarta 12:00 BRT', () => expect(inSendWindow(NOW, DEFAULT_WINDOW)).toBe(true))
  it('fora: antes das 09:00 e a partir das 18:00 BRT', () => {
    expect(inSendWindow(new Date('2026-11-11T11:59:00Z'), DEFAULT_WINDOW)).toBe(false) // 08:59
    expect(inSendWindow(new Date('2026-11-11T12:00:00Z'), DEFAULT_WINDOW)).toBe(true) // 09:00
    expect(inSendWindow(new Date('2026-11-11T20:59:00Z'), DEFAULT_WINDOW)).toBe(true) // 17:59
    expect(inSendWindow(new Date('2026-11-11T21:00:00Z'), DEFAULT_WINDOW)).toBe(false) // 18:00
  })
  it('fora: sábado e domingo', () => {
    expect(inSendWindow(new Date('2026-11-14T15:00:00Z'), DEFAULT_WINDOW)).toBe(false)
    expect(inSendWindow(new Date('2026-11-15T15:00:00Z'), DEFAULT_WINDOW)).toBe(false)
  })
  it('usa o fuso, não UTC: 02:00 UTC de quinta ainda é quarta 23:00 BRT (fora)', () => {
    expect(inSendWindow(new Date('2026-11-12T02:00:00Z'), DEFAULT_WINDOW)).toBe(false)
  })
  it('janela invertida é fechada (falha fechado)', () => {
    expect(inSendWindow(NOW, { ...DEFAULT_WINDOW, start: '18:00', end: '09:00' })).toBe(false)
  })
})

describe('regras de template', () => {
  const ok = { name: 'retomada_x', category: 'MARKETING', bodyText: 'Olá {{1}}, quer retomar a conversa sobre o seu plano?', bodyExamples: ['Maria'], buttons: [{ type: 'QUICK_REPLY' as const, text: 'Parar mensagens' }] }
  it('os 5 rascunhos da documentação são válidos', () => {
    for (const d of DRAFT_TEMPLATES) expect(validateTemplateInput({ name: d.name, category: d.category, bodyText: d.bodyText, bodyExamples: d.bodyExamples, buttons: d.buttons })).toEqual([])
  })
  it('marketing exige aviso de saída (texto ou botão de resposta rápida)', () => {
    expect(validateTemplateInput({ ...ok, buttons: [] }).join()).toMatch(/aviso de saída/)
    expect(validateTemplateInput({ ...ok, buttons: [], bodyText: 'Olá {{1}}, quer retomar? Responda PARAR para sair.' })).toEqual([])
    expect(validateTemplateInput(ok)).toEqual([])
  })
  it('hasOptOutHint', () => {
    expect(hasOptOutHint({ bodyText: 'Para sair, responda PARAR.' })).toBe(true)
    expect(hasOptOutHint({ bodyText: 'Oi', footerText: 'Digite SAIR para não receber' })).toBe(true)
    expect(hasOptOutHint({ bodyText: 'Oi', buttons: [{ type: 'URL', text: 'Site', url: 'https://x.com' }] })).toBe(false)
    expect(hasOptOutHint({ bodyText: 'Oi', buttons: [{ type: 'QUICK_REPLY', text: 'Agora não' }] })).toBe(true)
  })
  it('rejeita nome inválido, categoria, variável nas pontas, sem exemplo, encurtador, urgência', () => {
    expect(validateTemplateInput({ ...ok, name: 'Nome Ruim' }).join()).toMatch(/Nome inválido/)
    expect(validateTemplateInput({ ...ok, category: 'AUTHENTICATION' }).join()).toMatch(/Categoria/)
    expect(validateTemplateInput({ ...ok, bodyText: '{{1}} quer retomar?' }).join()).toMatch(/início ou no fim/)
    expect(validateTemplateInput({ ...ok, bodyExamples: [] }).join()).toMatch(/exemplo/)
    expect(validateTemplateInput({ ...ok, bodyText: 'Olá {{1}}, veja bit.ly/abc agora' }).join()).toMatch(/encurtado/)
    expect(validateTemplateInput({ ...ok, bodyText: 'Olá {{1}}, ÚLTIMA CHANCE de falar comigo' }).join()).toMatch(/urgência/)
    expect(validateTemplateInput({ ...ok, bodyText: 'Olá {{2}}, tudo bem por aí hoje?' }).join()).toMatch(/sequenciais/)
  })
  it('utility com texto promocional é recusado', () => {
    expect(validateTemplateInput({ ...ok, category: 'UTILITY', bodyText: 'Olá {{1}}, aproveite nosso desconto no plano' }).join()).toMatch(/promocional/)
  })
  it('mapeamento de variáveis: exige origem para todas e nenhuma sobrando', () => {
    expect(validateVariablesMap({}, 'Olá {{1}}, {{2}}.')).toHaveLength(2)
    expect(validateVariablesMap({ '1': { source: 'lead.first_name' }, '2': { source: 'custom', value: 'Alberto' } }, 'Olá {{1}}, de {{2}}.')).toEqual([])
    expect(validateVariablesMap({ '1': { source: 'lead.name' }, '3': { source: 'custom', value: 'x' } }, 'Olá {{1}}, ok')).toHaveLength(1)
  })
  it('resolveVariables: primeiro nome, fallback, vazio => null, sem quebra de linha', () => {
    expect(resolveVariables({ '1': { source: 'lead.first_name' } }, 1, { name: 'Maria  Souza' })).toEqual(['Maria'])
    expect(resolveVariables({ '1': { source: 'lead.first_name', fallback: 'cliente' } }, 1, { name: null })).toEqual(['cliente'])
    expect(resolveVariables({ '1': { source: 'lead.name' } }, 1, { name: '   ' })).toBeNull()
    expect(resolveVariables({ '1': { source: 'custom', value: 'a\nb\tc' } }, 1, {})).toEqual(['a b c'])
  })
  it('renderPreview', () => expect(renderPreview('Olá {{1}}, {{2}}', ['Ana', 'bem'])).toBe('Olá Ana, bem'))
})

describe('interruptor geral e filtros', () => {
  const saved = process.env.BROADCASTS_ENABLED
  afterEach(() => { if (saved === undefined) delete process.env.BROADCASTS_ENABLED; else process.env.BROADCASTS_ENABLED = saved })
  it('falha fechado: só "true"/"1" liga', () => {
    delete process.env.BROADCASTS_ENABLED
    expect(broadcastsEnabled()).toBe(false)
    for (const v of ['', 'false', '0', 'yes', 'sim', 'TRUEE']) { process.env.BROADCASTS_ENABLED = v; expect(broadcastsEnabled()).toBe(false) }
    for (const v of ['true', '1', ' TRUE ']) { process.env.BROADCASTS_ENABLED = v; expect(broadcastsEnabled()).toBe(true) }
  })
  it('sanitizeAudienceFilter descarta lixo e limita', () => {
    expect(sanitizeAudienceFilter({ stages: ['venda', 'hack'], scoreMin: '40', scoreMax: 999, campaignIds: ['c1', 5], x: 1 })).toEqual({ stages: ['venda'], scoreMin: 40, scoreMax: 100, campaignIds: ['c1'] })
    expect(sanitizeAudienceFilter(null)).toEqual({})
  })
})
