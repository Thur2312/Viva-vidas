import { isIP } from 'net'
import { cdnEdgeCidrs, edgeRealIpHeader } from './cdn-edge-ranges'

/**
 * Resolucao do IP do cliente a partir de uma requisicao HTTP.
 *
 * POR QUE EXISTE: conviviam quatro implementacoes divergentes (logger.interceptor via
 * `request-ip`, request-provenance.decorator, track.controller e
 * organizations-management.controller). TODAS liam `X-Forwarded-For[0]` — a posicao que o
 * CLIENTE controla. Quem manda `X-Forwarded-For: 1.2.3.4` na mao aparecia como 1.2.3.4 no
 * log de auditoria e no `Leads.leadIp`. Nenhuma validava que o valor era mesmo um IP.
 *
 * O CRITERIO GENERICO (o mesmo do MDN) e varrer a cadeia da DIREITA para a ESQUERDA e parar
 * no primeiro endereco que NAO seja de um proxy confiavel. Ele continua aqui, como fallback.
 * Mas NAO e o caminho principal, porque nesta arquitetura ele nao alcanca o visitante.
 *
 * O QUE MUDOU, E POR QUE (medido em producao em 2026-08-20, via `GET /health/ip`):
 *
 * A borda da plataforma DESCARTA o `X-Forwarded-For` que o cliente manda e o reescreve como
 * `<quem conectou nela>, <borda>`. Quando ha uma Cloudflare na frente, quem conecta na
 * plataforma e a CLOUDFLARE — entao o XFF que chega aqui e `<IP da Cloudflare>, <borda>` e o
 * endereco do visitante nao esta mais na cadeia. Nao ha o que atravessar.
 *
 * Foi isso que deixou 3.371 leads da Maclo com o endereco de borda da Cloudflare no lugar do
 * IP de quem preencheu o formulario. E e por isso que por as faixas da Cloudflare em
 * `TRUSTED_PROXY_CIDRS` NAO consertou: pular o hop so troca o IP da Cloudflare pelo da
 * plataforma.
 *
 * O unico header que carrega o visitante nesse caminho e o `CF-Connecting-IP` — e a
 * plataforma o repassa INTACTO, o que significa que qualquer um que fale direto com a origem
 * pode inventa-lo. Por isso ele nunca e lido sozinho: so quando a ANCORA
 * (`X-Real-IP` / `XFF[0]`, que a borda sobrescreve e ninguem forja) prova que a requisicao
 * veio mesmo de uma borda de CDN nossa. Ver `edgeAnchor` e `isCdnEdgeIp` abaixo.
 */

/**
 * Faixas de onde um PROXY nosso pode falar. Nao sao "IPs invalidos": sao os enderecos que,
 * ao aparecerem na cadeia, devem ser PULADOS na busca pelo IP de quem originou a chamada.
 *
 * `100.64.0.0/10` (CGNAT) esta aqui porque e a faixa da malha interna do Railway.
 */
function isTrustedProxyIpv4(ip: string): boolean {
  const octets = ip.split('.')
  if (octets.length !== 4) return false
  const [a, b] = octets.map(Number)
  if (a === 127) return true // loopback
  if (a === 10) return true // privado
  if (a === 172 && b >= 16 && b <= 31) return true // privado
  if (a === 192 && b === 168) return true // privado
  if (a === 169 && b === 254) return true // link-local
  if (a === 100 && b >= 64 && b <= 127) return true // CGNAT — malha interna do Railway
  return false
}

/**
 * Verdadeiro quando o endereco e de um proxy da nossa propria infra, e portanto nao pode ser
 * o IP do cliente. Usada nos DOIS lugares que precisam do mesmo criterio: o `trust proxy` do
 * Express (em `main.ts`) e o `resolveClientIp` daqui. Uma regra so, em uma funcao so.
 */
/**
 * Faixas EXTRA de proxy confiavel, via `TRUSTED_PROXY_CIDRS` (lista separada por virgula,
 * ex.: `173.245.48.0/20,103.21.244.0/22`).
 *
 * POR QUE EXISTE: as faixas embutidas acima sao privadas/CGNAT, o que cobre um proxy na mesma
 * rede. Um CDN na frente fala de IP PUBLICO, e ai a varredura do XFF para no IP do CDN e passa
 * a gravar o endereco dele como se fosse o do visitante — silenciosamente.
 *
 * Isso NAO e hipotetico neste projeto: parte dos tenants ja resolve por Cloudflare (registro
 * CNAME criado com `proxied: true` em `domain-provisioning/cloudflare-dns.service.ts`),
 * enquanto outros caem no wildcard DNS-only e falam direto com o Railway. Env em vez de
 * literal porque a proxima plataforma tem outras faixas, e trocar de plataforma nao pode
 * exigir deploy de codigo.
 *
 * Vazio por default: sem a env, o comportamento e exatamente o de antes.
 */
