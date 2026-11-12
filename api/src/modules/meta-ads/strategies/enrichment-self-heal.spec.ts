import { PrismaService } from 'src/database/prisma.service'
import { MetaAdsMapper } from '../mappers/meta-ads.mapper'
import { MetaVideoSourceService } from '../services/meta-video-source.service'
import { InsightsSyncStrategy } from './insights-sync.strategy'
import {
  THUMBNAIL_ACCEPTABLE_PX,
  ENRICHMENT_SELF_HEAL_LIMIT,
  THUMBNAIL_STORAGE_PREFIX,
} from '../constants/meta-ads.constants'

/**
 * Caso TFA (31/08/2026): depois de "Sincronizar Meta" as imagens continuavam borradas e a
 * tela seguia dizendo "Este criativo ainda nao tem identificacao de video".
 *
 * As duas fases de enriquecimento filtravam por `report_start_date/report_end_date` da
 * janela sincronizada. Anuncio sem entrega no periodo nunca era reprocessado: dos 6
 * criativos da TFA, 4 pararam de veicular em 16/07 e o preset da tela e "Este mes".
 */
describe('Enriquecimento — auto-cura fora da janela de datas', () => {
  let strategy: any

  beforeEach(() => {
    strategy = new InsightsSyncStrategy({} as PrismaService, {} as MetaAdsMapper, new MetaVideoSourceService())
  })

  describe('predicado de thumbnail (fonte unica das 3 escritas)', () => {
    const sql = () => strategy.thumbnailPodeMelhorarSql()

    it('cobre os quatro casos que precisam melhorar', () => {
      const s = sql()
      expect(s).toContain('thumbnail_url IS NULL')
      expect(s).toContain("LIKE '%fbcdn.net%'")
      expect(s).toContain("LIKE '%cdninstagram.com%'")
      expect(s).toContain(`/${THUMBNAIL_STORAGE_PREFIX}/`)
    })

    it('compara a largura CARIMBADA na chave, nao a presenca de um sufixo fixo', () => {
      // O bug anterior: `NOT LIKE '%-1080.%'` dava por boa qualquer chave carimbada
      // -1080, e o carimbo era escrito a partir do que se PEDIU a Meta, nao do que veio.
      expect(sql()).toContain(`< ${THUMBNAIL_ACCEPTABLE_PX}`)
      expect(sql()).toMatch(/substring\(.*from '-\(\[0-9\]\+\)/)
      expect(sql()).not.toContain("NOT LIKE '%-1080.%'")
    })

    it('aceita a coluna por parametro, para servir a escrita do frame de video', () => {
      expect(strategy.thumbnailPodeMelhorarSql('t.thumbnail_url')).toContain('t.thumbnail_url IS NULL')
    })
  })

  describe('seleção de anúncios', () => {
    const capturarSql = async (metodo: string) => {
      const chamadas: string[] = []
      strategy.prisma = {
        $queryRawUnsafe: jest.fn(async (sql: string) => {
          chamadas.push(sql)
          return []
        }),
      }
      jest.spyOn(strategy.logger, 'log').mockImplementation(() => {})
      await strategy[metodo]('co-1', 'act_1', 'tok', new Date('2026-08-01'), new Date('2026-08-31'))
      return chamadas[0]
    }

    it('thumbnail: une a janela com um lote de auto-cura SEM filtro de data', async () => {
      const sql = await capturarSql('enrichThumbnails')

      expect(sql).toContain('UNION')
      // a primeira metade mantem o filtro de periodo
      expect(sql).toContain('report_start_date >= $2')
      // a segunda ordena do mais antigo e tem teto — e nao repete o filtro de data
      expect(sql).toContain('ORDER BY max(report_end_date) ASC')
      expect(sql).toContain(`LIMIT ${ENRICHMENT_SELF_HEAL_LIMIT}`)
      expect(sql.split('UNION')[1]).not.toContain('report_start_date >= $2')
    })

    it('video: mesma estrutura, e SEM o portao de thumbnail', async () => {
      const sql = await capturarSql('enrichVideoUrls')

      expect(sql).toContain('UNION')
      expect(sql).toContain(`LIMIT ${ENRICHMENT_SELF_HEAL_LIMIT}`)
      // o portao antigo fazia anuncio sem capa nunca receber video_id — e video_id e o
      // que a tela exige para oferecer a analise do criativo
      expect(sql).not.toContain('thumbnail_url IS NOT NULL')
      expect(sql.split('UNION')[1]).toContain('video_id IS NULL')
    })
  })
})

/**
 * A causa mais provável de `video_id` estar NULL em 100% das linhas: ele só era gravado na
 * FASE 2, que pede `source` do nó Video — a chamada que falha em 99,7% dos casos medidos.
 * Os dois `continue` de erro (chunk inteiro e vídeo individual) descartavam o id que a
 * fase 1 já tinha em mãos. Como `ad_creative_analysis` é chaveada por
 * (company_id, video_id) NOT NULL, isso bloqueava a análise inteira.
 */
describe('enrichVideoUrls — identidade não depende da mídia', () => {
  const montar = () => {
    const strategy: any = new InsightsSyncStrategy({} as PrismaService, {} as MetaAdsMapper, new MetaVideoSourceService())
    const updates: { sql: string; params: any[] }[] = []
    strategy.prisma = {
      $queryRawUnsafe: jest.fn(async () => [{ adId: 'ad-1' }]),
      $executeRawUnsafe: jest.fn(async (sql: string, ...params: any[]) => {
        updates.push({ sql, params })
        return 1
      }),
    }
    jest.spyOn(strategy.logger, 'log').mockImplementation(() => {})
    jest.spyOn(strategy.logger, 'warn').mockImplementation(() => {})
    return { strategy, updates }
  }

  const gravacoesDeVideoId = (updates: { sql: string; params: any[] }[]) =>
    updates.filter((u) => /SET video_id/.test(u.sql))

  afterEach(() => jest.restoreAllMocks())

  it('grava o video_id mesmo quando a busca do mp4 falha inteira', async () => {
    const { strategy, updates } = montar()
    global.fetch = jest
      .fn()
      // fase 1: descobre o video_id
      .mockResolvedValueOnce({ json: async () => ({ 'ad-1': { creative: { video_id: '1371073824012492' } } }) })
      // fase 2: a Meta recusa o nó Video (o caso normal — exige token de Página)
      .mockResolvedValueOnce({ json: async () => ({ error: { message: 'Unsupported get request', code: 100 } }) }) as any

    await strategy.enrichVideoUrls('co-1', 'act_1', 'tok', new Date('2026-08-01'), new Date('2026-08-31'))

    const gravacoes = gravacoesDeVideoId(updates)
    expect(gravacoes).toHaveLength(1)
    expect(gravacoes[0].params).toEqual(['1371073824012492', 'co-1', 'ad-1'])
  })

  it('grava o video_id antes de sequer tentar o mp4', async () => {
    const { strategy, updates } = montar()
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({ json: async () => ({ 'ad-1': { creative: { video_id: '999' } } }) })
      .mockResolvedValueOnce({ json: async () => ({ '999': { source: 'https://cdn/x.mp4' } }) }) as any

    await strategy.enrichVideoUrls('co-1', 'act_1', 'tok', new Date('2026-08-01'), new Date('2026-08-31'))

    // a identidade é a PRIMEIRA escrita, não uma consequência do mp4 ter dado certo
    expect(updates[0].sql).toMatch(/SET video_id/)
    expect(updates[0].params[0]).toBe('999')
  })

  it('extrai o video_id de object_story_spec quando não vem direto no creative', async () => {
    const { strategy, updates } = montar()
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        json: async () => ({ 'ad-1': { creative: { object_story_spec: { video_data: { video_id: '555' } } } } }),
      })
      .mockResolvedValueOnce({ json: async () => ({ error: { message: 'nope' } }) }) as any

    await strategy.enrichVideoUrls('co-1', 'act_1', 'tok', new Date('2026-08-01'), new Date('2026-08-31'))

    expect(gravacoesDeVideoId(updates)[0].params[0]).toBe('555')
  })

  /**
   * Criativo Advantage+ / dinâmico guarda o vídeo em `asset_feed_spec.videos[]`, não em
   * `creative.video_id` nem em `object_story_spec`. Faltava pedir esse campo — e como o
   * `enrichThumbnails` JÁ pedia `asset_feed_spec{images{...}}`, a imagem desses criativos
   * era achada e o vídeo não. Sintoma medido na TFA: o anúncio `video_1` com 127.393
   * reproduções e a coluna `video_id` vazia.
   */
  it('extrai o video_id de asset_feed_spec (criativo Advantage+/dinâmico)', async () => {
    const { strategy, updates } = montar()
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        json: async () => ({
          'ad-1': { creative: { asset_feed_spec: { videos: [{ video_id: '777' }] } } },
        }),
      })
      .mockResolvedValueOnce({ json: async () => ({ error: { message: 'sem source' } }) }) as any

    await strategy.enrichVideoUrls('co-1', 'act_1', 'tok', new Date('2026-08-01'), new Date('2026-08-31'))

    expect(gravacoesDeVideoId(updates)[0].params[0]).toBe('777')
  })

  it('pede asset_feed_spec na fase 1 — sem isso o criativo dinâmico não tem onde ser achado', async () => {
    const { strategy } = montar()
    global.fetch = jest.fn().mockResolvedValue({ json: async () => ({}) }) as any

    await strategy.enrichVideoUrls('co-1', 'act_1', 'tok', new Date('2026-08-01'), new Date('2026-08-31'))

    expect((global.fetch as jest.Mock).mock.calls[0][0]).toContain('asset_feed_spec')
  })

  it('asset_feed_spec sem vídeo nenhum não inventa identidade', async () => {
    const { strategy, updates } = montar()
    global.fetch = jest.fn().mockResolvedValueOnce({
      json: async () => ({ 'ad-1': { creative: { asset_feed_spec: { images: [{ url: 'x' }] } } } }),
    }) as any

    await strategy.enrichVideoUrls('co-1', 'act_1', 'tok', new Date('2026-08-01'), new Date('2026-08-31'))

    expect(gravacoesDeVideoId(updates)).toHaveLength(0)
  })

  /**
   * SONDA DE 01/09/2026 (`scripts/probe-meta-video-source.ts`, conta act_1005886918068643).
   * Não é doc, é medição — as duas tentativas anteriores partiram de hipótese e erraram.
   *
   * Existem DUAS classes de vídeo, separadas pelo campo `from`:
   *   - de Página (dark post): `from` presente, EVERYONE, `published=false`. Token de
   *     usuário devolve `source` vazio (0/3); o token da Página DONA devolve (3/3, bytes
   *     conferidos: 206, video/mp4, magic "ftyp").
   *   - da conta de anúncios: `from` AUSENTE, SELF, `published=true`. Só sai listando
   *     `/act_X/advideos` (2 de 4 na conta medida).
   *
   * E o achado que destrava: `from.id` vem no MESMO lote `?ids=` pedido com o token de
   * usuário, mesmo quando `source` vem vazio. O código anterior chaveava o token de Página
   * em `object_story_spec.page_id`, que nos três criativos medidos veio AUSENTE — e que,
   * mesmo presente, é a Página do ANÚNCIO, não necessariamente a dona do VÍDEO.
   */
  describe('cascata do mp4 (MetaVideoSourceService)', () => {
    const resp = (body: any) => ({ json: async () => body })

    it('escolhe o token pelo `from.id` do vídeo, não por object_story_spec.page_id', async () => {
      const { strategy } = montar()
      global.fetch = jest
        .fn()
        // fase 1 — repare que o page_id do criativo é OUTRA Página
        .mockResolvedValueOnce(resp({
          'ad-1': { creative: { video_id: '77', object_story_spec: { page_id: 'pag-do-anuncio' } } },
        }))
        // trilha 1 — token de usuário: sem source, mas com o dono real
        .mockResolvedValueOnce(resp({ '77': { from: { id: 'pag-dona', name: 'Página Dona' } } }))
        // /me/accounts
        .mockResolvedValueOnce(resp({ data: [
          { id: 'pag-do-anuncio', access_token: 'TOKEN_ERRADO' },
          { id: 'pag-dona', access_token: 'TOKEN_DA_DONA' },
        ] }))
        // trilha 2 — lote com o token da Página dona
        .mockResolvedValueOnce(resp({ '77': { source: 'https://cdn/v.mp4' } })) as any

      await strategy.enrichVideoUrls('co-1', 'act_1', 'TOKEN_DO_USUARIO', new Date('2026-08-01'), new Date('2026-08-31'))

      const urlDaTrilha2 = (global.fetch as jest.Mock).mock.calls[3][0]
      expect(urlDaTrilha2).toContain('TOKEN_DA_DONA')
      expect(urlDaTrilha2).not.toContain('TOKEN_ERRADO')
      expect(urlDaTrilha2).not.toContain('TOKEN_DO_USUARIO')
    })

    it('source que já vem no token de usuário não paga trilha de Página', async () => {
      const { strategy, updates } = montar()
      global.fetch = jest
        .fn()
        .mockResolvedValueOnce(resp({ 'ad-1': { creative: { video_id: '77' } } }))
        .mockResolvedValueOnce(resp({ '77': { source: 'https://cdn/publico.mp4' } })) as any

      await strategy.enrichVideoUrls('co-1', 'act_1', 'tok', new Date('2026-08-01'), new Date('2026-08-31'))

      // só fase 1 + trilha 1: nada de /me/accounts nem de /advideos
      expect((global.fetch as jest.Mock)).toHaveBeenCalledTimes(2)
      expect(updates.some((u) => u.params[0] === 'https://cdn/publico.mp4')).toBe(true)
    })

    it('/me/accounts vazio (System User) ainda acha o token por GET /{page_id}', async () => {
      // alban e maclo são integrações MANUAL, sem metaFacebookUserId — provável System
      // User, e System User não tem Páginas em /me/accounts. Sem este caminho a cascata
      // morreria justamente nos dois maiores tenants (87% das linhas com vídeo).
      const { strategy } = montar()
      global.fetch = jest
        .fn()
        .mockResolvedValueOnce(resp({ 'ad-1': { creative: { video_id: '77' } } }))
        .mockResolvedValueOnce(resp({ '77': { from: { id: 'pag-9', name: 'Dona' } } }))
        .mockResolvedValueOnce(resp({ data: [] }))                                   // /me/accounts vazio
        .mockResolvedValueOnce(resp({ id: 'pag-9', access_token: 'TOKEN_DIRETO' }))   // GET /{page_id}
        .mockResolvedValueOnce(resp({ '77': { source: 'https://cdn/v.mp4' } })) as any

      await strategy.enrichVideoUrls('co-1', 'act_1', 'tok', new Date('2026-08-01'), new Date('2026-08-31'))

      expect((global.fetch as jest.Mock).mock.calls[4][0]).toContain('TOKEN_DIRETO')
    })

    it('vídeo sem `from` é da conta: cai na biblioteca /advideos', async () => {
      const { strategy, updates } = montar()
      global.fetch = jest
        .fn()
        .mockResolvedValueOnce(resp({ 'ad-1': { creative: { video_id: '77' } } }))
        .mockResolvedValueOnce(resp({ '77': { length: 30 } }))    // sem source E sem from
        .mockResolvedValueOnce(resp({ data: [{ id: '77', source: 'https://cdn/biblioteca.mp4' }] })) as any

      await strategy.enrichVideoUrls('co-1', 'act_1', 'tok', new Date('2026-08-01'), new Date('2026-08-31'))

      expect((global.fetch as jest.Mock).mock.calls[2][0]).toContain('/act_1/advideos')
      expect(updates.some((u) => u.params[0] === 'https://cdn/biblioteca.mp4')).toBe(true)
    })

    it('sem token da Página, grava a embed e não derruba a fase', async () => {
      const { strategy, updates } = montar()
      global.fetch = jest
        .fn()
        .mockResolvedValueOnce(resp({ 'ad-1': { creative: { video_id: '77' } } }))
        .mockResolvedValueOnce(resp({ '77': { from: { id: 'pag-9', name: 'Dona' } } }))
        // /me/accounts e depois GET /{page_id}: nenhum dos dois dá token
        .mockResolvedValueOnce(resp({ error: { message: 'sem permissao' } }))
        .mockResolvedValueOnce(resp({ error: { message: 'sem permissao' } })) as any

      await strategy.enrichVideoUrls('co-1', 'act_1', 'tok', new Date('2026-08-01'), new Date('2026-08-31'))

      const urls = updates.filter((u) => /SET video_url/.test(u.sql)).map((u) => u.params[0])
      expect(urls).toEqual(['https://www.facebook.com/facebook/videos/77/'])
    })

    it('mp4 real vence a URL de embed fabricada', async () => {
      const { strategy, updates } = montar()
      global.fetch = jest
        .fn()
        .mockResolvedValueOnce(resp({ 'ad-1': { creative: { video_id: '77' } } }))
        .mockResolvedValueOnce(resp({ '77': { from: { id: 'pag-9' } } }))
        .mockResolvedValueOnce(resp({ data: [{ id: 'pag-9', access_token: 'TOKEN_DA_PAGINA' }] }))
        .mockResolvedValueOnce(resp({ '77': { source: 'https://cdn/real.mp4' } })) as any

      await strategy.enrichVideoUrls('co-1', 'act_1', 'tok', new Date('2026-08-01'), new Date('2026-08-31'))

      const urls = updates.filter((u) => /SET video_url/.test(u.sql)).map((u) => u.params[0])
      expect(urls).toContain('https://cdn/real.mp4')
      expect(urls.some((u: string) => u.includes('facebook.com/facebook/videos'))).toBe(false)
    })
  })

  it('anúncio de imagem (sem video_id) não gera gravação de identidade', async () => {
    const { strategy, updates } = montar()
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({ json: async () => ({ 'ad-1': { creative: { image_url: 'https://x/y.jpg' } } }) }) as any

    await strategy.enrichVideoUrls('co-1', 'act_1', 'tok', new Date('2026-08-01'), new Date('2026-08-31'))

    expect(gravacoesDeVideoId(updates)).toHaveLength(0)
  })
})
