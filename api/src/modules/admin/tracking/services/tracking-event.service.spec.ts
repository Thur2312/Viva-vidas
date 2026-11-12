import { TrackingEventService } from './tracking-event.service'
import { triggerEventBus } from 'src/shared/events/trigger-event-bus'

const createPrismaMock = () => ({
  leads: { findFirst: jest.fn().mockResolvedValue(null) },
})

const createActionConfigMock = () => ({
  resolve: jest.fn().mockResolvedValue(null),
})

/** `emitTrackingEvent` publica dentro de um setImmediate. */
const flush = () => new Promise((resolve) => setImmediate(resolve))

describe('TrackingEventService — catálogo no payload', () => {
  let service: TrackingEventService
  let prisma: ReturnType<typeof createPrismaMock>
  let actionConfig: ReturnType<typeof createActionConfigMock>
  let emitTracking: jest.SpyInstance

  beforeEach(() => {
    jest.clearAllMocks()
    prisma = createPrismaMock()
    actionConfig = createActionConfigMock()
    service = new TrackingEventService(prisma as any, actionConfig as any)
    emitTracking = jest.spyOn(triggerEventBus, 'emitTracking').mockImplementation(() => undefined as any)
  })

  afterEach(() => {
    emitTracking.mockRestore()
  })

  const emit = async (overrides: Record<string, any> = {}) => {
    await service.emitTrackingEvent({
      companyId: 'c-1',
      action: 'video_50',
      email: 'a@b.com',
      ...overrides,
    })
    await flush()
    return emitTracking.mock.calls[0]?.[0]?.payload
  }

  it('sem catálogo o payload NAO ganha a chave `value`', async () => {
    // A chave tem que estar AUSENTE, nao `null`. O shouldSkipWhenAbsent() do
    // TriggerConditionService descarta condicao cujo campo e undefined; com null
    // ela seria avaliada, e Number(null) e 0 — entao `tracking.value >= 0`
    // casaria toda acao sem catalogo.
    const payload = await emit()

    expect(payload).not.toHaveProperty('value')
    expect(payload).not.toHaveProperty('metaEventName')
  })

  it('peso do catálogo entra em `value`', async () => {
    actionConfig.resolve.mockResolvedValue({ label: null, metaEventName: null, eventValue: 50 })

    const payload = await emit()

    expect(payload.value).toBe(50)
  })

  it('peso zero entra no payload — é valor real, não ausência', async () => {
    actionConfig.resolve.mockResolvedValue({ label: null, metaEventName: null, eventValue: 0 })

    const payload = await emit()

    expect(payload.value).toBe(0)
  })

  it('nome do catálogo entra em `metaEventName`, sem tocar em `eventName`', async () => {
    // `eventName` continua sendo a acao CRUA: e ela que a condicao casa e que
    // alimenta o buildEventId. O rotulo viaja separado.
    actionConfig.resolve.mockResolvedValue({
      label: 'Assistiu 50%',
      metaEventName: 'ViewContent',
      eventValue: 50,
    })

    const payload = await emit()

    expect(payload.eventName).toBe('video_50')
    expect(payload.metaEventName).toBe('ViewContent')
    expect(payload.actionLabel).toBe('Assistiu 50%')
  })

  it('resolve o catálogo pela empresa, pela CAMPANHA e pela ação recebida', async () => {
    // A campanha do próprio tracking escolhe o escopo: o mesmo `optin` pode
    // valer 80 no lançamento e 30 no blog. Na digienge ele dispara em 27.
    await emit({ action: 'OPTIN', campaignId: 'camp-1' })

    expect(actionConfig.resolve).toHaveBeenCalledWith('c-1', 'camp-1', 'OPTIN')
  })

  it('tracking sem campanha cai no padrão da empresa', async () => {
    await emit({ action: 'OPTIN' })

    expect(actionConfig.resolve).toHaveBeenCalledWith('c-1', undefined, 'OPTIN')
  })

  it('falha ao resolver o catálogo não impede a emissão', async () => {
    // Catalogo e enriquecimento. Se uma rejeicao caisse no try/catch de
    // `emitTrackingEvent`, catalogo quebrado viraria trigger que nao dispara e
    // conversao perdida — em silencio, que e exatamente como o `lead.campaign`
    // ficou 83 dias morto.
    actionConfig.resolve.mockRejectedValue(new Error('banco fora'))

    const payload = await emit()

    expect(emitTracking).toHaveBeenCalledTimes(1)
    expect(payload.eventName).toBe('video_50')
    expect(payload).not.toHaveProperty('value')
  })
})