/**
 * Header em que um hop interno nosso repassa o visitante ja resolvido.
 *
 * Mesma familia de `x-hdm-tenant`, `x-hdm-ingress` e `x-hdm-body-sha256`, que o proxy Next ja
 * manda — e sujeito a mesma disciplina: so vale vindo de dentro.
 */
export const VISITOR_IP_HEADER = 'x-hdm-visitor-ip'

const cachedCidrs = new Map<string, { raw: string; parsed: ParsedCidr[] }>()

interface ParsedCidr {
  base: bigint
  mask: bigint
  version: 4 | 6
}

function ipToBigInt(ip: string, version: 4 | 6): bigint | null {
  if (version === 4) {
    const parts = ip.split('.')
    if (parts.length !== 4) return null
    return parts.reduce((acc, part) => (acc << 8n) | BigInt(Number(part)), 0n)
  }

  // IPv6: expande `::` e monta os 8 grupos de 16 bits.
  const [head, tail] = ip.split('::')
  const headGroups = head ? head.split(':').filter(Boolean) : []
  const tailGroups = tail !== undefined ? tail.split(':').filter(Boolean) : []
  const fill = 8 - headGroups.length - tailGroups.length
  if (fill < 0) return null

  const groups = [...headGroups, ...Array(tail !== undefined ? fill : 0).fill('0'), ...tailGroups]
  if (groups.length !== 8) return null

  return groups.reduce((acc, g) => (acc << 16n) | BigInt(parseInt(g, 16)), 0n)
}

/** Compila e cacheia uma lista de CIDRs. Cache por VALOR CRU, para reagir a troca sem reiniciar. */
function parseCidrList(chave: string, raw: string): ParsedCidr[] {
  const hit = cachedCidrs.get(chave)
  if (hit && hit.raw === raw) return hit.parsed

  const parsed: ParsedCidr[] = []
  for (const entry of raw.split(',').map(e => e.trim()).filter(Boolean)) {
    const [addr, bitsRaw] = entry.split('/')
    const normalized = normalizeIp(addr)
    if (!normalized) continue

    const version = isIP(normalized) === 4 ? 4 : 6
    const width = version === 4 ? 32 : 128
    const bits = bitsRaw === undefined ? width : Number(bitsRaw)
    if (!Number.isInteger(bits) || bits < 0 || bits > width) continue

    const base = ipToBigInt(normalized, version)
    if (base === null) continue

    const mask = bits === 0 ? 0n : ((1n << BigInt(bits)) - 1n) << BigInt(width - bits)
    parsed.push({ base: base & mask, mask, version })
  }

  cachedCidrs.set(chave, { raw, parsed })
  return parsed
}

function isInCidrList(ip: string, chave: string, raw: string): boolean {
  const cidrs = parseCidrList(chave, raw)
  if (cidrs.length === 0) return false

  const version = isIP(ip) === 4 ? 4 : 6
  const value = ipToBigInt(ip, version)
  if (value === null) return false

  return cidrs.some(c => c.version === version && (value & c.mask) === c.base)
}

function isInConfiguredCidr(ip: string): boolean {
  return isInCidrList(ip, 'TRUSTED_PROXY_CIDRS', process.env.TRUSTED_PROXY_CIDRS ?? '')
}

/**
 * O endereco e de uma borda de CDN nossa (`CDN_EDGE_CIDRS`)?
 *
 * NAO e a mesma pergunta que `isTrustedProxyIp`. Aquela quer saber "posso PULAR este hop na
 * varredura do XFF"; esta quer saber "este hop e a Cloudflare, e portanto o `CF-Connecting-IP`
 * que veio junto foi escrito por ELA e nao pelo cliente". Confundir as duas foi o erro da
 * tentativa anterior: as faixas da Cloudflare estavam em `TRUSTED_PROXY_CIDRS`, o que nao
 * recuperava IP nenhum e ainda ampliava a superficie de spoof.
 */
export function isCdnEdgeIp(value: string | null | undefined): boolean {
  const ip = normalizeIp(value)
  return ip ? isInCidrList(ip, 'CDN_EDGE_CIDRS', cdnEdgeCidrs()) : false
}

export function isTrustedProxyIp(value: string | null | undefined): boolean {
  const ip = normalizeIp(value)
  if (!ip) return false

  if (isInConfiguredCidr(ip)) return true

  const version = isIP(ip)
  if (version === 4) return isTrustedProxyIpv4(ip)
  if (version !== 6) return false

  const lower = ip.toLowerCase()
  if (lower === '::1') return true // loopback
  if (/^fe80:/.test(lower)) return true // link-local
  if (/^f[cd][0-9a-f]{2}:/.test(lower)) return true // unique-local
  return false
}

