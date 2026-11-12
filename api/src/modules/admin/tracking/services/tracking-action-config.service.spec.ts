import { BadRequestException } from '@nestjs/common'
import { TrackingActionConfigService } from './tracking-action-config.service'
import { TrackingActionConfigAuditService } from './tracking-action-config-audit.service'

const createPrismaMock = () => ({
  trackingActionConfig: {
    findMany: jest.fn().mockResolvedValue([]),
    upsert: jest.fn(),
    deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    groupBy: jest.fn().mockResolvedValue([]),
  },
  trackingActionConfigChange: {
    createMany: jest.fn().mockResolvedValue({ count: 0 }),
    findMany: jest.fn().mockResolvedValue([]),
    count: jest.fn().mockResolvedValue(0),
  },
  // Por padrao a campanha existe e e da empresa — o caminho feliz.
  campaigns: { findFirst: jest.fn().mockResolvedValue({ campaignId: 'camp-1' }) },
  // Resolve as operacoes do array: o `remove` desestrutura o primeiro resultado
  // para devolver o `count`, entao um mock que responde `[]` quebraria nele.
  $transaction: jest.fn((ops: any) => (Array.isArray(ops) ? Promise.all(ops) : ops)),
})

/** As linhas de trilha que o save gravaria, ja achatadas do `createMany`. */
const auditRows = (prisma: ReturnType<typeof createPrismaMock>) =>
  prisma.trackingActionConfigChange.createMany.mock.calls.flatMap(
    (call: any[]) => call[0].data as any[],
  )

const createRedisMock = () => ({
  // Por padrao o cache erra e o fetch roda — e o caminho que o teste quer medir.
  cachedLookup: jest.fn((_key: string, fetchFn: () => Promise<any>) => fetchFn()),
  del: jest.fn().mockResolvedValue(undefined),
})

const createAnalyticsMock = () => ({
  getTrackingActionUsage: jest.fn().mockResolvedValue([]),
})

/** Açúcar: a agregação no formato que o service consome. */
const usage = (...rows: [string, number, string?][]) =>
  rows.map(([action, eventCount, lastSeen]) => ({
    action,
    eventCount,
    lastSeenAt: lastSeen ? new Date(lastSeen) : null,
  }))

