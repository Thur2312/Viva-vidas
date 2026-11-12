import { DEFAULT_RULES, freeSlots, isBookable, parseRules, zonedToUtc } from './calendar.rules'

const SP = 'America/Sao_Paulo'
// Quinta-feira 12/11/2026, 10:00 em Sao Paulo (UTC-3) = 13:00Z
const NOW = new Date('2026-11-12T13:00:00Z')

describe('zonedToUtc', () => {
  it('Sao Paulo esta 3h atras do UTC (sem horario de verao desde 2019)', () => {
    expect(new Date(zonedToUtc(2026, 11, 12, 9, 0, SP)).toISOString()).toBe('2026-11-12T12:00:00.000Z')
    expect(new Date(zonedToUtc(2026, 1, 15, 9, 0, SP)).toISOString()).toBe('2026-01-15T12:00:00.000Z')
  })
  it('respeita outro fuso com horario de verao (Nova York em julho e dezembro)', () => {
    expect(new Date(zonedToUtc(2026, 7, 1, 9, 0, 'America/New_York')).toISOString()).toBe('2026-07-01T13:00:00.000Z')
    expect(new Date(zonedToUtc(2026, 12, 1, 9, 0, 'America/New_York')).toISOString()).toBe('2026-12-01T14:00:00.000Z')
  })
})

describe('freeSlots', () => {
  const slots = (busy: any[] = [], rules = DEFAULT_RULES, limit = 1000) => freeSlots(rules, busy, NOW, limit)

  it('so dias uteis, dentro de 09:00-18:00 locais, em blocos de 30 min', () => {
    const s = slots()
    expect(s.length).toBeGreaterThan(0)
    for (const x of s) {
      const local = new Date(Date.parse(x.start) - 3 * 3_600_000)
      expect([1, 2, 3, 4, 5]).toContain(local.getUTCDay())
      const min = local.getUTCHours() * 60 + local.getUTCMinutes()
      expect(min).toBeGreaterThanOrEqual(9 * 60)
      expect(min + 30).toBeLessThanOrEqual(18 * 60)
      expect(Date.parse(x.end) - Date.parse(x.start)).toBe(30 * 60_000)
    }
  })

  it('respeita a antecedencia minima de 2h: agora 10:00, o primeiro horario e 12:00', () => {
    expect(slots()[0].start).toBe('2026-11-12T15:00:00.000Z') // 12:00 locais
  })

  it('nao oferece fim de semana nem horario passado', () => {
    const sexta = freeSlots(DEFAULT_RULES, [], new Date('2026-11-13T20:30:00Z'), 5) // sexta 17:30 local
    expect(sexta[0].start).toBe('2026-11-16T12:00:00.000Z') // segunda 09:00 local
  })

  it('tira os horarios que encostam em compromisso ocupado (sobreposicao parcial tambem)', () => {
    const busy = [{ start: Date.parse('2026-11-12T15:15:00Z'), end: Date.parse('2026-11-12T16:15:00Z') }] // 12:15-13:15 locais
    const starts = slots(busy).map((x) => x.start)
    expect(starts).not.toContain('2026-11-12T15:00:00.000Z') // 12:00-12:30 cruza 12:15
    expect(starts).not.toContain('2026-11-12T16:00:00.000Z') // 13:00-13:30 cruza ate 13:15
    expect(starts).toContain('2026-11-12T16:30:00.000Z') // 13:30 esta livre
  })

  it('respeita o limite e o horizonte', () => {
    expect(slots([], DEFAULT_RULES, 3)).toHaveLength(3)
    const ultimo = slots().at(-1)!
    expect(Date.parse(ultimo.start)).toBeLessThanOrEqual(NOW.getTime() + 15 * 86_400_000)
  })

  it('duracao de 60 min gera blocos de 60 min', () => {
    const s = slots([], { ...DEFAULT_RULES, durationMin: 60 })
    expect(Date.parse(s[0].end) - Date.parse(s[0].start)).toBe(3_600_000)
  })
})

describe('isBookable', () => {
  it('aceita so horario que e exatamente um dos livres', () => {
    expect(isBookable(DEFAULT_RULES, [], NOW, '2026-11-12T15:00:00.000Z')).not.toBeNull()
    expect(isBookable(DEFAULT_RULES, [], NOW, '2026-11-12T15:10:00.000Z')).toBeNull() // desalinhado
    expect(isBookable(DEFAULT_RULES, [], NOW, '2026-11-14T15:00:00.000Z')).toBeNull() // sabado
    expect(isBookable(DEFAULT_RULES, [], NOW, '2026-11-12T11:00:00.000Z')).toBeNull() // antes da antecedencia
    expect(isBookable(DEFAULT_RULES, [], NOW, 'lixo')).toBeNull()
  })
  it('recusa horario que acabou de ser ocupado', () => {
    const busy = [{ start: Date.parse('2026-11-12T15:00:00Z'), end: Date.parse('2026-11-12T15:30:00Z') }]
    expect(isBookable(DEFAULT_RULES, busy, NOW, '2026-11-12T15:00:00.000Z')).toBeNull()
  })
})

describe('parseRules', () => {
  it('sem config usa o padrao; config parcial sobrepoe so o que veio', () => {
    expect(parseRules(undefined)).toEqual(DEFAULT_RULES)
    expect(parseRules('{"durationMin":45,"days":[1,3]}')).toMatchObject({ durationMin: 45, days: [1, 3], start: '09:00' })
  })
  it('config invalida inteira cai no padrao (nunca meio-valida)', () => {
    for (const bad of ['nao e json', '{"durationMin":5}', '{"start":"19:00","end":"09:00"}', '{"days":[9]}', '{"timezone":"Marte/Olimpo"}', '{"horizonDays":500}', '{"start":"9h"}'])
      expect(parseRules(bad)).toEqual(DEFAULT_RULES)
  })
})
