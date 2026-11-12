import { PrismaService } from 'src/database/prisma.service'
import { getMetaAuthError } from 'src/shared/util/meta-auth-error.utils'
import { MetaAdsMapper } from '../mappers/meta-ads.mapper'
import { MetaVideoSourceService } from '../services/meta-video-source.service'
import { InsightsSyncStrategy } from './insights-sync.strategy'
import { MetaGraphError } from './base-sync.strategy'

/**
 * Incidente digienge de 31/08/2026: o token foi revogado pela Meta (OAuthException 190,
 * subcode 460 — troca de senha do Facebook) e o sync varreu os 105 chunks semanais, cada
 * um com um GET e um POST de async report, para no fim logar
 * "=== TOTAL: 0 registros da API Meta === / Sync finalizado" e devolver `errors: 0`.
 *
 * O que estes testes travam: erro de AUTENTICACAO aborta na PRIMEIRA chamada; qualquer
 * outro erro mantem a tolerancia chunk-a-chunk de antes.
 */
describe('InsightsSyncStrategy — aborta em erro de token', () => {
  const TOKEN_REVOGADO = {
    message:
      'Error validating access token: The session has been invalidated because the user ' +
      'changed their password or Facebook has changed the session for security reasons.',
    type: 'OAuthException',
    code: 190,
    error_subcode: 460,
    fbtrace_id: 'A_d_xAs02RbemIMzy5UWQWE',
  }

  let strategy: InsightsSyncStrategy
  let fetchMock: jest.SpyInstance

  const respostaDeErro = (error: any) =>
    ({ json: async () => ({ error }) }) as any

  beforeEach(() => {
    jest.clearAllMocks()
    strategy = new InsightsSyncStrategy({} as PrismaService, {} as MetaAdsMapper, new MetaVideoSourceService())
    // sleep real deixaria o teste com os 104s de espera entre chunks do incidente
    jest.spyOn(strategy as any, 'sleep').mockResolvedValue(undefined)
    jest.spyOn((strategy as any).logger, 'log').mockImplementation(() => {})
    jest.spyOn((strategy as any).logger, 'warn').mockImplementation(() => {})
    jest.spyOn((strategy as any).logger, 'error').mockImplementation(() => {})
    fetchMock = jest.spyOn(global, 'fetch' as any)
  })

  afterEach(() => fetchMock.mockRestore())

  describe('fetchWithRetry preserva o erro estruturado', () => {
    it('lanca MetaGraphError com code e error_subcode intactos', async () => {
      fetchMock.mockResolvedValue(respostaDeErro(TOKEN_REVOGADO))

      const erro = await (strategy as any)
        .fetchWithRetry('https://graph.facebook.com/v25.0/act_1/insights')
        .catch((e: any) => e)

      expect(erro).toBeInstanceOf(MetaGraphError)
      expect(erro.error.code).toBe(190)
      expect(erro.error.error_subcode).toBe(460)
      // e o util de auth reconhece a forma { error: {...} } sem adaptador nenhum
      expect(getMetaAuthError(erro)).toEqual({
        code: 190,
        subcode: 460,
        message: TOKEN_REVOGADO.message,
      })
    })

    it('nao gasta os 3 retries com 190 — o retry e so do erro 99', async () => {
      fetchMock.mockResolvedValue(respostaDeErro(TOKEN_REVOGADO))

      await expect(
        (strategy as any).fetchWithRetry('https://graph.facebook.com/v25.0/act_1/insights')
      ).rejects.toThrow(MetaGraphError)

      expect(fetchMock).toHaveBeenCalledTimes(1)
    })
  })

  describe('fetchBySplittingPeriod', () => {
    it('token revogado: 1 chamada a Meta, nao 105 chunks x 2', async () => {
      fetchMock.mockResolvedValue(respostaDeErro(TOKEN_REVOGADO))

      await expect(
        (strategy as any).fetchBySplittingPeriod('act_1', 'tok', 'maximum', 'ad', ['spend'])
      ).rejects.toMatchObject({ error: { code: 190, error_subcode: 460 } })

      // 1 GET do chunk 1 e nada mais: nem o POST do async report, nem o chunk 2
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(fetchMock.mock.calls[0][1]?.method).not.toBe('POST')
    })

    it('erro que NAO e de token continua tolerante — segue para o proximo chunk', async () => {
      // 4 chunks de 7 dias cobrem os ~28 dias de last_28d
      fetchMock.mockResolvedValue(respostaDeErro({ message: 'Please reduce the amount of data', code: 1 }))

      const resultado = await (strategy as any).fetchBySplittingPeriod(
        'act_1',
        'tok',
        'last_28d',
        'ad',
        ['spend']
      )

      expect(resultado).toEqual([])
      // varreu todos os chunks em vez de abortar — comportamento preservado
      expect(fetchMock.mock.calls.length).toBeGreaterThan(4)
    })
  })

  describe('rethrowIfMetaAuthError', () => {
    it.each([
      ['rate limit', { code: 17, message: 'User request limit reached' }],
      ['payload invalido', { code: 100, message: 'Invalid parameter' }],
      ['erro 99 de volume', { code: 1, error_subcode: 99, message: 'Please reduce' }],
    ])('%s nao aborta o sync', (_nome, error) => {
      expect(() => (strategy as any).rethrowIfMetaAuthError(new MetaGraphError(error))).not.toThrow()
    })

    it.each([
      ['190/460 troca de senha', { code: 190, error_subcode: 460 }],
      ['190/458 app desautorizado', { code: 190, error_subcode: 458 }],
      ['190/463 expirado', { code: 190, error_subcode: 463 }],
      ['102 sessao invalida', { code: 102 }],
    ])('%s aborta o sync', (_nome, error) => {
      expect(() =>
        (strategy as any).rethrowIfMetaAuthError(new MetaGraphError({ message: 'x', ...error }))
      ).toThrow()
    })
  })
})

