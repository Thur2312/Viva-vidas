import { SpeechSynthesizer } from '../agent.types'
import { TtsProvider, resolveTts, ttsProviderId } from '../../providers/tts'
import { ElevenLabsStreamTts } from './elevenlabs-stream-tts'

/** 3200 bytes de μ-law 8 kHz = 400 ms: blocos pequenos para o barge-in cortar a fala logo. */
const CHUNK = 3200

/**
 * Faz um TtsProvider (uma chamada por frase) servir ao agente de voz: sintetiza a frase inteira em μ-law 8 kHz
 * e a entrega em blocos de 400 ms. O agente já fala frase a frase (sentence-chunker), então a latência extra
 * é a de uma frase curta. Aborta entre blocos quando o lead interrompe.
 */
export class ProviderStreamTts implements SpeechSynthesizer {
  constructor(private readonly tts: TtsProvider) {}

  async *stream(text: string, signal: AbortSignal): AsyncIterable<Buffer> {
    if (!text?.trim() || signal.aborted) return
    const { audio } = await this.tts.synthesize(text, { format: 'ulaw_8000' })
    for (let i = 0; i < audio.length; i += CHUNK) {
      if (signal.aborted) return
      yield audio.subarray(i, i + CHUNK)
    }
  }
}

/** Sintetizador do agente conforme o provedor escolhido no painel. ElevenLabs mantém o streaming nativo. */
export function resolveStreamTts(): SpeechSynthesizer {
  return ttsProviderId() === 'elevenlabs' ? new ElevenLabsStreamTts() : new ProviderStreamTts(resolveTts())
}
