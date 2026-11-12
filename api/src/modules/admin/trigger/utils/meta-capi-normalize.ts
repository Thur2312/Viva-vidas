/**
 * Normalização dos campos de `user_data` no formato exigido pela Meta CAPI.
 *
 * Referência: Conversions API → Customer Information Parameters.
 * A Meta hasheia o valor do lado dela com as MESMAS regras e compara os digests;
 * qualquer divergência de formato (acento, espaço, caixa, UF por extenso) produz
 * um hash que simplesmente não casa com ninguém. O evento é aceito, entra na
 * contagem, e não atribui — falha silenciosa que só aparece como EMQ baixo.
 */

const DIACRITICS = /[̀-ͯ]/g

export function removeAccents(value: string): string {
  return value.normalize('NFD').replace(DIACRITICS, '')
}

/** Trim + lowercase. Base de e-mail e da maioria dos campos textuais. */
export function normalizeBase(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null
  const out = String(value).trim().toLowerCase()
  return out || null
}

/** Nome: lowercase, sem acento, sem pontuação. Descarta e-mail usado como nome. */
export function normalizeName(value: unknown): string | null {
  const base = normalizeBase(value)
  if (!base) return null
  if (base.includes('@')) return null
  const out = removeAccents(base).replace(/[^a-z\s'-]/g, '').trim()
  return out || null
}

/** Cidade: lowercase, sem acento, sem espaço nem pontuação ("São Paulo" → "saopaulo"). */
export function normalizeCity(value: unknown): string | null {
  const base = normalizeBase(value)
  if (!base) return null
  const out = removeAccents(base).replace(/[^a-z0-9]/g, '')
  return out || null
}

/**
 * UFs brasileiras por nome completo → sigla.
 *
 * Sem isso o código truncava o nome nos 2 primeiros caracteres, o que produz
 * siglas erradas para 20 das 27 UFs: "são paulo" → "sa" (correto: "sp"),
 * "minas gerais" → "mi" (mg), "rio de janeiro" → "ri" (rj).
 */
const BR_STATES: Record<string, string> = {
  acre: 'ac',
  alagoas: 'al',
  amapa: 'ap',
  amazonas: 'am',
  bahia: 'ba',
  ceara: 'ce',
  'distrito federal': 'df',
  'espirito santo': 'es',
  goias: 'go',
  maranhao: 'ma',
  'mato grosso': 'mt',
  'mato grosso do sul': 'ms',
  'minas gerais': 'mg',
  para: 'pa',
  paraiba: 'pb',
  parana: 'pr',
  pernambuco: 'pe',
  piaui: 'pi',
  'rio de janeiro': 'rj',
  'rio grande do norte': 'rn',
  'rio grande do sul': 'rs',
  rondonia: 'ro',
  roraima: 'rr',
  'santa catarina': 'sc',
  'sao paulo': 'sp',
  sergipe: 'se',
  tocantins: 'to',
}

/**
 * Estado → código de 2 letras minúsculo (Meta pede a abreviação ANSI/UF).
 * Aceita a sigla já pronta (inclusive de outros países); resolve o nome por
 * extenso via tabela; para valores desconhecidos devolve null em vez de um
 * palpite truncado — hash errado atrapalha o match mais do que campo ausente.
 */
export function normalizeState(value: unknown): string | null {
  const base = normalizeBase(value)
  if (!base) return null

  const clean = removeAccents(base).replace(/[^a-z\s]/g, '').replace(/\s+/g, ' ').trim()

  if (clean.length === 2) return clean
  return BR_STATES[clean] ?? null
}

/** Mapeia nomes de país usuais para ISO-3166-1 alpha-2. */
const COUNTRY_ALIASES: Record<string, string> = {
  brasil: 'br',
  brazil: 'br',
  'republica federativa do brasil': 'br',
  portugal: 'pt',
  argentina: 'ar',
  'estados unidos': 'us',
  'united states': 'us',
  usa: 'us',
  eua: 'us',
}

/** País → ISO-3166-1 alpha-2 minúsculo. Meta rejeita o match com nome por extenso. */
export function normalizeCountry(value: unknown): string | null {
  const base = normalizeBase(value)
  if (!base) return null

  const clean = removeAccents(base).replace(/\s+/g, ' ').trim()
  if (clean.length === 2) return clean
  return COUNTRY_ALIASES[clean] ?? null
}

/** CEP/zip: só dígitos. */
export function normalizeZip(value: unknown): string | null {
  if (value === null || value === undefined) return null
  const digits = String(value).replace(/\D/g, '')
  return digits || null
}

/** Gênero → 'f' | 'm'. Qualquer outra coisa vira null. */
export function normalizeGender(value: unknown): string | null {
  const base = normalizeBase(value)
  if (!base) return null
  const initial = removeAccents(base)[0]
  if (initial === 'f') return 'f'
  if (initial === 'm') return 'm'
  return null
}

/**
 * Data de nascimento em YYYYMMDD, com ano REAL.
 *
 * A Meta exige ano entre 1900 e o ano corrente. O código antigo montava
 * `0000${mes}${dia}` quando só tinha dia e mês — `0000` é inválido, então aquele
 * hash nunca casaria com usuário nenhum. Sem ano, o certo é não mandar `db` e
 * deixar só os derivados `dobm`/`dobd`, que são válidos por si.
 */
export function normalizeDateOfBirth(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null

  const fromDate = (date: Date): [number, number, number] | null =>
    Number.isNaN(date.getTime())
      ? null
      : [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()]

  let parts: [number, number, number] | null = null

  if (value instanceof Date) {
    parts = fromDate(value)
  } else {
    const raw = String(value).trim()
    const compact = raw.match(/^(\d{4})(\d{2})(\d{2})$/)
    const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/)
    const br = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)

    if (compact) parts = [+compact[1], +compact[2], +compact[3]]
    else if (iso) parts = [+iso[1], +iso[2], +iso[3]]
    else if (br) parts = [+br[3], +br[2], +br[1]]
    else parts = fromDate(new Date(raw))
  }

  if (!parts) return null
  const [year, month, day] = parts

  const currentYear = new Date().getUTCFullYear()
  if (year < 1900 || year > currentYear) return null
  if (month < 1 || month > 12) return null
  if (day < 1 || day > 31) return null

  return `${year}${String(month).padStart(2, '0')}${String(day).padStart(2, '0')}`
}

