import { DEFAULT_BUDGET, evaluateBudget } from './latency-budget'
import { PROFILES, runScenario, seededRandom, simulateTurn } from './latency-harness'
import { LatencyRecorder, TurnTimeline, percentile, summarize } from './latency-tracker'

describe('TurnTimeline', () => {
  it('calcula delta por estágio e o total percebido', () => {
    const t = new TurnTimeline()
    t.mark('speech_end', 1000).mark('endpoint', 1250).mark('stt_final', 1400).mark('llm_first_token', 1800)
      .mark('first_chunk', 1900).mark('tts_first_audio', 2100).mark('playback', 2150)
    expect(t.delta('endpoint')).toBe(250)
    expect(t.delta('llm_first_token')).toBe(400)
    expect(t.total()).toBe(1150)
  })

  it('só o primeiro carimbo de cada estágio vale', () => {
    const t = new TurnTimeline()
    t.mark('speech_end', 0).mark('llm_first_token', 300).mark('llm_first_token', 900)
    expect(t.at('llm_first_token')).toBe(300)
  })

  it('pula estágio sem carimbo usando o anterior disponível e devolve nulo sem origem', () => {
    const t = new TurnTimeline()
    t.mark('speech_end', 0).mark('endpoint', 200).mark('tts_first_audio', 700)
    expect(t.delta('tts_first_audio')).toBe(500)
    expect(t.delta('stt_final')).toBeNull()
    expect(new TurnTimeline().mark('playback', 5).total()).toBeNull()
  })
})

describe('percentile / summarize', () => {
  it('nearest-rank', () => {
    const v = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]
    expect(percentile(v, 50)).toBe(50)
    expect(percentile(v, 95)).toBe(100)
    expect(percentile(v, 0)).toBe(10)
  })
  it('ignora valores não finitos e devolve nulo sem amostra', () => {
    expect(summarize([NaN, Infinity])).toBeNull()
    expect(summarize([3, NaN, 1, 2])).toMatchObject({ n: 3, min: 1, max: 3, p50: 2 })
  })
})

describe('LatencyRecorder', () => {
  it('conta turnos que nunca tocaram fora do total', () => {
    const rec = new LatencyRecorder()
    rec.add(new TurnTimeline().mark('speech_end', 0).mark('playback', 700))
    rec.add(new TurnTimeline().mark('speech_end', 0).mark('endpoint', 300))
    const r = rec.report()
    expect(r.turns).toBe(2)
    expect(r.completed).toBe(1)
    expect(r.total?.p50).toBe(700)
  })
})

describe('evaluateBudget', () => {
  it('sem nenhuma amostra completa não declara ok', () => {
    const v = evaluateBudget(new LatencyRecorder().report())
    expect(v.ok).toBe(false)
    expect(v.unmeasured.length).toBeGreaterThan(0)
  })

  it('aponta o estágio que estourou o teto', () => {
    const rec = new LatencyRecorder()
    for (let i = 0; i < 20; i++) {
      rec.add(new TurnTimeline().mark('speech_end', 0).mark('endpoint', 200).mark('stt_final', 300).mark('llm_first_token', 1300)
        .mark('first_chunk', 1350).mark('tts_first_audio', 1500).mark('playback', 1530))
    }
    const v = evaluateBudget(rec.report())
    expect(v.ok).toBe(false)
    expect(v.violations.map((x) => x.scope)).toEqual(expect.arrayContaining(['total_p50', 'llm_first_token']))
  })
})

describe('harness (tempo virtual)', () => {
  it('é determinístico para a mesma semente', () => {
    const a = runScenario('cascata-br', { turns: 200, seed: 7 })
    const b = runScenario('cascata-br', { turns: 200, seed: 7 })
    expect(a.report.total).toEqual(b.report.total)
  })

  it('perfis têm os seis estágios', () => {
    for (const p of Object.values(PROFILES)) expect(Object.keys(p.profile)).toHaveLength(6)
  })

  it('simulateTurn produz carimbos crescentes', () => {
    const t = simulateTurn(PROFILES['cascata-br'].profile, seededRandom(3))
    expect(t.total()).toBeGreaterThan(0)
  })

  it('distância dos provedores domina: cascata nos EUA é mais lenta que no Brasil', () => {
    const br = runScenario('cascata-br', { turns: 500, seed: 1 })
    const us = runScenario('cascata-eua', { turns: 500, seed: 1 })
    expect(us.report.total!.p50).toBeGreaterThan(br.report.total!.p50)
    expect(us.verdict.ok).toBe(false)
    expect(DEFAULT_BUDGET.totalP95).toBeGreaterThan(0)
  })

  it('perfil desconhecido lança erro com a lista disponível', () => {
    expect(() => runScenario('nao-existe')).toThrow(/Disponíveis/)
  })
})
