import { Injectable, Logger } from '@nestjs/common'

import { getMetaAuthError } from 'src/shared/util/meta-auth-error.utils'

import { META_API_BASE, META_API_VERSION } from '../constants/meta-ads.constants'

/** Um frame do no Video (`thumbnails{uri,width,height,is_preferred}`). */
export interface MetaVideoThumbnail {
  uri: string
  width: number
  height: number
  is_preferred?: boolean
}

/** Por onde o mp4 apareceu. Vai para o log: e o que permite medir sem adivinhar. */
export type MetaVideoVia = 'user_token' | 'owner_page_token' | 'ad_account_library'

/**
 * `reason` e o unico discriminante — o tsconfig do projeto roda com
 * `strictNullChecks: false`, e sob essa flag um discriminante booleano nao estreita a
 * uniao. Mesma forma de `MetaProbeResult` (`src/shared/util/meta-probe.utils.ts`).
 */
export type MetaVideoSourceResult =
  /** Tem mp4. `url` e assinada e expira (`&oe=`) — nao guardar como se fosse eterna. */
  | { reason: 'ok'; url: string; via: MetaVideoVia; lengthSec?: number; thumbnails?: MetaVideoThumbnail[] }
  /** Video de Pagina, mas nao conseguimos token DAQUELA Pagina. */
  | { reason: 'no_page_token'; pageId: string; pageName?: string; message: string }
  /** Chegamos ao fim da cascata sem mp4. */
  | { reason: 'no_source'; pageId?: string; message: string }
  /** OAuthException 190/102 — token revogado ou expirado. */
  | { reason: 'auth'; message: string }
  /** Rede, timeout, 5xx. Nunca e veredito sobre o token. */
  | { reason: 'network'; message: string }

/** Retorno interno do multi-get: corpo cru, ou falha ja traduzida para o chamador. */
type LoteResultado =
  | { estado: 'corpo'; body: any }
  | { estado: 'falha'; falha: MetaVideoSourceResult }

export interface ResolveVideoSourcesInput {
  /** Token de usuario (ou System User) da empresa. */
  accessToken: string
  /** `act_123` ou `123`. Usado so na trilha da biblioteca. */
  adAccountId?: string | null
  videoIds: string[]
}

/** Lote do multi-get `/?ids=`. A Meta aceita ate 50. */
const CHUNK_SIZE = 50
/** Teto de paginas da biblioteca da conta: 30 x 100 = 3.000 videos. */
const LIBRARY_MAX_PAGES = 30
const TIMEOUT_MS = 20000
const VIDEO_FIELDS = 'from,source,length,thumbnails{uri,width,height,is_preferred}'

/**
 * Descobre o mp4 (`source`) de videos de criativo do Meta.
 *
 * TRES TRILHAS, e cada uma esta aqui porque foi MEDIDA (sonda de 01/09/2026 sobre a
 * conta act_1005886918068643, `scripts/probe-meta-video-source.ts`) — nao porque a doc
 * sugeriu. As duas tentativas anteriores de consertar isso partiram de hipotese e as
 * duas erraram, entao o criterio aqui e outro: caminho sem medicao nao entra.
 *
 * O que a sonda mostrou e que existem DUAS CLASSES de video, distinguiveis pelo campo
 * `from`, e que elas exigem autorizacoes diferentes:
 *
 *   1. VIDEO DE PAGINA (dark post): `from` presente, `privacy=EVERYONE`,
 *      `published=false`. Token de usuario devolve `source` VAZIO (0/3); o token da
 *      Pagina DONA devolve o mp4 (3/3, bytes conferidos: 206, video/mp4, magic "ftyp").
 *   2. VIDEO DA CONTA DE ANUNCIOS: `from` AUSENTE, `privacy=SELF`, `published=true`.
 *      Nao sai por token nenhum na leitura do no; sai listando `/act_X/advideos`
 *      (2 de 4 com `source` na conta medida).
 *
 * A DESCOBERTA QUE DESTRAVA TUDO e que `from.id` — o dono real do video — vem no MESMO
 * lote `/?ids=` que ja pedimos com o token de usuario, mesmo quando `source` vem vazio.
 * O codigo anterior chaveava o token de Pagina em `object_story_spec.page_id`, que nos
 * tres criativos medidos veio AUSENTE, e que mesmo presente e a Pagina do ANUNCIO, nao
 * necessariamente a dona do VIDEO (o video 1371073824012492 e do "TFA Argentina"
 * enquanto a conta tem outras duas Paginas). Por isso ele caia sempre no token de
 * usuario e o mp4 nunca vinha.
 *
 * Nao lanca: devolve `reason` por video. Quem chama decide o que fazer com cada motivo,
 * e a mensagem que o usuario le sai daqui em vez de ser uma frase fixa e generica.
 */