/**
 * A linha se anunciava como "URL (sem token)" e imprimia o token inteiro. A redacao era por
 * VALOR (`url.replace(accessToken, ...)`), mas `URLSearchParams.toString()` percent-encoda:
 * um token com `:` — o formato do ciphertext quando a ENCRYPTION_KEY nao abre o dado —
 * nunca batia. Token normal da Meta nao tem caractere encodavel e era redigido, que e por
 * que ninguem percebeu: o vazamento so disparava no caso de falha.
 */
describe('BaseSyncStrategy.redactToken', () => {
  const strategy: any = new InsightsSyncStrategy({} as PrismaService, {} as MetaAdsMapper, new MetaVideoSourceService())

  const montarUrl = (token: string) =>
    'https://graph.facebook.com/v25.0/act_1/insights?' +
    new URLSearchParams({ level: 'ad', access_token: token, limit: '200' }).toString()

  it.each([
    ['ciphertext com dois-pontos', '6a3cad58:f270e17d:7e0d77c2'],
    ['token normal da Meta', 'EAAabc123XYZ_-'],
    ['token com caractere que encoda', 'abc+def/ghi=='],
  ])('%s some do log', (_nome, token) => {
    const redigida = strategy.redactToken(montarUrl(token))

    expect(redigida).not.toContain(token)
    expect(redigida).not.toContain(encodeURIComponent(token))
    expect(redigida).toContain('access_token=***TOKEN***')
    // o resto da URL continua legivel — o log serve para depurar
    expect(redigida).toContain('level=ad')
    expect(redigida).toContain('limit=200')
  })

  it('nao come outros parametros depois do token', () => {
    const redigida = strategy.redactToken(montarUrl('EAAtoken'))
    expect(redigida).toBe(
      'https://graph.facebook.com/v25.0/act_1/insights?level=ad&access_token=***TOKEN***&limit=200'
    )
  })
})