describe('TrackingActionConfigService', () => {
  let service: TrackingActionConfigService
  let prisma: ReturnType<typeof createPrismaMock>
  let redis: ReturnType<typeof createRedisMock>
  let analytics: ReturnType<typeof createAnalyticsMock>

  beforeEach(() => {
    jest.clearAllMocks()
    prisma = createPrismaMock()
    redis = createRedisMock()
    analytics = createAnalyticsMock()
    // Service real, nao mock: a decisao de "isto mudou ou nao" e o ponto do
    // recorte e precisa ser exercitada pelos testes do upsert.
    service = new TrackingActionConfigService(
      prisma as any,
      redis as any,
      analytics as any,
      new TrackingActionConfigAuditService(prisma as any),
    )
  })

  describe('list', () => {
    it('acao observada sem mapeamento aparece como nao configurada', async () => {
      // Sem isto o usuario nao descobre o que pode mapear: a tela mostraria so
      // as linhas ja salvas, e uma acao nova nunca apareceria.
      analytics.getTrackingActionUsage.mockResolvedValue(usage(['optin', 10], ['video_50', 3]))

      const rows = await service.list('c-1')

      expect(rows).toHaveLength(2)
      expect(rows[0]).toMatchObject({ action: 'optin', isConfigured: false, isObserved: true })
      expect(rows[0].metaEventName).toBeNull()
      expect(rows[0].eventValue).toBeNull()
    })

    it('ordena por volume, nao alfabeticamente', async () => {
      // A ordem alfabetica punha `acceced` (1 evento, jun/2025, typo de
      // "accessed") na primeira linha da digienge e `optin` (3.059) na 28a.
      analytics.getTrackingActionUsage.mockResolvedValue(
        usage(['acceced', 1], ['optin', 3059], ['acessou', 3004]),
      )

      const rows = await service.list('c-1')

      expect(rows.map((r) => r.action)).toEqual(['optin', 'acessou', 'acceced'])
    })

    it('empate no volume desempata por nome', async () => {
      analytics.getTrackingActionUsage.mockResolvedValue(usage(['zeta', 5], ['alfa', 5]))

      const rows = await service.list('c-1')

      expect(rows.map((r) => r.action)).toEqual(['alfa', 'zeta'])
    })

    it('propaga eventCount e lastSeenAt para a tela', async () => {
      analytics.getTrackingActionUsage.mockResolvedValue(usage(['optin', 3059, '2026-08-18']))

      const [row] = await service.list('c-1')

      expect(row.eventCount).toBe(3059)
      expect(row.lastSeenAt).toEqual(new Date('2026-08-18'))
    })

    it('mescla o mapeamento salvo na acao observada', async () => {
      analytics.getTrackingActionUsage.mockResolvedValue(usage(['video_50', 20]))
      prisma.trackingActionConfig.findMany.mockResolvedValue([
        {
          campaignId: '',
          action: 'video_50',
          label: 'Assistiu 50%',
          metaEventName: 'ViewContent',
          eventValue: 50,
          isActive: true,
        },
      ])

      const [row] = await service.list('c-1')

      expect(row).toMatchObject({
        action: 'video_50',
        label: 'Assistiu 50%',
        metaEventName: 'ViewContent',
        eventValue: 50,
        isConfigured: true,
        isObserved: true,
      })
    })

    it('mapeamento de acao que parou de disparar NAO some da lista', async () => {
      // Uma acao sazonal (lancamento) sumiria da tela levando junto o peso que
      // alguem configurou, e voltaria a enviar sem valor quando disparasse de novo.
      analytics.getTrackingActionUsage.mockResolvedValue(usage(['optin', 10]))
      prisma.trackingActionConfig.findMany.mockResolvedValue([
        { campaignId: '', action: 'black_friday', label: null, metaEventName: 'Lead', eventValue: 90, isActive: true },
      ])

      const rows = await service.list('c-1')
      const orfa = rows.find((r) => r.action === 'black_friday')

      expect(orfa).toMatchObject({ isConfigured: true, isObserved: false, eventValue: 90 })
    })

    it('casa o mapeamento gravado em caixa alta com a acao em minusculo', async () => {
      // A tabela Tracking convive com OPTIN e optin: so 1 dos 5 caminhos de
      // escrita chama normalizeAction().
      analytics.getTrackingActionUsage.mockResolvedValue(usage(['optin', 10]))
      prisma.trackingActionConfig.findMany.mockResolvedValue([
        { campaignId: '', action: 'OPTIN', label: null, metaEventName: 'Lead', eventValue: 30, isActive: true },
      ])

      const rows = await service.list('c-1')

      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ action: 'optin', metaEventName: 'Lead', eventValue: 30 })
    })
  })

  describe('upsertMany', () => {
    it('normaliza a chave para minusculo antes de gravar', async () => {
      await service.upsertMany('c-1', [
        { action: '  OPTIN ', metaEventName: 'Lead', eventValue: 30 },
      ])

      expect(prisma.trackingActionConfig.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            companyId_campaignId_action: { companyId: 'c-1', campaignId: '', action: 'optin' },
          },
        }),
      )
    })

    it('aceita virgula decimal no peso', async () => {
      await service.upsertMany('c-1', [{ action: 'video_50', eventValue: '17,5' }])

      const call = prisma.trackingActionConfig.upsert.mock.calls[0][0]
      expect(call.create.eventValue).toBe(17.5)
    })

    it('sanitiza o nome pela regra da Meta', async () => {
      await service.upsertMany('c-1', [
        { action: 'video_50', metaEventName: 'Assistiu 50% do vídeo' },
      ])

      const call = prisma.trackingActionConfig.upsert.mock.calls[0][0]
      expect(call.create.metaEventName).toBe('Assistiu_50_do_video')
    })

    it('recusa nome que nao sobrevive a sanitizacao', async () => {
      await expect(
        service.upsertMany('c-1', [{ action: 'video_50', metaEventName: '???' }]),
      ).rejects.toBeInstanceOf(BadRequestException)
    })

    it('recusa peso negativo', async () => {
      await expect(
        service.upsertMany('c-1', [{ action: 'video_50', eventValue: -1 }]),
      ).rejects.toBeInstanceOf(BadRequestException)
    })

    it('peso zero e valor legitimo, nao ausencia', async () => {
      await service.upsertMany('c-1', [{ action: 'video_50', eventValue: 0 }])

      const call = prisma.trackingActionConfig.upsert.mock.calls[0][0]
      expect(call.create.eventValue).toBe(0)
    })

    it('linha inteiramente vazia apaga o mapeamento em vez de gravar registro vazio', async () => {
      await service.upsertMany('c-1', [
        { action: 'video_50', metaEventName: '', eventValue: '', label: '' },
      ])

      expect(prisma.trackingActionConfig.upsert).not.toHaveBeenCalled()
      expect(prisma.trackingActionConfig.deleteMany).toHaveBeenCalledWith({
        where: { companyId: 'c-1', campaignId: '', action: { in: ['video_50'] } },
      })
    })

    it('recusa a mesma acao duas vezes no mesmo envio', async () => {
      await expect(
        service.upsertMany('c-1', [
          { action: 'optin', eventValue: 10 },
          { action: 'OPTIN', eventValue: 20 },
        ]),
      ).rejects.toBeInstanceOf(BadRequestException)
    })

    it('invalida o cache depois de gravar', async () => {
      // Sem isto o emitter leria o valor velho por ate 60s e a verificacao
      // manual mediria o proprio erro.
      await service.upsertMany('c-1', [{ action: 'optin', eventValue: 30 }])

      expect(redis.del).toHaveBeenCalledWith('tracking-action-config:c-1')
    })

    it('invalida TAMBEM o cache da agregacao de uso', async () => {
      // Sao dois caches: o mapa que o emitter le e a agregacao que a tela le.
      // Esquecer o segundo faz a lista voltar sem o mapeamento recem-salvo.
      await service.upsertMany('c-1', [{ action: 'optin', eventValue: 30 }])

      expect(redis.del).toHaveBeenCalledWith('tracking-action-usage:c-1')
    })
  })

  describe('trilha de alteracoes', () => {
    /** O payload que a tela manda: TODAS as linhas do escopo, editadas ou nao. */
    const telaInteira = (edicao: { action: string } & Record<string, any>) => [
      { action: 'optin', metaEventName: '', eventValue: '' },
      { action: 'acessou', metaEventName: '', eventValue: '' },
      { action: 'acceced', metaEventName: '', eventValue: '' },
      { action: 'teste_nova_action', metaEventName: '', eventValue: '' },
      edicao,
    ]

    it('mexer em UMA linha grava UMA entrada, mesmo mandando a tela inteira', async () => {
      // A tela faz PUT com `Object.values(drafts)` — as ~36 acoes, sempre. Sem o
      // recorte, um clique em Salvar escreveria 36 linhas de historico.
      await service.upsertMany('c-1', telaInteira({ action: 'video_50', eventValue: 50 }))

      const rows = auditRows(prisma)
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ action: 'video_50', changeType: 'CREATED' })
    })

    it('acao que nunca teve mapeamento e continua sem NAO vira entrada apagada', async () => {
      // As ~30 linhas em branco caem no ramo do delete a cada save. Sem tratar o
      // caso, toda edicao diria que 30 acoes foram removidas.
      await service.upsertMany('c-1', telaInteira({ action: 'video_50', metaEventName: '' }))

      expect(prisma.trackingActionConfigChange.createMany).not.toHaveBeenCalled()
    })

    it('registra o de -> para so dos campos que mudaram', async () => {
      prisma.trackingActionConfig.findMany.mockResolvedValueOnce([
        {
          action: 'optin',
          label: null,
          metaEventName: 'Lead',
          eventValue: 10,
          isActive: true,
        },
      ])

      await service.upsertMany('c-1', [
        { action: 'optin', metaEventName: 'Lead', eventValue: 50 },
      ])

      const [row] = auditRows(prisma)
      expect(row.changeType).toBe('UPDATED')
      expect(row.changedFields).toEqual({ eventValue: { before: 10, after: 50 } })
    })

    it('zerar o peso e uma alteracao, nao ausencia de alteracao', async () => {
      // `0` e conversao de valor zero, um valor legitimo. Comparacao frouxa
      // (`==` ou `!value`) apagaria da trilha exatamente esta edicao.
      prisma.trackingActionConfig.findMany.mockResolvedValueOnce([
        { action: 'video_50', label: null, metaEventName: 'ViewContent', eventValue: 1.5, isActive: true },
      ])

      await service.upsertMany('c-1', [
        { action: 'video_50', metaEventName: 'ViewContent', eventValue: 0 },
      ])

      const [row] = auditRows(prisma)
      expect(row.changedFields).toEqual({ eventValue: { before: 1.5, after: 0 } })
    })

    it('limpar nome e peso de linha mapeada grava DELETED', async () => {
      prisma.trackingActionConfig.findMany.mockResolvedValueOnce([
        { action: 'optin', label: null, metaEventName: 'Lead', eventValue: 30, isActive: true },
      ])

      await service.upsertMany('c-1', [
        { action: 'optin', metaEventName: '', eventValue: '', label: '' },
      ])

      const [row] = auditRows(prisma)
      expect(row.changeType).toBe('DELETED')
      expect(row.changedFields).toEqual({
        metaEventName: { before: 'Lead', after: null },
        eventValue: { before: 30, after: null },
      })
    })

    it('carimba o autor vindo do JWT, nunca do corpo da requisicao', async () => {
      await service.upsertMany(
        'c-1',
        [{ action: 'optin', eventValue: 30 }],
        undefined,
        {
          userId: 'u-1',
          userName: 'Arthur',
          userEmail: 'arthur@hdm.com',
          ipAddress: '177.32.45.120',
          userAgent: 'Mozilla/5.0',
        },
      )

      expect(auditRows(prisma)[0]).toMatchObject({
        userId: 'u-1',
        userName: 'Arthur',
        userEmail: 'arthur@hdm.com',
        ipAddress: '177.32.45.120',
        userAgent: 'Mozilla/5.0',
      })
    })

    it('sem autor a linha ainda e gravada, com autor nulo', async () => {
      // Chamador interno (script, backfill) nao tem JWT. Recusar a trilha por
      // falta de autor perderia justamente a edicao que ninguem viu acontecer.
      await service.upsertMany('c-1', [{ action: 'optin', eventValue: 30 }])

      expect(auditRows(prisma)[0]).toMatchObject({ userId: null, userName: null })
    })

    it('a trilha vai na MESMA transacao do upsert', async () => {
      // Trilha que se perde num crash entre as duas escritas mente por omissao:
      // o peso muda e o historico jura que ninguem mexeu.
      await service.upsertMany('c-1', [{ action: 'optin', eventValue: 30 }])

      expect(prisma.$transaction).toHaveBeenCalledTimes(1)
      const ops = prisma.$transaction.mock.calls[0][0]
      expect(ops).toHaveLength(2)
      expect(prisma.trackingActionConfigChange.createMany).toHaveBeenCalledTimes(1)
    })

    it('escopo de campanha grava o campaignId na entrada', async () => {
      await service.upsertMany('c-1', [{ action: 'optin', eventValue: 50 }], 'camp-1')

      expect(auditRows(prisma)[0]).toMatchObject({ campaignId: 'camp-1', action: 'optin' })
    })

    it('padrao da empresa grava campaignId vazio', async () => {
      await service.upsertMany('c-1', [{ action: 'optin', eventValue: 50 }])

      expect(auditRows(prisma)[0]).toMatchObject({ campaignId: '' })
    })

    it('a rota DELETE tambem deixa rastro', async () => {
      // A UI apaga pelo PUT com a linha em branco, mas a rota existe. Sem isto
      // some da trilha exatamente o caminho que nao passa pela tela.
      prisma.trackingActionConfig.findMany.mockResolvedValueOnce([
        { action: 'optin', label: null, metaEventName: 'Lead', eventValue: 30, isActive: true },
      ])

      await service.remove('c-1', 'OPTIN', undefined, { userId: 'u-1', userName: 'Arthur' })

      const [row] = auditRows(prisma)
      expect(row).toMatchObject({ action: 'optin', changeType: 'DELETED', userId: 'u-1' })
    })

    it('apagar o que nao existe nao inventa entrada', async () => {
      await service.remove('c-1', 'inexistente')

      expect(prisma.trackingActionConfigChange.createMany).not.toHaveBeenCalled()
    })
  })

  describe('remove', () => {
    it('apaga pela chave normalizada e invalida o cache', async () => {
      await service.remove('c-1', 'OPTIN')

      expect(prisma.trackingActionConfig.deleteMany).toHaveBeenCalledWith({
        where: { companyId: 'c-1', campaignId: '', action: 'optin' },
      })
      expect(redis.del).toHaveBeenCalledWith('tracking-action-config:c-1')
    })
  })

  describe('getMap / resolve', () => {
    /** Linha do catalogo; `campaignId` vazio e o padrao da empresa. */
    const row = (
      action: string,
      metaEventName: string | null,
      eventValue: number | null,
      campaignId = '',
    ) => ({ campaignId, action, label: null, metaEventName, eventValue })

    it('devolve o mapa aninhado por escopo, com a acao em minusculo', async () => {
      prisma.trackingActionConfig.findMany.mockResolvedValue([row('OPTIN', 'Lead', 30)])

      const map = await service.getMap('c-1')

      expect(map).toEqual({ '': { optin: { label: null, metaEventName: 'Lead', eventValue: 30 } } })
    })

    it('separa o padrao da empresa do escopo da campanha', async () => {
      prisma.trackingActionConfig.findMany.mockResolvedValue([
        row('optin', 'Lead', 30),
        row('optin', null, 80, 'camp-1'),
      ])

      const map = await service.getMap('c-1')

      expect(map['']!.optin.eventValue).toBe(30)
      expect(map['camp-1']!.optin.eventValue).toBe(80)
    })

    it('so le linhas ativas', async () => {
      await service.getMap('c-1')

      expect(prisma.trackingActionConfig.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { companyId: 'c-1', isActive: true } }),
      )
    })

    it('resolve ignora a caixa da acao recebida', async () => {
      prisma.trackingActionConfig.findMany.mockResolvedValue([row('optin', 'Lead', 30)])

      await expect(service.resolve('c-1', null, 'OPTIN')).resolves.toEqual({
        label: null,
        metaEventName: 'Lead',
        eventValue: 30,
      })
    })

    it('campanha HERDA o nome e SOBRESCREVE o peso — campo a campo', async () => {
      // O caso de uso inteiro: na digienge o `optin` dispara em 27 campanhas.
      // Obrigar a redigitar `Lead` em cada uma seriam 27 chances de divergir.
      prisma.trackingActionConfig.findMany.mockResolvedValue([
        row('optin', 'Lead', 30),
        row('optin', null, 80, 'camp-1'),
      ])

      await expect(service.resolve('c-1', 'camp-1', 'optin')).resolves.toMatchObject({
        metaEventName: 'Lead',
        eventValue: 80,
      })
    })

    it('peso 0 da campanha NAO herda o peso da empresa', async () => {
      // `??` e nao `||`. Zero e conversao de valor zero, um valor legitimo —
      // com `||` a campanha que zerasse o peso pegaria 30 de volta.
      prisma.trackingActionConfig.findMany.mockResolvedValue([
        row('optin', 'Lead', 30),
        row('optin', null, 0, 'camp-1'),
      ])

      const resolved = await service.resolve('c-1', 'camp-1', 'optin')

      expect(resolved!.eventValue).toBe(0)
    })

    it('campanha sem linha propria cai inteira no padrao da empresa', async () => {
      prisma.trackingActionConfig.findMany.mockResolvedValue([row('optin', 'Lead', 30)])

      await expect(service.resolve('c-1', 'camp-99', 'optin')).resolves.toMatchObject({
        metaEventName: 'Lead',
        eventValue: 30,
      })
    })

    it('override de UMA campanha nao vaza para outra', async () => {
      prisma.trackingActionConfig.findMany.mockResolvedValue([
        row('optin', 'Lead', 30),
        row('optin', null, 80, 'camp-1'),
      ])

      const outra = await service.resolve('c-1', 'camp-2', 'optin')

      expect(outra!.eventValue).toBe(30)
    })

    it('linha SO de campanha nao afeta quem chega sem campanha', async () => {
      prisma.trackingActionConfig.findMany.mockResolvedValue([
        row('optin', 'Lead', 80, 'camp-1'),
      ])

      await expect(service.resolve('c-1', null, 'optin')).resolves.toBeNull()
    })

    it('acao sem mapeamento devolve null', async () => {
      await expect(service.resolve('c-1', null, 'video_50')).resolves.toBeNull()
    })

    it('acao vazia nem consulta o catalogo', async () => {
      await expect(service.resolve('c-1', null, '  ')).resolves.toBeNull()
      expect(redis.cachedLookup).not.toHaveBeenCalled()
    })

    it('falha no catalogo NAO derruba a emissao do evento', async () => {
      // Catalogo e enriquecimento. Sem ele o evento sai como saia antes, com o
      // nome cru e sem valor — trocar evento pobre por evento nenhum seria pior.
      redis.cachedLookup.mockRejectedValue(new Error('redis fora do ar'))

      await expect(service.resolve('c-1', null, 'optin')).resolves.toBeNull()
    })
  })

  describe('escopo de campanha em list / upsert / remove', () => {
    it('list sem campanha le so o padrao da empresa', async () => {
      await service.list('c-1')

      expect(prisma.trackingActionConfig.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { companyId: 'c-1', campaignId: { in: [''] } } }),
      )
    })

    it('list com campanha le os DOIS escopos — precisa do herdado pra tela', async () => {
      await service.list('c-1', 'camp-1')

      expect(prisma.trackingActionConfig.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { companyId: 'c-1', campaignId: { in: ['', 'camp-1'] } },
        }),
      )
    })

    it('list expoe o herdado separado do proprio', async () => {
      analytics.getTrackingActionUsage.mockResolvedValue(usage(['optin', 3059]))
      prisma.trackingActionConfig.findMany.mockResolvedValue([
        { campaignId: '', action: 'optin', label: null, metaEventName: 'Lead', eventValue: 30, isActive: true },
        { campaignId: 'camp-1', action: 'optin', label: null, metaEventName: null, eventValue: 80, isActive: true },
      ])

      const [row] = await service.list('c-1', 'camp-1')

      expect(row).toMatchObject({
        metaEventName: null, // esta campanha nao define nome
        eventValue: 80, // e define o peso
        inheritedMetaEventName: 'Lead', // o que vem do padrao
        inheritedEventValue: 30,
        isConfigured: true,
      })
    })

    it('no escopo da empresa nao ha herdado', async () => {
      analytics.getTrackingActionUsage.mockResolvedValue(usage(['optin', 10]))
      prisma.trackingActionConfig.findMany.mockResolvedValue([
        { campaignId: '', action: 'optin', label: null, metaEventName: 'Lead', eventValue: 30, isActive: true },
      ])

      const [row] = await service.list('c-1')

      expect(row.inheritedMetaEventName).toBeNull()
      expect(row.inheritedEventValue).toBeNull()
    })

    it('upsert grava no escopo da campanha', async () => {
      await service.upsertMany('c-1', [{ action: 'optin', eventValue: 80 }], 'camp-1')

      expect(prisma.trackingActionConfig.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            companyId_campaignId_action: {
              companyId: 'c-1',
              campaignId: 'camp-1',
              action: 'optin',
            },
          },
        }),
      )
    })

    it('upsert sem campanha grava no padrao da empresa', async () => {
      await service.upsertMany('c-1', [{ action: 'optin', eventValue: 30 }])

      const call = prisma.trackingActionConfig.upsert.mock.calls[0][0]
      expect(call.where.companyId_campaignId_action.campaignId).toBe('')
      expect(call.create.campaignId).toBe('')
    })

    it('campanha em branco cai no padrao da empresa, nunca em escopo fantasma', async () => {
      // Um escopo nao normalizado criaria linha que nenhuma unique pega e que o
      // getMap indexaria fora do bucket certo.
      await service.upsertMany('c-1', [{ action: 'optin', eventValue: 30 }], '   ')

      const call = prisma.trackingActionConfig.upsert.mock.calls[0][0]
      expect(call.where.companyId_campaignId_action.campaignId).toBe('')
    })

    it('remove apaga so no escopo pedido', async () => {
      await service.remove('c-1', 'optin', 'camp-1')

      expect(prisma.trackingActionConfig.deleteMany).toHaveBeenCalledWith({
        where: { companyId: 'c-1', campaignId: 'camp-1', action: 'optin' },
      })
    })

    it('linha vazia apaga so no escopo da campanha', async () => {
      await service.upsertMany('c-1', [{ action: 'optin', metaEventName: '', eventValue: '' }], 'camp-1')

      expect(prisma.trackingActionConfig.deleteMany).toHaveBeenCalledWith({
        where: { companyId: 'c-1', campaignId: 'camp-1', action: { in: ['optin'] } },
      })
    })
  })

  describe('listScopes', () => {
    /** Açúcar: o retorno do groupBy por (campanha, ação). */
    const overrides = (...pairs: [string, string][]) =>
      pairs.map(([campaignId, action]) => ({ campaignId, action }))

    it('o escopo da empresa nunca entra na lista', async () => {
      // A tela usa isto para dizer "N campanhas sobrescrevem este padrao". Se o
      // proprio padrao contasse como campanha, ele apareceria sobrescrevendo a
      // si mesmo.
      await service.listScopes('c-1')

      expect(prisma.trackingActionConfig.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { companyId: 'c-1', campaignId: { not: '' } },
        }),
      )
    })

    it('conta os overrides de cada campanha', async () => {
      prisma.trackingActionConfig.groupBy.mockResolvedValue(
        overrides(['camp-a', 'optin'], ['camp-a', 'video_50'], ['camp-b', 'optin']),
      )

      const { campaigns } = await service.listScopes('c-1')

      expect(campaigns).toEqual([
        { campaignId: 'camp-a', overrideCount: 2 },
        { campaignId: 'camp-b', overrideCount: 1 },
      ])
    })

    it('lista, por acao, em que campanhas ela e sobrescrita', async () => {
      // E o que alimenta o selo "2 campanhas" na linha da acao: sem ele, o
      // escopo da empresa nao tem como avisar que aquele peso nao vale em todo
      // lugar.
      prisma.trackingActionConfig.groupBy.mockResolvedValue(
        overrides(['camp-a', 'optin'], ['camp-b', 'optin'], ['camp-a', 'video_50']),
      )

      const { actions } = await service.listScopes('c-1')

      expect(actions).toEqual([
        { action: 'optin', campaignIds: ['camp-a', 'camp-b'] },
        { action: 'video_50', campaignIds: ['camp-a'] },
      ])
    })

    it('normaliza a caixa da acao', async () => {
      // A tabela `Tracking` convive com `OPTIN` e `optin`; a tela casa o selo
      // pela chave minuscula que `list()` devolve.
      prisma.trackingActionConfig.groupBy.mockResolvedValue(
        overrides(['camp-a', 'OPTIN'], ['camp-b', 'optin']),
      )

      const { actions } = await service.listScopes('c-1')

      expect(actions).toEqual([{ action: 'optin', campaignIds: ['camp-a', 'camp-b'] }])
    })

    it('escopo so de espaco nao vira campanha fantasma', async () => {
      // `campaignId: { not: '' }` no SQL deixa `'   '` passar, mas o resto do
      // service ja trata espaco em branco como padrao da empresa.
      prisma.trackingActionConfig.groupBy.mockResolvedValue(
        overrides(['   ', 'optin'], ['camp-a', 'optin']),
      )

      const { campaigns, actions } = await service.listScopes('c-1')

      expect(campaigns).toEqual([{ campaignId: 'camp-a', overrideCount: 1 }])
      expect(actions).toEqual([{ action: 'optin', campaignIds: ['camp-a'] }])
    })

    it('mesma acao em caixas diferentes na MESMA campanha conta uma vez', async () => {
      // Senao o chip diria "2 regras" onde ha uma.
      prisma.trackingActionConfig.groupBy.mockResolvedValue(
        overrides(['camp-a', 'OPTIN'], ['camp-a', 'optin']),
      )

      const { campaigns, actions } = await service.listScopes('c-1')

      expect(campaigns).toEqual([{ campaignId: 'camp-a', overrideCount: 1 }])
      expect(actions).toEqual([{ action: 'optin', campaignIds: ['camp-a'] }])
    })

    it('empresa sem nenhum override devolve as duas listas vazias', async () => {
      const scopes = await service.listScopes('c-1')

      expect(scopes).toEqual({ campaigns: [], actions: [] })
    })
  })

  describe('a campanha do escopo tem que ser da empresa', () => {
    it('upsert recusa campanha de outra empresa', async () => {
      // O findFirst filtra por campaignId E companyId: campanha alheia nao casa.
      prisma.campaigns.findFirst.mockResolvedValue(null)

      await expect(
        service.upsertMany('c-1', [{ action: 'optin', eventValue: 80 }], 'camp-de-outra'),
      ).rejects.toBeInstanceOf(BadRequestException)

      expect(prisma.trackingActionConfig.upsert).not.toHaveBeenCalled()
      expect(prisma.$transaction).not.toHaveBeenCalled()
    })

    it('valida contra companyId E soft delete', async () => {
      await service.upsertMany('c-1', [{ action: 'optin', eventValue: 80 }], 'camp-1')

      expect(prisma.campaigns.findFirst).toHaveBeenCalledWith({
        where: { campaignId: 'camp-1', companyId: 'c-1', deleted_at: null },
        select: { campaignId: true },
      })
    })

    it('campanha da propria empresa passa', async () => {
      await expect(
        service.upsertMany('c-1', [{ action: 'optin', eventValue: 80 }], 'camp-1'),
      ).resolves.toBeDefined()

      expect(prisma.trackingActionConfig.upsert).toHaveBeenCalled()
    })

    it('escopo padrao NAO consulta Campaigns — e o caso comum', async () => {
      // Seria uma query por save no caminho mais usado da tela, para fechar uma
      // porta que so existe quando ha campanha no escopo.
      await service.upsertMany('c-1', [{ action: 'optin', eventValue: 30 }])

      expect(prisma.campaigns.findFirst).not.toHaveBeenCalled()
    })

    it('remove recusa campanha de outra empresa', async () => {
      prisma.campaigns.findFirst.mockResolvedValue(null)

      await expect(service.remove('c-1', 'optin', 'camp-de-outra')).rejects.toBeInstanceOf(
        BadRequestException,
      )

      expect(prisma.trackingActionConfig.deleteMany).not.toHaveBeenCalled()
    })

    it('remove no escopo padrao NAO consulta Campaigns', async () => {
      await service.remove('c-1', 'optin')

      expect(prisma.campaigns.findFirst).not.toHaveBeenCalled()
      expect(prisma.trackingActionConfig.deleteMany).toHaveBeenCalled()
    })
  })
})
