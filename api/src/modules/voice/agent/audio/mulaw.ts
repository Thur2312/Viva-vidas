/** G.711 μ-law (o áudio do Twilio Media Streams: 8 kHz, 8 bits, mono). */
const BIAS = 0x84
const CLIP = 32635

export function mulawDecodeByte(byte: number): number {
  const u = ~byte & 0xff
  const sign = u & 0x80
  const exponent = (u >> 4) & 0x07
  const mantissa = u & 0x0f
  const sample = (((mantissa << 3) + BIAS) << exponent) - BIAS
  return sign ? -sample : sample
}

export function mulawEncodeSample(sample: number): number {
  const sign = sample < 0 ? 0x80 : 0
  const magnitude = Math.min(CLIP, Math.abs(sample)) + BIAS
  let exponent = 7
  for (let mask = 0x4000; exponent > 0 && !(magnitude & mask); exponent--, mask >>= 1) { /* acha o expoente */ }
  const mantissa = (magnitude >> (exponent + 3)) & 0x0f
  return ~(sign | (exponent << 4) | mantissa) & 0xff
}

export function mulawToPcm16(mulaw: Buffer): Int16Array {
  const out = new Int16Array(mulaw.length)
  for (let i = 0; i < mulaw.length; i++) out[i] = mulawDecodeByte(mulaw[i])
  return out
}

export function pcm16ToMulaw(pcm: Int16Array): Buffer {
  const out = Buffer.alloc(pcm.length)
  for (let i = 0; i < pcm.length; i++) out[i] = mulawEncodeSample(pcm[i])
  return out
}

/** Empacota PCM 16-bit mono em WAV (cabeçalho de 44 bytes), formato aceito por qualquer STT em lote. */
export function pcm16ToWav(pcm: Int16Array, sampleRate = 8000): Buffer {
  const dataBytes = pcm.length * 2
  const buf = Buffer.alloc(44 + dataBytes)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + dataBytes, 4)
  buf.write('WAVEfmt ', 8)
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20) // PCM
  buf.writeUInt16LE(1, 22) // mono
  buf.writeUInt32LE(sampleRate, 24)
  buf.writeUInt32LE(sampleRate * 2, 28)
  buf.writeUInt16LE(2, 32)
  buf.writeUInt16LE(16, 34)
  buf.write('data', 36)
  buf.writeUInt32LE(dataBytes, 40)
  for (let i = 0; i < pcm.length; i++) buf.writeInt16LE(pcm[i], 44 + i * 2)
  return buf
}

export function mulawToWav(mulaw: Buffer): Buffer {
  return pcm16ToWav(mulawToPcm16(mulaw), 8000)
}
