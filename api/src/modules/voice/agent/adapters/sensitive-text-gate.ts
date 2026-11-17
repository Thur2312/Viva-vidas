import { flagSensitive } from '../../../pilot/compliance/redaction'
import { TextGate } from '../agent.types'

/**
 * Portão de texto do agente de voz: usa o mesmo detector de saúde do pipeline de texto (`flagSensitive`,
 * que prefere falso positivo). Texto marcado como sensível nunca chega ao LLM (art. 11 da LGPD).
 */
export class SensitiveTextGate implements TextGate {
  check(text: string): { allowed: boolean; reason?: string } {
    const r = flagSensitive(text)
    return r.containsSensitive ? { allowed: false, reason: `sensivel:${r.categories.join(',')}` } : { allowed: true }
  }
}