/**
 * Devolve o IP em forma canonica, ou `null` se o valor nao for um IP.
 *
 * Duas normalizacoes, ambas com motivo concreto neste projeto:
 *  - IPv4-mapeado-em-IPv6 (`::ffff:189.45.12.77`) vira `189.45.12.77`. Sem isso o MESMO
 *    visitante vira DUAS chaves diferentes em `ip_geo_cache` e na contagem de leads por IP
 *    do `LeadsGeoService` — e a ip-api nao resolve a forma mapeada.
 *  - Porta anexada (`189.45.12.77:52918`), que alguns proxies mandam, e removida.
 */
export function normalizeIp(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null

  let ip = value.trim()
  if (!ip) return null

  // `"[::1]:8080"` / `"[::1]"` — forma com colchetes do IPv6 com porta.
  const bracketed = /^\[(.+)\](?::\d+)?$/.exec(ip)
  if (bracketed) ip = bracketed[1]

  // `189.45.12.77:52918` — porta em IPv4. So corta quando o que sobra e IP, para nao
  // mutilar um IPv6 sem colchetes (que tem `:` de monte e nenhuma porta).
  if (ip.includes(':') && isIP(ip) === 0) {
    const candidate = ip.slice(0, ip.lastIndexOf(':'))
    if (isIP(candidate)) ip = candidate
  }

  // `::ffff:189.45.12.77` -> `189.45.12.77`
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip)
  if (mapped && isIP(mapped[1]) === 4) return mapped[1]

  return isIP(ip) ? ip : null
}

/** Cadeia do `X-Forwarded-For` ja normalizada, na ordem em que veio (esquerda -> direita). */
function forwardedChain(headers: Record<string, unknown> | undefined): string[] {
  const raw = headers?.['x-forwarded-for']
  if (!raw) return []

  // O header pode chegar repetido; o Node entrega array nesse caso.
  const joined = Array.isArray(raw) ? raw.join(',') : String(raw)

  return joined
    .split(',')
    .map(part => normalizeIp(part))
    .filter((ip): ip is string => ip !== null)
}

interface RequestLike {
  ip?: string
  headers?: Record<string, unknown>
  socket?: { remoteAddress?: string }
  connection?: { remoteAddress?: string }
}

/**
 * O hop IMEDIATO e um proxy nosso?
 *
 * Nao usa `req.ip`: com o `trust proxy` de `main.ts`, `req.ip` ja e o IP do CLIENTE, que e
 * justamente quem NAO pode ser consultado aqui. O que decide se um header e cravel e quem o
 * entregou no socket.
 *
 * Mora aqui, junto de `isTrustedProxyIp`, porque os dois consumidores precisam da MESMA regra:
 * `resolveTenant` (que aceita `X-HDM-Tenant` so de dentro) e o `x-hdm-visitor-ip` logo abaixo.
 */
export function isTrustedHop(req: RequestLike | null | undefined): boolean {
  const peer = req?.socket?.remoteAddress ?? req?.connection?.remoteAddress
  return isTrustedProxyIp(peer)
}

/**
 * IP de quem originou a requisicao, ou `null` quando nao da para saber.
 *
 * Devolver `null` e proposital: e melhor uma coluna vazia do que um valor inventado. Os
 * chamadores que precisam de string (colunas legadas com `@default("")`) decidem o fallback.
 *
 * DUAS ETAPAS:
 *
 *  1. ANCORA — o primeiro endereco que nao e proxy nosso, contado da DIREITA para a esquerda.
 *     E o criterio de sempre (o do MDN), e continua sendo ele: e o unico seguro sem assumir
 *     nada sobre a plataforma. Tudo a esquerda da ancora veio do cliente e nao vale nada.
 *
 *  2. DESEMBRULHO DE CDN — se a ancora for uma borda de CDN nossa (`CDN_EDGE_CIDRS`), entao
 *     a requisicao passou comprovadamente por ela, e o `CF-Connecting-IP` que veio junto foi
 *     escrito por ela, nao pelo cliente. So nesse caso ele e lido.
 *
 * POR QUE A ETAPA 2 EXISTE: com uma Cloudflare na frente, a borda da plataforma ve a
 * CLOUDFLARE como cliente e reescreve o XFF para `<IP da Cloudflare>, <borda da plataforma>`.
 * O endereco do visitante nao esta mais na cadeia — a etapa 1 sozinha nao tem o que alcancar,
 * e para na borda do CDN. Foi o que deixou 3.371 leads da Maclo com o endereco da Cloudflare
 * no lugar do IP de quem preencheu o formulario.
 *
 * PRE-REQUISITO da etapa 1: as faixas da borda da PLATAFORMA precisam estar em
 * `TRUSTED_PROXY_CIDRS`, senao a varredura para nelas e a ancora vira o endereco da propria
 * plataforma (medido: `api.hdmfy.com` devolvia `152.233.23.193`, Miami, em vez do visitante).
 * Env e nao literal: trocar de plataforma nao pode exigir deploy.
 */