const PT_MONTHS: Record<string, number> = {
  janeiro: 1, fevereiro: 2, marco: 3, abril: 4, maio: 5, junho: 6,
  julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12,
}

/** Mês vindo como número ou como nome em português ("Maio" → 5). */
export function parseMonth(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null

  const raw = String(value).trim()
  if (/^\d+$/.test(raw)) {
    const num = Number(raw)
    return num >= 1 && num <= 12 ? num : null
  }

  const name = removeAccents(raw.toLowerCase())
  return PT_MONTHS[name] ?? null
}

/**
 * Dia+mês de nascimento como "MMDD", quando não se conhece o ano.
 *
 * Os contatos guardam `birthDay`/`birthMonth` sem ano (e `birthMonth` pode vir
 * como nome: "Maio"). Isso não serve pra `db` — que exige YYYYMMDD com ano real —
 * mas serve pros derivados `dobm`/`dobd`, que a Meta aceita isolados.
 */
export function normalizeBirthMonthDay(month: unknown, day: unknown): string | null {
  const parsedMonth = parseMonth(month)
  if (!parsedMonth) return null

  const parsedDay = Number(String(day ?? '').trim())
  if (!Number.isInteger(parsedDay) || parsedDay < 1 || parsedDay > 31) return null

  return `${String(parsedMonth).padStart(2, '0')}${String(parsedDay).padStart(2, '0')}`
}

