/**
 * Corta o texto que chega em streaming do LLM em trechos falaveis, para o TTS começar na primeira frase
 * sem esperar a resposta inteira. Regras para pt-BR:
 * - fecha em . ! ? … seguido de espaço, exceto abreviações (Sr., Dra., Prof., etc.) e números (3.5);
 * - a PRIMEIRA fala sai mais cedo: numa vírgula/ponto e vírgula/dois-pontos após `minFirstChars`;
 * - nenhum trecho passa de `maxChars` (corta no último espaço).
 */
const ABBREVIATIONS = new Set(['sr', 'sra', 'srta', 'dr', 'dra', 'prof', 'profa', 'av', 'ex', 'etc', 'obs', 'tel', 'nº', 'n', 'ltda', 'cia'])

export interface ChunkerOptions { minFirstChars?: number; maxChars?: number }

export class SentenceChunker {
  private buf = ''
  private emitted = 0
  private readonly minFirst: number
  private readonly maxChars: number

  constructor(opts: ChunkerOptions = {}) {
    this.minFirst = opts.minFirstChars ?? 24
    this.maxChars = opts.maxChars ?? 220
  }

  /** Acrescenta texto e devolve os trechos que já podem ser falados. */
  push(text: string): string[] {
    this.buf += text
    const out: string[] = []
    for (;;) {
      const cut = this.findCut()
      if (cut < 0) break
      const piece = this.buf.slice(0, cut).trim()
      this.buf = this.buf.slice(cut)
      if (piece) { out.push(piece); this.emitted++ }
    }
    return out
  }

  /** Fim do texto: devolve o que sobrou. */
  flush(): string | null {
    const rest = this.buf.trim()
    this.buf = ''
    if (!rest) return null
    this.emitted++
    return rest
  }

  private findCut(): number {
    const b = this.buf
    const end = /([.!?…]+["')\]]*)\s/g
    let m: RegExpExecArray | null
    while ((m = end.exec(b))) {
      const upTo = m.index + m[0].length
      if (this.isAbbreviation(b, m.index)) continue
      return upTo
    }
    if (this.emitted === 0 && b.length >= this.minFirst) {
      const soft = /[,;:]\s/g
      while ((m = soft.exec(b))) {
        if (m.index + 1 >= this.minFirst) return m.index + m[0].length
      }
    }
    if (b.length >= this.maxChars) {
      const sp = b.lastIndexOf(' ', this.maxChars)
      return sp > 0 ? sp + 1 : this.maxChars
    }
    return -1
  }

  private isAbbreviation(b: string, dotIndex: number): boolean {
    if (b[dotIndex] !== '.') return false
    const before = b.slice(0, dotIndex)
    const word = /([A-Za-zÀ-ÿº]+)$/.exec(before)?.[1]?.toLowerCase()
    if (!word) return false
    if (ABBREVIATIONS.has(word)) return true
    return word.length === 1 && /^[A-Za-zÀ-ÿ]$/.test(word) // inicial: "J. Silva"
  }
}