@Injectable()
export class MetaVideoSourceService {
  private readonly logger = new Logger(MetaVideoSourceService.name)

  /**
   * Resolve um lote de videos.
   *
   * Em lote de proposito: a trilha 1 e uma chamada para 50 videos, os tokens de Pagina
   * sao reusados entre videos da mesma Pagina, e a biblioteca da conta e varrida UMA vez
   * para todos. Resolver um por um multiplicaria tudo isso pelo numero de criativos.
   */
  async resolveMany(input: ResolveVideoSourcesInput): Promise<Map<string, MetaVideoSourceResult>> {
    const resultado = new Map<string, MetaVideoSourceResult>()
    const ids = [...new Set(input.videoIds.filter(Boolean).map(String))]
    if (ids.length === 0) return resultado

    /** videoId -> Pagina dona, quando houver. */
    const donoDoVideo = new Map<string, { id: string; name?: string }>()
    /** Videos sem `from`: candidatos da biblioteca da conta. */
    const semDono: string[] = []
    /** Videos de Pagina ainda sem mp4, agrupados pela Pagina dona. */
    const pendentesPorPagina = new Map<string, string[]>()

    // ── Trilha 1: lote com o token de usuario ────────────────────────────────
    // Alem do raro `source` de video publico, e daqui que sai o `from` de TODOS —
    // e o `from` e o que decide as trilhas 2 e 3.
    for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
      const lote = ids.slice(i, i + CHUNK_SIZE)
      const dados = await this.buscaLote(lote, input.accessToken)

      if (dados.estado === 'falha') {
        for (const id of lote) resultado.set(id, dados.falha)
        continue
      }

      for (const id of lote) {
        const v = dados.body?.[id]
        if (v?.error) {
          const auth = getMetaAuthError(v)
          resultado.set(id, auth
            ? { reason: 'auth', message: auth.message }
            : { reason: 'no_source', message: v.error.message ?? 'a Meta recusou a leitura deste video' })
          continue
        }

        if (v?.source) {
          resultado.set(id, this.ok(v, 'user_token'))
          continue
        }

        const from = v?.from
        if (from?.id) {
          donoDoVideo.set(id, { id: String(from.id), name: from.name })
          const lista = pendentesPorPagina.get(String(from.id)) ?? []
          lista.push(id)
          pendentesPorPagina.set(String(from.id), lista)
        } else {
          semDono.push(id)
        }
      }
    }

    // ── Trilha 2: token da Pagina DONA ───────────────────────────────────────
    if (pendentesPorPagina.size > 0) {
      const tokens = await this.tokensDePagina([...pendentesPorPagina.keys()], input.accessToken)

      for (const [pageId, videos] of pendentesPorPagina) {
        const dono = donoDoVideo.get(videos[0])
        const tokenDaPagina = tokens.get(pageId)

        if (!tokenDaPagina) {
          for (const id of videos) {
            resultado.set(id, {
              reason: 'no_page_token',
              pageId,
              pageName: dono?.name,
              message:
                `o video pertence a Pagina ${dono?.name ?? pageId} (${pageId}), e o usuario ` +
                'conectado nao da token dela — reconecte a integracao Meta com alguem que ' +
                'administre essa Pagina, ou conceda o acesso no Gerenciador de Negocios',
            })
          }
          continue
        }

        for (let i = 0; i < videos.length; i += CHUNK_SIZE) {
          const lote = videos.slice(i, i + CHUNK_SIZE)
          const dados = await this.buscaLote(lote, tokenDaPagina)

          if (dados.estado === 'falha') {
            for (const id of lote) resultado.set(id, dados.falha)
            continue
          }

          for (const id of lote) {
            const v = dados.body?.[id]
            resultado.set(id, v?.source
              ? this.ok(v, 'owner_page_token')
              : {
                  reason: 'no_source',
                  pageId,
                  message:
                    `a Pagina ${dono?.name ?? pageId} respondeu, mas nao devolveu o arquivo ` +
                    'do video (pode ter sido removido ou ainda estar processando)',
                })
          }
        }
      }
    }

