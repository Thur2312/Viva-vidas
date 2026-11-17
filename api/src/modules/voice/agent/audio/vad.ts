import { mulawDecodeByte } from './mulaw'

/**
 * Detector de atividade de voz por energia, para áudio μ-law 8 kHz em quadros de 20 ms (160 bytes).
 * Simples de propósito: serve para o fim de turno e o barge-in. Limiar adaptativo (piso de ruído) e histerese.
 * Um VAD neural (Silero etc.) pode substituir esta classe atrás da mesma interface sem mudar o resto.
 */
export interface VadEvents {
  onSpeechStart(): void
  /** `silenceMs`: silêncio desde a última fala; `voicedMs`: tempo de fala de fato (sem pré-roll nem silêncio). */
  onSpeechEnd(silenceMs: number, voicedMs: number): void
}

export interface VadOptions {
  frameMs?: number
  /** Quadros consecutivos acima do limiar para declarar início de fala. */
  startFrames?: number
  /** Silêncio (ms) que fecha o turno. Pode ser função, para encurtar quando a frase parece completa. */
  silenceMs?: number | (() => number)
  /** RMS mínimo (escala de 16 bits) para contar como fala. */
  minRms?: number
  /** Quantas vezes o piso de ruído o RMS precisa superar. */
  noiseFactor?: number
}

export function frameRms(frame: Buffer): number {
  if (!frame.length) return 0
  let sum = 0
  for (let i = 0; i < frame.length; i++) { const s = mulawDecodeByte(frame[i]); sum += s * s }
  return Math.sqrt(sum / frame.length)
}

export class EnergyVad {
  private speaking = false
  private loud = 0
  private silentFrames = 0
  private noiseFloor = 120
  private pending: Buffer = Buffer.alloc(0)
  private voicedFrames = 0
  private readonly frameBytes: number
  private readonly frameMs: number
  private readonly startFrames: number
  private readonly minRms: number
  private readonly noiseFactor: number
  private readonly silenceMs: number | (() => number)

  constructor(private readonly events: VadEvents, opts: VadOptions = {}) {
    this.frameMs = opts.frameMs ?? 20
    this.frameBytes = Math.round((8000 * this.frameMs) / 1000)
    this.startFrames = opts.startFrames ?? 3
    this.minRms = opts.minRms ?? 400
    this.noiseFactor = opts.noiseFactor ?? 3
    this.silenceMs = opts.silenceMs ?? 320
  }

  get isSpeaking(): boolean { return this.speaking }

  /** Alimenta com áudio μ-law de qualquer tamanho; processa quadros completos. */
  push(chunk: Buffer): void {
    this.pending = this.pending.length ? Buffer.concat([this.pending, chunk]) : chunk
    while (this.pending.length >= this.frameBytes) {
      this.frame(this.pending.subarray(0, this.frameBytes))
      this.pending = this.pending.subarray(this.frameBytes)
    }
  }

  private threshold(): number { return Math.max(this.minRms, this.noiseFloor * this.noiseFactor) }

  private frame(f: Buffer): void {
    const rms = frameRms(f)
    const isSpeech = rms > this.threshold()
    if (!isSpeech) this.noiseFloor = this.noiseFloor * 0.95 + rms * 0.05
    if (isSpeech) {
      this.silentFrames = 0
      if (this.speaking) this.voicedFrames++
      else if (++this.loud >= this.startFrames) { this.speaking = true; this.voicedFrames = this.loud; this.events.onSpeechStart() }
      return
    }
    this.loud = 0
    if (!this.speaking) return
    this.silentFrames++
    const need = typeof this.silenceMs === 'function' ? this.silenceMs() : this.silenceMs
    if (this.silentFrames * this.frameMs >= need) {
      const silence = this.silentFrames * this.frameMs
      this.speaking = false
      this.silentFrames = 0
      const voiced = this.voicedFrames * this.frameMs
      this.voicedFrames = 0
      this.events.onSpeechEnd(silence, voiced)
    }
  }
}

/**
 * Silêncio necessário para fechar o turno, conforme o texto parcial: frase que parece completa fecha mais cedo.
 * Sem parcial (STT em lote), usa o padrão.
 */
export function silenceForPartial(partial: string | null | undefined, opts: { short?: number; long?: number; fallback?: number } = {}): number {
  const short = opts.short ?? 220
  const long = opts.long ?? 450
  const fallback = opts.fallback ?? 320
  const t = (partial ?? '').trim()
  if (!t) return fallback
  if (/[.!?…]$/.test(t)) return short
  if (/\b(e|mas|que|porque|então|ou|pra|para|de|do|da|com|um|uma)$/i.test(t) || /,$/.test(t)) return long
  return fallback
}
