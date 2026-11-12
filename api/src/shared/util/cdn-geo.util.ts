import { isCdnEdgeIp, resolveEdgeAnchor } from './client-ip.util'

/**
 * Geolocalizacao do visitante entregue pela PROPRIA borda de CDN, nos headers da requisicao.
 *
 * POR QUE ISTO EXISTE: geolocalizar IP e sempre estimativa — a base local acerta ~91% no
 * estado e ~48% no municipio exato, e nao ha base gratuita melhor. A Cloudflare, porem, ja
 * resolveu isso do lado dela e manda o resultado de graca no header, se o managed transform
 * "Add visitor location headers" estiver ligado na zona (nao e restrito por plano). E a
 * geolocalizacao dela, sobre o IP que ela mesma viu — melhor que qualquer coisa que a gente
 * derive depois, e sem lookup nenhum.
 *
 * SUJEITO A MESMA BARREIRA DO IP: a borda da plataforma repassa esses headers intactos, entao
 * qualquer um que fale direto com a origem escreve o que quiser neles. So sao lidos quando a
 * ancora (`resolveEdgeAnchor`, que a borda sobrescreve e ninguem forja) prova que a requisicao
 * passou mesmo por uma borda de CDN nossa.
 *
 * Headers, quando o transform esta ligado:
 *   cf-ipcity  cf-region  cf-region-code  cf-ipcountry  cf-ipcontinent
 *   cf-iplatitude  cf-iplongitude  cf-postal-code  cf-timezone  cf-metro-code
 */
export interface CdnGeo {
  city: string | null
  /** Sigla do estado (`cf-region-code`) — e o que `Leads.state` guarda. */
  region: string | null
  /** Nome por extenso do estado (`cf-region`). */
  regionName: string | null
  countryCode: string | null
  continentCode: string | null
  lat: number | null
  lon: number | null
  postalCode: string | null
  timezone: string | null
}

interface RequestLike {
  ip?: string
  headers?: Record<string, unknown>
  socket?: { remoteAddress?: string }
  connection?: { remoteAddress?: string }
}

function texto(headers: Record<string, unknown> | undefined, nome: string): string | null {
  const v = headers?.[nome]
  if (typeof v !== 'string') return null
  const t = v.trim()
  // A Cloudflare manda `XX` em `cf-ipcountry` quando nao sabe, e `T1` para trafego Tor.
  if (!t || t === 'XX' || t === 'T1') return null
  return t
}

function numero(headers: Record<string, unknown> | undefined, nome: string): number | null {
  const t = texto(headers, nome)
  if (t === null) return null
  const n = Number(t)
  // `Number.isFinite` e nao `!!n`: latitude 0 e o Equador, nao "sem dado".
  return Number.isFinite(n) ? n : null
}

/**
 * Devolve a geolocalizacao que a borda informou, ou `null` quando nao ha borda de CDN
 * comprovada ou quando o transform nao esta ligado.
 *
 * Nunca lanca: geolocalizacao e enfeite, e nada aqui pode derrubar a captura de lead.
 */
export function resolveCdnGeo(req: RequestLike | null | undefined): CdnGeo | null {
  try {
    if (!req) return null

    const anchor = resolveEdgeAnchor(req)
    if (!isCdnEdgeIp(anchor)) return null

    const h = req.headers
    const geo: CdnGeo = {
      city: texto(h, 'cf-ipcity'),
      region: texto(h, 'cf-region-code'),
      regionName: texto(h, 'cf-region'),
      countryCode: texto(h, 'cf-ipcountry'),
      continentCode: texto(h, 'cf-ipcontinent'),
      lat: numero(h, 'cf-iplatitude'),
      lon: numero(h, 'cf-iplongitude'),
      postalCode: texto(h, 'cf-postal-code'),
      timezone: texto(h, 'cf-timezone'),
    }

    // Sem cidade nem estado nao ha o que aproveitar — o transform deve estar desligado.
    return geo.city || geo.region ? geo : null
  } catch {
    return null
  }
}