    // ── Trilha 3: biblioteca da conta de anuncios ────────────────────────────
    // So para os videos SEM `from` — os que a conta possui, nao uma Pagina. A varredura
    // e preguicosa: conta sem video desse tipo nunca paga por ela.
    if (semDono.length > 0) {
      const biblioteca = await this.varreBiblioteca(input.adAccountId, semDono, input.accessToken)

      for (const id of semDono) {
        const daBiblioteca = biblioteca.get(id)
        resultado.set(id, daBiblioteca
          ? this.ok(daBiblioteca, 'ad_account_library')
          : {
              reason: 'no_source',
              message:
                'o video nao tem Pagina dona e nao apareceu na biblioteca da conta de ' +
                'anuncios — nao ha de onde baixar o arquivo',
            })
      }
    }

    return resultado
  }

  /** Um video so. Atalho sobre `resolveMany` — a cascata e exatamente a mesma. */
  async resolveOne(
    input: Omit<ResolveVideoSourcesInput, 'videoIds'> & { videoId: string },
  ): Promise<MetaVideoSourceResult> {
    const mapa = await this.resolveMany({ ...input, videoIds: [input.videoId] })
    return (
      mapa.get(String(input.videoId)) ?? {
        reason: 'no_source',
        message: 'a Meta nao respondeu sobre este video',
      }
    )
  }

  // ── internos ───────────────────────────────────────────────────────────────

  private ok(v: any, via: MetaVideoVia): MetaVideoSourceResult {
    return {
      reason: 'ok',
      url: v.source,
      via,
      lengthSec: typeof v.length === 'number' ? v.length : undefined,
      thumbnails: v?.thumbnails?.data ?? undefined,
    }
  }

  /**
   * Multi-get `/?ids=`. Devolve o corpo cru ou uma falha ja classificada.
   *
   * O discriminante e `estado`, e nao um `reason: 'ok'` reaproveitado: `MetaVideoSourceResult`
   * ja usa `reason: 'ok'` para outra forma, e as duas juntas na mesma uniao deixam o
   * compilador sem como estreitar.
   */
  private async buscaLote(ids: string[], token: string): Promise<LoteResultado> {
    const params = new URLSearchParams({
      ids: ids.join(','),
      fields: VIDEO_FIELDS,
      access_token: token,
    })

    let body: any
    try {
      const resp = await fetch(`${META_API_BASE}/${META_API_VERSION}/?${params}`, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      body = await resp.json()
    } catch (error: any) {
      return { estado: 'falha', falha: { reason: 'network', message: error?.message ?? 'falha de rede' } }
    }

    if (body?.error) {
      const auth = getMetaAuthError(body)
      return {
        estado: 'falha',
        falha: auth
          ? { reason: 'auth', message: auth.message }
          : { reason: 'no_source', message: body.error.message ?? 'a Meta recusou o lote' },
      }
    }

    return { estado: 'corpo', body }
  }

  /**
   * Token de cada Pagina pedida.
   *
   * Duas fontes, nesta ordem, e a segunda nao e redundancia:
   *   1. `/me/accounts` — uma chamada cobre todas as Paginas do usuario.
   *   2. `GET /{page_id}?fields=access_token` — para o que faltar.
   *
   * (2) existe porque `/me/accounts` volta VAZIO para token de System User (nao ha
   * pessoa por tras para ter Paginas), e os dois maiores tenants da base — alban e
   * maclo, 87% das linhas com video — usam integracao MANUAL, sem `metaFacebookUserId`.
   * So com (1) a cascata inteira morreria justamente neles. Medido: (2) devolveu token
   * para as tres Paginas testadas.
   *
   * Nunca lanca: Pagina sem token vira `no_page_token`, com o id e o nome no texto.
   */
  private async tokensDePagina(pageIds: string[], accessToken: string): Promise<Map<string, string>> {
    const tokens = new Map<string, string>()

    try {
      const params = new URLSearchParams({
        fields: 'id,name,access_token',
        limit: '100',
        access_token: accessToken,
      })
      const resp = await fetch(`${META_API_BASE}/${META_API_VERSION}/me/accounts?${params}`, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      const body = await resp.json()
      if (body?.error) {
        this.logger.warn(`/me/accounts nao listou Paginas: ${JSON.stringify(body.error)}`)
      }
      for (const p of body?.data ?? []) {
        if (p?.id && p?.access_token) tokens.set(String(p.id), p.access_token)
      }
    } catch (error: any) {
      this.logger.warn(`/me/accounts falhou (best-effort): ${error?.message ?? error}`)
    }

    for (const pageId of pageIds) {
      if (tokens.has(pageId)) continue
      try {
        const params = new URLSearchParams({ fields: 'access_token', access_token: accessToken })
        const resp = await fetch(`${META_API_BASE}/${META_API_VERSION}/${pageId}?${params}`, {
          signal: AbortSignal.timeout(TIMEOUT_MS),
        })
        const body = await resp.json()
        if (body?.access_token) tokens.set(pageId, body.access_token)
      } catch {
        // Pagina inalcancavel vira no_page_token la em cima, com a razao legivel.
      }
    }

    // Conta so as Paginas PEDIDAS: `/me/accounts` costuma trazer outras, e usar
    // `tokens.size` como numerador imprimia coisas como "3/2 Paginas com token".
    const cobertas = pageIds.filter((id) => tokens.has(id)).length
    this.logger.log(`${cobertas}/${pageIds.length} Pagina(s) dona(s) com token para buscar o mp4`)
    return tokens
  }

  /**
   * Varre `/act_X/advideos` e devolve os nos que tem `source`.
   *
   * A doc do edge NAO expoe `filtering` (os parametros de GET sao `min/maxheight`,
   * `min/maxlength`, `title`…), entao nao da para pedir por id: pagina-se e casa-se
   * aqui. Para de paginar assim que todos os ids procurados aparecem — o caso comum e
   * achar tudo nas primeiras paginas.
   */
  private async varreBiblioteca(
    adAccountId: string | null | undefined,
    procurados: string[],
    accessToken: string,
  ): Promise<Map<string, any>> {
    const achados = new Map<string, any>()
    if (!adAccountId) return achados

    const conta = String(adAccountId).startsWith('act_') ? String(adAccountId) : `act_${adAccountId}`
    const querFaltando = () => procurados.some((id) => !achados.has(id))

    let after: string | undefined
    let paginas = 0

    do {
      const params = new URLSearchParams({
        fields: 'id,source,length,thumbnails{uri,width,height,is_preferred}',
        limit: '100',
        access_token: accessToken,
      })
      if (after) params.set('after', after)

      let body: any
      try {
        const resp = await fetch(`${META_API_BASE}/${META_API_VERSION}/${conta}/advideos?${params}`, {
          signal: AbortSignal.timeout(TIMEOUT_MS),
        })
        body = await resp.json()
      } catch (error: any) {
        this.logger.warn(`biblioteca de ${conta} falhou: ${error?.message ?? error}`)
        break
      }

      if (body?.error) {
        this.logger.warn(`biblioteca de ${conta} recusada: ${JSON.stringify(body.error)}`)
        break
      }

      for (const v of body?.data ?? []) {
        if (v?.id && v?.source) achados.set(String(v.id), v)
      }

      after = body?.paging?.cursors?.after
      paginas++
    } while (after && paginas < LIBRARY_MAX_PAGES && querFaltando())

    this.logger.log(
      `biblioteca de ${conta}: ${paginas} pagina(s), ${achados.size} video(s) com mp4`,
    )
    return achados
  }
}