export function resolveClientIp(req: RequestLike | null | undefined): string | null {
  // Repassado por um hop INTERNO nosso (o proxy Next -> hdm-api pela rede privada). Naquele
  // salto nao existe borda entre os dois: o hdm-api ve o container, e a cadeia de proxy nao
  // diz nada sobre o visitante. Entao quem ja resolveu — o proxy, que RECEBEU a requisicao da
  // borda — passa o resultado adiante.
  //
  // `isTrustedHop` e o que impede isto de virar spoof: o header so vale quando quem o entregou
  // no SOCKET e infra nossa. De fora, o peer e publico e o header e ignorado.
  if (isTrustedHop(req)) {
    const fromInternalHop = normalizeIp(req?.headers?.[VISITOR_IP_HEADER] as string | undefined)
    if (fromInternalHop) return fromInternalHop
  }

  const anchor = resolveEdgeAnchor(req)
  if (!anchor) return null

  if (isCdnEdgeIp(anchor)) {
    const visitor = normalizeIp(req?.headers?.['cf-connecting-ip'] as string | undefined)
    // Sem o header (transform desligado, outro CDN) a ancora e o melhor que se sabe — e ela e
    // sincera: e o endereco da borda, nao um IP inventado.
    if (visitor) return visitor
  }

  return anchor
}

/**
 * A etapa 1 isolada: o IP que a cadeia de proxy revela, SEM desembrulhar CDN.
 *
 * Exportada porque o `/health/ip` mostra a ancora e o resultado final lado a lado — e a unica
 * forma de conferir, em producao, se a barreira esta funcionando.
 */
export function resolveEdgeAnchor(req: RequestLike | null | undefined): string | null {
  if (!req) return null

  // Header em que a borda da plataforma escreve, ela mesma, quem conectou — configuravel por
  // `EDGE_REAL_IP_HEADER` (ex.: `x-real-ip`).
  //
  // POR QUE ISTO EXISTE, e por que e opt-in: a varredura abaixo so acha o visitante se TODAS
  // as faixas da borda estiverem em `TRUSTED_PROXY_CIDRS`. Numa plataforma com dezenas de POPs
  // e faixas nao publicadas, essa lista e impossivel de manter — ela silenciosamente para de
  // cobrir quando um POP novo entra, e a ancora vira o endereco da propria plataforma (foi o
  // que fez `api.hdmfy.com` gravar Miami em todo lead).
  //
  // Quando a plataforma GARANTE o header, ele e exato e nao precisa de lista nenhuma. Medido
  // em 2026-08-20: mandar `X-Real-IP: 7.7.7.7` chega na aplicacao como o IP real de quem
  // chamou — a borda sobrescreve, nao da para forjar.
  //
  // O default vem embutido em `cdn-edge-ranges.ts`, junto da assuncao que ele carrega e de
  // como desliga-lo (`EDGE_REAL_IP_HEADER=` vazio). Config que quebra em silencio quando
  // esquecida nao pode ser obrigatoria — foi assim que 3.371 leads viraram "Newark, NJ".
  const trustedHeader = edgeRealIpHeader()
  if (trustedHeader) {
    const fromEdge = normalizeIp(req.headers?.[trustedHeader] as string | undefined)
    if (fromEdge) return fromEdge
  }

  const fromExpress = normalizeIp(req.ip)
  if (fromExpress && !isTrustedProxyIp(fromExpress)) return fromExpress

  const chain = forwardedChain(req.headers)
  for (let i = chain.length - 1; i >= 0; i--) {
    if (!isTrustedProxyIp(chain[i])) return chain[i]
  }

  const socketIp = normalizeIp(req.socket?.remoteAddress ?? req.connection?.remoteAddress)
  if (socketIp && !isTrustedProxyIp(socketIp)) return socketIp

  // Chegando aqui, todo mundo na cadeia e proxy nosso (tipico de chamada interna ou de
  // health check). O `req.ip`/socket cru ainda informa mais que `null`.
  return fromExpress ?? socketIp
}

/**
 * Igual ao `resolveClientIp`, mas devolve `''` no lugar de `null`.
 *
 * Existe porque varias colunas antigas (`Tracking.ip`, `Logs.ip_adress`) sao `String` com
 * `@default("")` e ja tem milhoes de linhas gravadas com string vazia — trocar por `null`
 * agora quebraria as consultas que comparam com `''`.
 */
export function resolveClientIpOrEmpty(req: RequestLike | null | undefined): string {
  return resolveClientIp(req) ?? ''
}
