import { evalPredicate, mergeProfile } from './profile'
import { Profile } from './types'

const e = (valor: string | number | boolean, confianca = 0.9, msgId = 'm0') => ({ valor, confianca, msgId })

describe('mergeProfile', () => {
  const OLD = process.env.BRAIN_MIN_CONFIDENCE
  afterEach(() => {
    if (OLD === undefined) delete process.env.BRAIN_MIN_CONFIDENCE
    else process.env.BRAIN_MIN_CONFIDENCE = OLD
  })

  it('ignora confianca abaixo do minimo', () => {
    const r = mergeProfile({}, { vidas: { valor: 3, confianca: 0.3 } }, 1)
    expect(r.profile).toEqual({})
    expect(r.conflicts).toEqual([])
  })

  it('aceita valor novo e guarda so o msgId', () => {
    const r = mergeProfile({}, { vidas: { valor: 3, confianca: 0.8 } }, 7)
    expect(r.profile.vidas).toEqual({ valor: 3, confianca: 0.8, msgId: '7' })
  })

  it('usa BRAIN_MIN_CONFIDENCE lido em tempo de chamada e opts', () => {
    process.env.BRAIN_MIN_CONFIDENCE = '0.9'
    expect(mergeProfile({}, { a: { valor: 1, confianca: 0.8 } }, 1).profile).toEqual({})
    expect(mergeProfile({}, { a: { valor: 1, confianca: 0.8 } }, 1, { minConfidence: 0.5 }).profile.a).toBeDefined()
  })

  it.each(['', '   ', 'abc', 'NaN'])('BRAIN_MIN_CONFIDENCE=%p invalido volta a 0.6', (v) => {
    process.env.BRAIN_MIN_CONFIDENCE = v
    expect(mergeProfile({}, { a: { valor: 1, confianca: 0.5 } }, 1).profile).toEqual({})
    expect(mergeProfile({}, { a: { valor: 1, confianca: 0.7 } }, 1).profile.a).toBeDefined()
  })

  it('confianca maior substitui', () => {
    const cur: Profile = { vidas: e(2, 0.7) }
    const r = mergeProfile(cur, { vidas: { valor: 4, confianca: 0.9 } }, 2)
    expect(r.profile.vidas).toEqual({ valor: 4, confianca: 0.9, msgId: '2' })
    expect(r.conflicts).toEqual([])
  })

  it('confianca menor nao substitui e registra conflito quando difere', () => {
    const cur: Profile = { vidas: e(2, 0.9) }
    const r = mergeProfile(cur, { vidas: { valor: 4, confianca: 0.7 } }, 2)
    expect(r.profile.vidas).toEqual(cur.vidas)
    expect(r.conflicts).toEqual(['vidas'])
  })

  it('confianca menor com mesmo valor nao gera conflito', () => {
    const cur: Profile = { vidas: e(2, 0.9) }
    const r = mergeProfile(cur, { vidas: { valor: 2, confianca: 0.7 } }, 2)
    expect(r.conflicts).toEqual([])
    expect(r.profile.vidas).toEqual(cur.vidas)
  })

  it('nao muta as entradas', () => {
    const cur: Profile = { vidas: e(2, 0.5) }
    const ext = { vidas: { valor: 4, confianca: 0.9 } }
    const r = mergeProfile(cur, ext, 3)
    expect(cur).toEqual({ vidas: e(2, 0.5) })
    expect(ext).toEqual({ vidas: { valor: 4, confianca: 0.9 } })
    expect(r.profile).not.toBe(cur)
  })
})

describe('evalPredicate', () => {
  const prof: Profile = { vidas: e(4), cidade: e('  Recife '), pago: e(true), txt: e('5') }

  it('null predicate -> null', () => expect(evalPredicate(null, prof)).toBeNull())

  it('gte true e false', () => {
    expect(evalPredicate({ campo: 'vidas', op: 'gte', valor: 2 }, prof)).toBe(true)
    expect(evalPredicate({ campo: 'vidas', op: 'gt', valor: 4 }, prof)).toBe(false)
    expect(evalPredicate({ campo: 'vidas', op: 'lte', valor: 4 }, prof)).toBe(true)
    expect(evalPredicate({ campo: 'vidas', op: 'lt', valor: 4 }, prof)).toBe(false)
  })

  it('coage string numerica', () => {
    expect(evalPredicate({ campo: 'txt', op: 'gt', valor: 3 }, prof)).toBe(true)
  })

  it('campo ausente: comparacao -> null; presente false; ausente true', () => {
    expect(evalPredicate({ campo: 'x', op: 'gte', valor: 2 }, prof)).toBeNull()
    expect(evalPredicate({ campo: 'x', op: 'eq', valor: 2 }, prof)).toBeNull()
    expect(evalPredicate({ campo: 'x', op: 'presente' }, prof)).toBe(false)
    expect(evalPredicate({ campo: 'x', op: 'ausente' }, prof)).toBe(true)
    expect(evalPredicate({ campo: 'vidas', op: 'presente' }, prof)).toBe(true)
    expect(evalPredicate({ campo: 'vidas', op: 'ausente' }, prof)).toBe(false)
  })

  it('eq compara strings sem caixa/espacos quando tipos diferem', () => {
    expect(evalPredicate({ campo: 'cidade', op: 'eq', valor: 'recife' }, prof)).toBe(true)
    expect(evalPredicate({ campo: 'vidas', op: 'eq', valor: '4' }, prof)).toBe(true)
    expect(evalPredicate({ campo: 'pago', op: 'eq', valor: true }, prof)).toBe(true)
    expect(evalPredicate({ campo: 'cidade', op: 'eq', valor: 'sp' }, prof)).toBe(false)
  })

  it('all: tri-valorado', () => {
    const t = { campo: 'vidas', op: 'gte' as const, valor: 2 }
    const f = { campo: 'vidas', op: 'lt' as const, valor: 2 }
    const n = { campo: 'x', op: 'gt' as const, valor: 1 }
    expect(evalPredicate({ all: [t, t] }, prof)).toBe(true)
    expect(evalPredicate({ all: [t, f, n] }, prof)).toBe(false)
    expect(evalPredicate({ all: [t, n] }, prof)).toBeNull()
  })

  it('any: tri-valorado e aninhado', () => {
    const t = { campo: 'vidas', op: 'gte' as const, valor: 2 }
    const f = { campo: 'vidas', op: 'lt' as const, valor: 2 }
    const n = { campo: 'x', op: 'gt' as const, valor: 1 }
    expect(evalPredicate({ any: [f, f] }, prof)).toBe(false)
    expect(evalPredicate({ any: [f, n] }, prof)).toBeNull()
    expect(evalPredicate({ any: [f, n, t] }, prof)).toBe(true)
    expect(evalPredicate({ all: [t, { any: [f, t] }] }, prof)).toBe(true)
    expect(evalPredicate({ any: [f, { all: [t, n] }] }, prof)).toBeNull()
  })
})
