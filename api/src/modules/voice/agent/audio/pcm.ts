import { pcm16ToMulaw } from './mulaw'

/** Bytes PCM 16-bit little-endian mono -> amostras. Ignora um byte sobrando no fim. */
export function pcm16leToSamples(buf: Buffer): Int16Array {
  const n = Math.floor(buf.length / 2)
  const out = new Int16Array(n)
  for (let i = 0; i < n; i++) out[i] = buf.readInt16LE(i * 2)
  return out
}

/**
 * 24 kHz -> 8 kHz por média de 3 amostras (filtro simples contra aliasing; basta para voz de telefone).
 * Resto de 1 ou 2 amostras no fim é descartado.
 */
export function downsample24kTo8k(pcm: Int16Array): Int16Array {
  const n = Math.floor(pcm.length / 3)
  const out = new Int16Array(n)
  for (let i = 0; i < n; i++) out[i] = Math.round((pcm[3 * i] + pcm[3 * i + 1] + pcm[3 * i + 2]) / 3)
  return out
}

/** PCM 24 kHz s16le (formato do Gemini TTS e do OpenAI `pcm`) -> μ-law 8 kHz, o formato da linha telefônica. */
export function pcm24kToMulaw8k(buf: Buffer): Buffer {
  return pcm16ToMulaw(downsample24kTo8k(pcm16leToSamples(buf)))
}

/** Remove o cabeçalho WAV (RIFF) se houver e devolve só os bytes de áudio do bloco `data`. */
export function stripWavHeader(buf: Buffer): Buffer {
  if (buf.length < 12 || buf.toString('latin1', 0, 4) !== 'RIFF') return buf
  let pos = 12
  while (pos + 8 <= buf.length) {
    const id = buf.toString('latin1', pos, pos + 4)
    const size = buf.readUInt32LE(pos + 4)
    if (id === 'data') return buf.subarray(pos + 8, size > 0 && pos + 8 + size <= buf.length ? pos + 8 + size : undefined)
    pos += 8 + size + (size % 2)
  }
  return buf
}
