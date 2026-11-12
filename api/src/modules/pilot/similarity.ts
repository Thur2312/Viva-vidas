export type HumanAction = 'igual' | 'editou' | 'diferente'

const STOP = new Set(['a', 'o', 'e', 'de', 'da', 'do', 'em', 'um', 'uma', 'que', 'para', 'pra', 'com', 'no', 'na', 'os', 'as'])

export function normalize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t && !STOP.has(t))
}

/** Dice sobre o conjunto de palavras, com penalidade quando os tamanhos são muito diferentes. */
export function similarity(a: string, b: string): number {
  const A = new Set(normalize(a))
  const B = new Set(normalize(b))
  if (A.size === 0 && B.size === 0) return 1
  if (A.size === 0 || B.size === 0) return 0
  let inter = 0
  for (const t of A) if (B.has(t)) inter++
  const dice = (2 * inter) / (A.size + B.size)
  const lenRatio = Math.min(A.size, B.size) / Math.max(A.size, B.size)
  return Math.round(dice * (0.7 + 0.3 * lenRatio) * 1000) / 1000
}

export function classify(sim: number): HumanAction {
  if (sim >= 0.8) return 'igual'
  if (sim >= 0.45) return 'editou'
  return 'diferente'
}
