/**
 * Faixas de borda de CDN e o header de IP real da plataforma — com valor EMBUTIDO.
 *
 * POR QUE EMBUTIDO, e nao so em env: sem esses dois valores a barreira nao fecha, e o modo de
 * falhar e SILENCIOSO — o lead e gravado com o endereco da borda em vez do IP de quem
 * preencheu o formulario, e ninguem descobre ate alguem olhar um relatorio de origem meses
 * depois. Foi exatamente assim que 3.371 leads da Maclo viraram "Newark, NJ".
 *
 * Config que, quando esquecida, quebra em silencio nao deve ser obrigatoria. O default correto
 * vem junto do codigo; a env continua existindo para o dia em que a borda mudar — trocar de CDN
 * ou de plataforma nao precisa de deploy, so de variavel.
 *
 * COMO ATUALIZAR as faixas (a Cloudflare as revisa de tempos em tempos):
 *
 *   curl -s https://www.cloudflare.com/ips-v4 > /tmp/cf.txt
 *   curl -s https://www.cloudflare.com/ips-v6 >> /tmp/cf.txt
 *   paste -sd, /tmp/cf.txt
 *
 * Enquanto o deploy nao acontece, o valor novo pode entrar por `CDN_EDGE_CIDRS` sem tocar aqui.
 */

/** cloudflare.com/ips-v4 + /ips-v6 — conferido em 2026-08-20 (15 IPv4 + 7 IPv6). */
const CLOUDFLARE_EDGE = [
  '173.245.48.0/20',
  '103.21.244.0/22',
  '103.22.200.0/22',
  '103.31.4.0/22',
  '141.101.64.0/18',
  '108.162.192.0/18',
  '190.93.240.0/20',
  '188.114.96.0/20',
  '197.234.240.0/22',
  '198.41.128.0/17',
  '162.158.0.0/15',
  '104.16.0.0/13',
  '104.24.0.0/14',
  '172.64.0.0/13',
  '131.0.72.0/22',
  '2400:cb00::/32',
  '2606:4700::/32',
  '2803:f800::/32',
  '2405:b500::/32',
  '2405:8100::/32',
  '2a06:98c0::/29',
  '2c0f:f248::/32',
]

/**
 * Faixas cujo `CF-Connecting-IP` pode ser lido.
 *
 * Estar nesta lista NAO da direito de pular hop na varredura do `X-Forwarded-For` — isso e
 * `TRUSTED_PROXY_CIDRS`, e continua vazio de proposito. Aqui a lista so decide se um header
 * pode ser CONSULTADO, o que e uma permissao bem menor: no pior caso (lista desatualizada,
 * faixa que deixou de ser da Cloudflare) le-se um header de um endereco que nao deveria, e o
 * valor ainda passa por `normalizeIp`. Nao ha caminho por onde isso conceda confianca de rede.
 *
 * `CDN_EDGE_CIDRS` SUBSTITUI a lista quando definida (nao soma). String vazia desliga a leitura
 * do `CF-Connecting-IP` por completo — e o jeito de voltar ao comportamento anterior.
 */
export function cdnEdgeCidrs(): string {
  const override = process.env.CDN_EDGE_CIDRS
  return override === undefined ? CLOUDFLARE_EDGE.join(',') : override
}

/**
 * Header em que a borda da plataforma escreve quem conectou nela.
 *
 * MEDIDO em producao em 2026-08-20: mandar `X-Real-IP: 7.7.7.7` chegou na aplicacao como o IP
 * real de quem chamou. A borda sobrescreve — nao da para forjar. Vale tambem para nginx,
 * Caddy e a maioria dos proxies reversos, que sempre reescrevem esse header.
 *
 * POR QUE ELE E NECESSARIO: a varredura direita->esquerda so alcanca o visitante se TODAS as
 * faixas da borda estiverem em `TRUSTED_PROXY_CIDRS`. Numa plataforma com POPs nao publicados
 * essa lista e impossivel de completar, e ela para de cobrir em SILENCIO quando um POP novo
 * entra — foi o que fez `api.hdmfy.com` gravar a borda de Miami em todo lead.
 *
 * A ASSUNCAO, explicita: confiar neste header e apostar que a borda o sobrescreve. Numa
 * plataforma que NAO sobrescreva, ele passa a ser texto livre do cliente. Se for esse o caso,
 * `EDGE_REAL_IP_HEADER=` (vazio) desliga e a varredura volta a ser a unica fonte. Conferir com
 * `GET /health/ip`: mandar o header na mao nao pode mudar o `resolvedIp`.
 */
export function edgeRealIpHeader(): string {
  const override = process.env.EDGE_REAL_IP_HEADER
  return (override === undefined ? 'x-real-ip' : override).trim().toLowerCase()
}