/**
 * `action_source`: onde a conversão realmente aconteceu.
 *
 * Era `'website'` fixo para tudo. Movimentação de card no Kanban não é ação de
 * site — é mudança de estado no CRM, que a Meta classifica como
 * `system_generated`.
 *
 * Declarar `website` cobra um preço: a Meta exige TRÊS parâmetros no evento de
 * site — `action_source`, `event_source_url` e `client_user_agent` ("The
 * client_user_agent is required for website events shared using the Conversions
 * API"). Lead importado em lote ou criado na mão não tem user agent, mas herda a
 * `liveUrl` da campanha; sem exigir os dois, esse evento saía rotulado como site
 * faltando um obrigatório, e o custo aparecia só depois, como EMQ menor.
 * `system_generated` é a classificação honesta nesse caso — e a doc lembra que
 * "you agree that the action_source parameter is accurate to the best of your
 * knowledge".
 *
 * Valores válidos: email, website, app, phone_call, chat, physical_store,
 * system_generated, business_messaging, other.
 */
export function resolveActionSource(event: {
  eventType?: string | null
  eventSourceUrl?: string | null
  clientUserAgent?: string | null
}): 'website' | 'system_generated' {
  const eventType = String(event?.eventType ?? '').toUpperCase()

  // Mudança de estágio/coluna nasce no CRM, nunca no navegador do lead.
  if (eventType === 'MOVED' || eventType === 'STAGE_CHANGED' || eventType === 'UPDATED') {
    return 'system_generated'
  }

  return event?.eventSourceUrl && event?.clientUserAgent ? 'website' : 'system_generated'
}

// ============================================================================
// event_name — o nome do evento que aparece no Gerenciador de Eventos do cliente
// ============================================================================

/**
 * Teto da Meta: "Custom event names must be strings, and cannot exceed 50
 * characters in length."
 */
export const META_EVENT_NAME_MAX_LENGTH = 50

/** Alfabeto aceito pela Meta em nome de evento. Todo o resto vira `_`. */
const EVENT_NAME_INVALID = /[^A-Za-z0-9_]+/g

/**
 * Nome de evento no alfabeto que a Meta aceita.
 *
 * A doc é explícita: "Use only letters, numbers, or underscores in event and
 * parameter names. Avoid special characters (e.g. ?!@$), as the use of other
 * characters could result in your event not being processed by Meta."
 *
 * Isto importa porque `Tracking.action` é string livre sem validação nenhuma —
 * existem valores em produção como `devzap:entrou`, e os dois-pontos podem
 * fazer a Meta descartar o evento sem avisar.
 *
 * NÃO faz lowercase: `Purchase` e `Lead` são eventos padrão e a Meta os
 * reconhece pela caixa exata. Trocar para `purchase` criaria um evento
 * personalizado com outro nome.
 */
export function sanitizeEventName(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null

  const out = removeAccents(String(value).trim())
    .replace(EVENT_NAME_INVALID, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^_+|_+$/g, '')

  if (!out) return null

  // Acima de 50 a Meta rejeita o evento inteiro. Cortar entrega algo; não
  // cortar não entrega nada. Quem chama compara entrada e saída para logar.
  return out.slice(0, META_EVENT_NAME_MAX_LENGTH)
}

/**
 * Número digitado pelo usuário no catálogo de ações → `custom_data.value`.
 *
 * É o peso que ensina o algoritmo da Meta qual etapa vale mais: ela lê `value`
 * junto de `currency` como quantia, e é esse par que alimenta value-based
 * bidding. Um tracking de "assistiu 17%" não tem preço nenhum, então este é o
 * único jeito de dar sinal de intensidade a esse evento.
 *
 * Aceita vírgula decimal porque o campo é digitado por brasileiro. Recusa
 * negativo: a doc exige que o valor "represent a monetary amount", e conversão
 * de valor negativo não existe — passar isso adiante envenenaria a otimização
 * da campanha sem erro nenhum aparecendo.
 */
export function normalizeEventValue(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null

  let parsed: number
  if (typeof raw === 'number') {
    parsed = raw
  } else {
    // `Number('')` e `Number('   ')` devolvem 0, não NaN. Sem este corte, campo
    // em branco viraria `value: 0` — que a Meta aceita como conversão de valor
    // zero, e não é a mesma coisa que não mandar valor.
    const text = String(raw).trim().replace(',', '.')
    if (text === '') return null
    parsed = Number(text)
  }

  if (!Number.isFinite(parsed) || parsed < 0) return null
  return parsed
}
