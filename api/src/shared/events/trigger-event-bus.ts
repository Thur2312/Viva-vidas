import { EventEmitter } from 'events'

// STUB: o original (HDM) liga o bus ao motor de triggers/automacoes. Aqui e um
// EventEmitter simples; nada consome os eventos ate o novo projeto ligar um listener.
class TriggerEventBus extends EventEmitter {
  private static instance: TriggerEventBus

  static getInstance(): TriggerEventBus {
    if (!TriggerEventBus.instance) {
      TriggerEventBus.instance = new TriggerEventBus()
      TriggerEventBus.instance.setMaxListeners(20)
    }
    return TriggerEventBus.instance
  }

  emitTracking(data: { companyId: string; eventType: 'CREATED' | 'SENT' | 'FAILED'; payload: Record<string, any> }) {
    this.emit('tracking', data)
    this.emit('triggerEvent', {
      eventName: `tracking.${data.eventType.toLowerCase()}`,
      companyId: data.companyId,
      entityType: 'TRACKING',
      payload: data.payload,
      metadata: { timestamp: new Date(), source: 'prisma_extension' },
    })
  }
}

export const triggerEventBus = TriggerEventBus.getInstance()
