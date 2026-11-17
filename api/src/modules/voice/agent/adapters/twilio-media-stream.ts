import { AudioOutput } from '../agent.types'

/**
 * Protocolo do Twilio Media Streams (WebSocket, mensagens JSON). Sem dependência de servidor WebSocket:
 * quem tem o socket passa as mensagens recebidas para `parseTwilioMessage` e dá a `TwilioAudioOutput` uma função `send`.
 * Escrito contra a documentação pública; UNTESTED com Twilio real.
 */
export type TwilioEvent =
  | { type: 'connected' }
  | { type: 'start'; streamSid: string; callSid: string | null; customParameters: Record<string, string> }
  | { type: 'media'; payload: Buffer; track: string | null }
  | { type: 'mark'; name: string }
  | { type: 'stop' }
  | { type: 'unknown'; event: string }

export function parseTwilioMessage(raw: string | Buffer): TwilioEvent | null {
  let m: any
  try { m = JSON.parse(typeof raw === 'string' ? raw : raw.toString('utf8')) } catch { return null }
  switch (m?.event) {
    case 'connected': return { type: 'connected' }
    case 'start': {
      const s = m.start ?? {}
      if (typeof s.streamSid !== 'string' && typeof m.streamSid !== 'string') return null
      return { type: 'start', streamSid: s.streamSid ?? m.streamSid, callSid: s.callSid ?? null, customParameters: s.customParameters ?? {} }
    }
    case 'media': {
      const p = m.media?.payload
      if (typeof p !== 'string') return null
      return { type: 'media', payload: Buffer.from(p, 'base64'), track: m.media?.track ?? null }
    }
    case 'mark': return { type: 'mark', name: String(m.mark?.name ?? '') }
    case 'stop': return { type: 'stop' }
    default: return { type: 'unknown', event: String(m?.event ?? '') }
  }
}

/** Saída de áudio para o Twilio: `media` com payload base64 e `clear` para o barge-in. */
export class TwilioAudioOutput implements AudioOutput {
  /** Blocos por mensagem (Twilio aceita tamanhos variados; blocos pequenos deixam o `clear` mais preciso). */
  constructor(private readonly streamSid: string, private readonly send: (json: string) => void, private readonly chunkBytes = 800) {}

  play(chunk: Buffer): void {
    for (let i = 0; i < chunk.length; i += this.chunkBytes) {
      this.send(JSON.stringify({ event: 'media', streamSid: this.streamSid, media: { payload: chunk.subarray(i, i + this.chunkBytes).toString('base64') } }))
    }
  }

  clear(): void {
    this.send(JSON.stringify({ event: 'clear', streamSid: this.streamSid }))
  }

  mark(name: string): void {
    this.send(JSON.stringify({ event: 'mark', streamSid: this.streamSid, mark: { name } }))
  }
}
