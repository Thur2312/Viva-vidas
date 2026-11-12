import { HEALTH_STALE_MS, HealthSnapshot, dailyLimitOf, effectiveDailyCap, effectiveRate, evaluateHealth } from './health-policy'

const NOW = new Date('2026-11-11T15:00:00Z')
const ago = (min: number) => new Date(NOW.getTime() - min * 60_000)
const snap = (o: Partial<HealthSnapshot> = {}): HealthSnapshot => ({
  checked_at: ago(5), quality_rating: 'GREEN', limit_tier: 'TIER_1K', daily_limit: 1000, status: 'CONNECTED', account_review_status: 'APPROVED', ...o,
})
const ev = (latest: HealthSnapshot | null, previous: HealthSnapshot | null = null, strict = true) => evaluateHealth({ latest, previous, now: NOW, strict })

describe('política de saúde do número (matriz)', () => {
  it('verde, conectado, recente: ok, velocidade cheia', () => {
    expect(ev(snap())).toMatchObject({ state: 'ok', reasons: [], rateFactor: 1, dailyLimit: 1000 })
  })
  it('vermelho bloqueia', () => expect(ev(snap({ quality_rating: 'RED' })).reasons).toContain('qualidade_vermelha'))
  it('queda de qualidade em relação à leitura anterior bloqueia (verde -> amarelo)', () => {
    const v = ev(snap({ quality_rating: 'YELLOW' }), snap())
    expect(v.state).toBe('block')
    expect(v.reasons).toContain('qualidade_caiu')
  })
  it('amarelo estável avisa e reduz a velocidade pela metade, sem pausar', () => {
    const v = ev(snap({ quality_rating: 'YELLOW' }), snap({ quality_rating: 'YELLOW' }))
    expect(v).toMatchObject({ state: 'warn', rateFactor: 0.5 })
  })
  it('melhora de qualidade não bloqueia', () => {
    expect(ev(snap(), snap({ quality_rating: 'YELLOW' })).state).toBe('ok')
  })
  it('queda do limite (tier) bloqueia; subida não', () => {
    expect(ev(snap({ limit_tier: 'TIER_250', daily_limit: 250 }), snap()).reasons).toContain('limite_caiu')
    expect(ev(snap({ limit_tier: 'TIER_10K', daily_limit: 10000 }), snap()).state).toBe('ok')
  })
  it('status diferente de CONNECTED bloqueia (inclui ausente)', () => {
    for (const s of ['FLAGGED', 'RESTRICTED', 'PENDING', 'DISCONNECTED', 'UNKNOWN', null, '']) {
      expect(ev(snap({ status: s as any })).reasons).toContain('numero_nao_conectado')
    }
  })
  it('revisão da conta diferente de APPROVED bloqueia; ausente não', () => {
    expect(ev(snap({ account_review_status: 'PENDING' })).reasons).toContain('conta_em_revisao')
    expect(ev(snap({ account_review_status: null })).state).toBe('ok')
  })
  it('leitura com mais de 60 min é insegura quando há disparo rodando/iniciando (strict)', () => {
    expect(ev(snap({ checked_at: ago(61) })).reasons).toContain('leitura_antiga')
    expect(ev(snap({ checked_at: ago(59) })).state).toBe('ok')
    expect(ev(snap({ checked_at: ago(61) }), null, false).state).toBe('ok') // sem disparo, só informa
    expect(HEALTH_STALE_MS).toBe(3_600_000)
  })
  it('sem nenhuma leitura: bloqueia quando strict', () => {
    expect(ev(null)).toMatchObject({ state: 'block', reasons: ['sem_leitura'] })
    expect(ev(null, null, false).state).toBe('ok')
  })
  it('qualidade desconhecida: aviso com metade da velocidade (número novo)', () => {
    expect(ev(snap({ quality_rating: 'UNKNOWN' }), snap({ quality_rating: 'UNKNOWN' }))).toMatchObject({ state: 'warn', rateFactor: 0.5 })
  })
  it('data inválida na leitura = antiga (falha fechado)', () => {
    expect(ev(snap({ checked_at: 'lixo' as any })).reasons).toContain('leitura_antiga')
  })
  it('daily_cap nunca passa do limite real; ilimitado não limita', () => {
    expect(effectiveDailyCap(500, 250)).toBe(250)
    expect(effectiveDailyCap(200, 1000)).toBe(200)
    expect(effectiveDailyCap(200, null)).toBe(200)
    expect(dailyLimitOf('TIER_250')).toBe(250)
    expect(dailyLimitOf('TIER_UNLIMITED')).toBeNull()
    expect(dailyLimitOf('UNKNOWN')).toBeNull()
    expect(effectiveRate(20, 0.5)).toBe(10)
    expect(effectiveRate(1, 0.5)).toBe(1)
  })
})
