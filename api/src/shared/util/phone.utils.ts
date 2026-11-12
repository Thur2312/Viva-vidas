/**
 * Utilitários centralizados para manipulação de números de telefone
 * Suporte a prefixos internacionais (DDI) + regras META/WhatsApp para 9º dígito brasileiro
 *
 * Regra do 9º dígito (Anatel — Resolução nº 553/2010):
 * - TODOS os DDDs do Brasil possuem o 9º dígito desde novembro de 2016
 * - Celulares: 9 dígitos (começam com 9) — ex: 9XXXX-XXXX
 * - Fixos: 8 dígitos (começam com 2-5) — sem alteração
 *
 * Detecção de DDI internacional:
 * - Input com "+" → detecta DDI da lista de códigos ITU-T E.164
 * - Sem "+" e 10-11 dígitos → assume brasileiro (retrocompatibilidade)
 * - Sem "+" e 12+ dígitos começando com 55 → valida estrutura BR (se inválida, tenta internacional)
 * - Sem "+" e 12+ dígitos sem 55 → tenta detectar DDI internacional
 *
 * Padrão E.164:
 * - Máximo 15 dígitos no TOTAL (DDI + número nacional)
 * - DDI de 1 a 3 dígitos
 * - Número nacional de até 12 dígitos (máx 15 - tamanho do DDI)
 *
 * Referência: ITU-T E.164 (11/2010) — lista atualizada em 2024/2025
 * Fonte: https://en.wikipedia.org/wiki/List_of_country_calling_codes
 */

/** DDI padrão Brasil */
export const BRAZIL_COUNTRY_CODE = '55'

/**
 * @deprecated Desde 2016 todos os DDDs têm 9º dígito (Anatel Resolução 553/2010).
 * Mantido apenas para compatibilidade de imports. dddRequiresNinthDigit() sempre retorna true.
 */
export const DDD_WITH_NINTH_DIGIT = { min: 11, max: 99 }
export const DDD_WITHOUT_NINTH_DIGIT = { min: 0, max: 0 }

/**
 * Mapa completo de códigos de país ITU-T E.164 → Nome do país/território
 * Inclui códigos geográficos e serviços internacionais relevantes
 *
 * Atualizado conforme ITU-T E.164 (posição em 2025)
 *
 * Zonas ITU-T:
 * - Zona 1: América do Norte (NANP)
 * - Zona 2: África (maioria)
 * - Zona 3-4: Europa
 * - Zona 5: América do Sul / Central / México
 * - Zona 6: Sudeste Asiático / Oceania
 * - Zona 7: Rússia / Cazaquistão (ex-URSS)
 * - Zona 8: Leste Asiático / Serviços especiais
 * - Zona 9: Oriente Médio / Ásia Central / Sul da Ásia
 */
export const COUNTRY_CALLING_CODES_MAP: Record<string, string> = {
  // ══════════════════════════════════════════════════════════════
  // ZONA 1 — América do Norte (NANP)
  // ══════════════════════════════════════════════════════════════
  '1': 'Estados Unidos / Canadá / Caribe (NANP)',

  // ══════════════════════════════════════════════════════════════
  // ZONA 2 — África e alguns territórios
  // ══════════════════════════════════════════════════════════════
  '20': 'Egito',
  '211': 'Sudão do Sul',
  '212': 'Marrocos',
  '213': 'Argélia',
  '216': 'Tunísia',
  '218': 'Líbia',
  '220': 'Gâmbia',
  '221': 'Senegal',
  '222': 'Mauritânia',
  '223': 'Mali',
  '224': 'Guiné',
  '225': 'Costa do Marfim',
  '226': 'Burkina Faso',
  '227': 'Níger',
  '228': 'Togo',
  '229': 'Benin',
  '230': 'Maurício',
  '231': 'Libéria',
  '232': 'Serra Leoa',
  '233': 'Gana',
  '234': 'Nigéria',
  '235': 'Chade',
  '236': 'República Centro-Africana',
  '237': 'Camarões',
  '238': 'Cabo Verde',
  '239': 'São Tomé e Príncipe',
  '240': 'Guiné Equatorial',
  '241': 'Gabão',
  '242': 'República do Congo',
  '243': 'República Democrática do Congo',
  '244': 'Angola',
  '245': 'Guiné-Bissau',
  '246': 'Território Britânico do Oceano Índico (Diego Garcia)',
  '247': 'Ilha de Ascensão',
  '248': 'Seicheles',
  '249': 'Sudão',
  '250': 'Ruanda',
  '251': 'Etiópia',
  '252': 'Somália',
  '253': 'Djibuti',
  '254': 'Quênia',
  '255': 'Tanzânia',
  '256': 'Uganda',
  '257': 'Burundi',
  '258': 'Moçambique',
  '260': 'Zâmbia',
  '261': 'Madagascar',
  '262': 'Reunião / Maiote',
  '263': 'Zimbábue',
  '264': 'Namíbia',
  '265': 'Malaui',
  '266': 'Lesoto',
  '267': 'Botsuana',
  '268': 'Essuatíni (Suazilândia)',
  '269': 'Comores',
  '27': 'África do Sul',
  '290': 'Santa Helena',
  '291': 'Eritreia',
  '297': 'Aruba',
  '298': 'Ilhas Faroé',
  '299': 'Groenlândia',

  // ══════════════════════════════════════════════════════════════
  // ZONA 3-4 — Europa
  // ══════════════════════════════════════════════════════════════
  '30': 'Grécia',
  '31': 'Países Baixos',
  '32': 'Bélgica',
  '33': 'França',
  '34': 'Espanha',
  '350': 'Gibraltar',
  '351': 'Portugal',
  '352': 'Luxemburgo',
  '353': 'Irlanda',
  '354': 'Islândia',
  '355': 'Albânia',
  '356': 'Malta',
  '357': 'Chipre',
  '358': 'Finlândia',
  '359': 'Bulgária',
  '36': 'Hungria',
  '370': 'Lituânia',
  '371': 'Letônia',
  '372': 'Estônia',
  '373': 'Moldávia',
  '374': 'Armênia',
  '375': 'Bielorrússia',
  '376': 'Andorra',
  '377': 'Mônaco',
  '378': 'San Marino',
  '379': 'Cidade do Vaticano',
  '380': 'Ucrânia',
  '381': 'Sérvia',
  '382': 'Montenegro',
  '383': 'Kosovo',
  '385': 'Croácia',
  '386': 'Eslovênia',
  '387': 'Bósnia e Herzegovina',
  '389': 'Macedônia do Norte',
  '39': 'Itália',
  '40': 'Romênia',
  '41': 'Suíça',
  '420': 'República Tcheca',
  '421': 'Eslováquia',
  '423': 'Liechtenstein',
  '43': 'Áustria',
  '44': 'Reino Unido',
  '45': 'Dinamarca',
  '46': 'Suécia',
  '47': 'Noruega',
  '48': 'Polônia',
  '49': 'Alemanha',

  // ══════════════════════════════════════════════════════════════
  // ZONA 5 — Américas (Central, Sul, Caribe)
  // ══════════════════════════════════════════════════════════════
  '500': 'Ilhas Malvinas (Falkland)',
  '501': 'Belize',
  '502': 'Guatemala',
  '503': 'El Salvador',
  '504': 'Honduras',
  '505': 'Nicarágua',
  '506': 'Costa Rica',
  '507': 'Panamá',
  '508': 'Saint-Pierre e Miquelon',
  '509': 'Haiti',
  '51': 'Peru',
  '52': 'México',
  '53': 'Cuba',
  '54': 'Argentina',
  '55': 'Brasil',
  '56': 'Chile',
  '57': 'Colômbia',
  '58': 'Venezuela',
  '590': 'Guadalupe / São Bartolomeu / São Martinho (FR)',
  '591': 'Bolívia',
  '592': 'Guiana',
  '593': 'Equador',
  '594': 'Guiana Francesa',
  '595': 'Paraguai',
  '596': 'Martinica',
  '597': 'Suriname',
  '598': 'Uruguai',
  '599': 'Curaçao / Bonaire / Saba / Santo Eustáquio',

  // ══════════════════════════════════════════════════════════════
  // ZONA 6 — Sudeste Asiático / Oceania
  // ══════════════════════════════════════════════════════════════
  '60': 'Malásia',
  '61': 'Austrália',
  '62': 'Indonésia',
  '63': 'Filipinas',
  '64': 'Nova Zelândia',
  '65': 'Singapura',
  '66': 'Tailândia',
  '670': 'Timor-Leste',
  '672': 'Territórios Externos da Austrália (Norfolk, Antártica)',
  '673': 'Brunei',
  '674': 'Nauru',
  '675': 'Papua-Nova Guiné',
  '676': 'Tonga',
  '677': 'Ilhas Salomão',
  '678': 'Vanuatu',
  '679': 'Fiji',
  '680': 'Palau',
  '681': 'Wallis e Futuna',
  '682': 'Ilhas Cook',
  '683': 'Niue',
  '685': 'Samoa',
  '686': 'Kiribati',
  '687': 'Nova Caledônia',
  '688': 'Tuvalu',
  '689': 'Polinésia Francesa',
  '690': 'Tokelau',
  '691': 'Micronésia',
  '692': 'Ilhas Marshall',

  // ══════════════════════════════════════════════════════════════
  // ZONA 7 — Rússia / Cazaquistão
  // ══════════════════════════════════════════════════════════════
  '7': 'Rússia / Cazaquistão',

  // ══════════════════════════════════════════════════════════════
  // ZONA 8 — Leste Asiático / Serviços Internacionais
  // ══════════════════════════════════════════════════════════════
  '800': 'Serviço Internacional de Ligação Gratuita (UIFN)',
  '808': 'Serviço Internacional de Custo Compartilhado',
  '81': 'Japão',
  '82': 'Coreia do Sul',
  '84': 'Vietnã',
  '850': 'Coreia do Norte',
  '852': 'Hong Kong',
  '853': 'Macau',
  '855': 'Camboja',
  '856': 'Laos',
  '86': 'China',
  '870': 'Inmarsat (GMSS)',
  '880': 'Bangladesh',
  '881': 'Sistema Global de Satélite Móvel (GMSS)',
  '882': 'Redes Internacionais',
  '883': 'Redes Internacionais',
  '886': 'Taiwan',

  // ══════════════════════════════════════════════════════════════
  // ZONA 9 — Oriente Médio / Ásia Central / Sul da Ásia
  // ══════════════════════════════════════════════════════════════
  '90': 'Turquia',
  '91': 'Índia',
  '92': 'Paquistão',
  '93': 'Afeganistão',
  '94': 'Sri Lanka',
  '95': 'Mianmar',
  '960': 'Maldivas',
  '961': 'Líbano',
  '962': 'Jordânia',
  '963': 'Síria',
  '964': 'Iraque',
  '965': 'Kuwait',
  '966': 'Arábia Saudita',
  '967': 'Iêmen',
  '968': 'Omã',
  '970': 'Palestina',
  '971': 'Emirados Árabes Unidos',
  '972': 'Israel',
  '973': 'Bahrein',
  '974': 'Catar',
  '975': 'Butão',
  '976': 'Mongólia',
  '977': 'Nepal',
  '979': 'Serviço Internacional de Tarifa Premium (UIPRS)',
  '992': 'Tajiquistão',
  '993': 'Turcomenistão',
  '994': 'Azerbaijão',
  '995': 'Geórgia',
  '996': 'Quirguistão',
  '998': 'Uzbequistão',
}

/**
 * Set otimizado para lookup rápido de DDIs (gerado a partir do mapa)
 * Usado internamente por matchDDI() para detecção O(1)
 */
export const COUNTRY_CALLING_CODES: Set<string> = new Set(
  Object.keys(COUNTRY_CALLING_CODES_MAP)
)

// ══════════════════════════════════════════════════════════════
// FUNÇÕES DE LIMPEZA
// ══════════════════════════════════════════════════════════════

/**
 * Remove todos os caracteres não numéricos de um telefone
 * @param phone - Telefone em qualquer formato
 * @returns Apenas os dígitos do telefone
 *
 * @example
 * cleanPhone('(11) 91234-5678') // '11912345678'
 * cleanPhone('+55 11 91234-5678') // '5511912345678'
 */
export function cleanPhone(phone: string | number | null | undefined): string {
  if (!phone) return ''
  return String(phone).replace(/\D/g, '')
}

/**
 * Limpa telefone preservando a informação do prefixo +
 * @param phone - Telefone em qualquer formato
 * @returns Objeto com flag hasPlus e apenas dígitos
 */
export function cleanPhoneWithMeta(phone: string | number | null | undefined): {
  hasPlus: boolean
  digits: string
} {
  if (!phone) return { hasPlus: false, digits: '' }
  const str = String(phone)
  const hasPlus = str.includes('+')
  const digits = str.replace(/\D/g, '')
  return { hasPlus, digits }
}

// ══════════════════════════════════════════════════════════════
// DETECÇÃO DE DDI
// ══════════════════════════════════════════════════════════════

/**
 * Tenta match guloso (3 → 2 → 1 dígitos) contra a lista de DDIs
 *
 * IMPORTANTE sobre ambiguidade:
 * O match guloso (3 dígitos primeiro) funciona porque o plano E.164
 * garante que se um código de 2 dígitos existe (ex: "20" Egito),
 * nenhum código de 3 dígitos começa com "20x" EXCETO os que estão
 * explicitamente atribuídos (ex: "211" Sudão do Sul).
 * Porém, o DDI "1" (NANP) é especial: não existem DDIs "1x" ou "1xx"
 * na lista ITU-T, então qualquer número começando com 1 após o + será
 * corretamente identificado como NANP.
 *
 * @param digits - Apenas dígitos do telefone (sem +)
 * @returns DDI encontrado e resto do número, ou null
 */
export function matchDDI(digits: string): { ddi: string; rest: string } | null {
  // Tenta 3 dígitos primeiro (mais específico)
  if (digits.length >= 3) {
    const code3 = digits.substring(0, 3)
    if (COUNTRY_CALLING_CODES.has(code3)) {
      return { ddi: code3, rest: digits.substring(3) }
    }
  }
  // Tenta 2 dígitos
  if (digits.length >= 2) {
    const code2 = digits.substring(0, 2)
    if (COUNTRY_CALLING_CODES.has(code2)) {
      return { ddi: code2, rest: digits.substring(2) }
    }
  }
  // Tenta 1 dígito
  if (digits.length >= 1) {
    const code1 = digits.substring(0, 1)
    if (COUNTRY_CALLING_CODES.has(code1)) {
      return { ddi: code1, rest: digits.substring(1) }
    }
  }
  return null
}

/**
 * Normaliza números NANP (DDI 1 — EUA/Canadá/Caribe)
 * Números NANP nacionais têm SEMPRE 10 dígitos e area codes vão de 2XX a 9XX.
 * Se o número nacional tem 11 dígitos e começa com "1", o "1" é duplicata do DDI.
 * Isso acontece quando webhooks enviam DDI "11" em vez de "1".
 *
 * @param ddi - DDI detectado
 * @param nationalNumber - Número nacional após remoção do DDI
 * @returns Número nacional corrigido
 *
 * @example
 * normalizeNANP('1', '14074668628') // '4074668628' (remove "1" duplicado)
 * normalizeNANP('1', '4074668628')  // '4074668628' (já correto)
 * normalizeNANP('55', '11912345678') // '11912345678' (não é NANP, ignora)
 */
export function normalizeNANP(ddi: string, nationalNumber: string): string {
  if (ddi === '1' && nationalNumber.length === 11 && nationalNumber.startsWith('1')) {
    return nationalNumber.substring(1)
  }
  return nationalNumber
}

/**
 * O número nacional é plausível para este DDI?
 *
 * Usado SÓ nas inferências sem "+" (o DDI foi adivinhado, não declarado). Sem esta
 * checagem, `matchDDI` aceitava qualquer resto com ≥4 dígitos e um número BR malformado
 * virava um número estrangeiro plausível: "551196160768801" (15 díg, o telefone quebrado
 * do form) era lido como +1 (EUA) com 12 dígitos nacionais e passava por VÁLIDO —
 * enquanto "+551196160768801" (mesmo número) era corretamente inválido.
 *
 * - NANP (+1, EUA/Canadá): o número nacional tem SEMPRE 10 dígitos.
 * - Demais países: ITU-T E.164 → DDI + nacional ≤ 15 dígitos, nacional ≥ 4.
 *
 * Sem "+" também NÃO se aplica o resgate do trunk duplicado do NANP (normalizeNANP):
 * "119951008003" é um celular BR com um dígito a mais, não um "+1 1 995 100 8003".
 * Descartar o 1 extra aqui faria um BR digitado errado passar por americano válido.
 * Com "+" (DDI declarado) o resgate continua valendo.
 */
function isPlausibleNationalNumber(ddi: string, nationalNumber: string): boolean {
  if (ddi === '1') return nationalNumber.length === 10
  return nationalNumber.length >= 4 && ddi.length + nationalNumber.length <= 15
}

/**
 * Algoritmo principal de detecção de DDI internacional
 *
 * Estratégia:
 * 0. Se countryIso informado e não é BR → força detecção internacional (adiciona + implícito)
 * 1. Input com "+" → detecta DDI da lista ITU-T
 * 2. Começa com 55 e tem 12+ dígitos → valida estrutura brasileira
 * 3. 10-11 dígitos → assume brasileiro (retrocompatibilidade)
 * 4. Não começa com 55 e tem 12+ dígitos → tenta DDI internacional
 * 5. Default → assume brasileiro
 *
 * LIMITAÇÃO CONHECIDA (Rule 3):
 * Números internacionais de exatamente 10-11 dígitos sem "+" serão tratados
 * como brasileiros. Ex: +354XXXXXXX (Islândia, 10 dígitos total) sem "+"
 * será interpretado como DDD 35 + número. Use sempre "+" ou countryIso
 * para números internacionais.
 *
 * @param phone - Telefone em qualquer formato
 * @param countryIso - ISO do país de origem (ex: 'BR', 'MX', 'ES'). Quando informado e não é 'BR',
 *                     força detecção de DDI internacional mesmo sem prefixo '+'.
 *                     Útil para webhooks que não enviam '+' no telefone.
 * @returns DDI, número nacional e flag se é brasileiro
 *
 * @example
 * detectDDI('+14155551234')     // { ddi: '1', nationalNumber: '4155551234', isBrazilian: false }
 * detectDDI('+5511912345678')   // { ddi: '55', nationalNumber: '11912345678', isBrazilian: true }
 * detectDDI('11912345678')      // { ddi: '55', nationalNumber: '11912345678', isBrazilian: true }
 * detectDDI('34685899063', 'ES') // { ddi: '34', nationalNumber: '685899063', isBrazilian: false }
 */
export function detectDDI(
  phone: string | number | null | undefined,
  countryIso?: string,
): {
  ddi: string
  nationalNumber: string
  isBrazilian: boolean
} {
  if (!phone) return { ddi: '', nationalNumber: '', isBrazilian: true }

  const { hasPlus, digits } = cleanPhoneWithMeta(phone)
  if (!digits) return { ddi: '', nationalNumber: '', isBrazilian: true }

  // Rule 0: Se countryIso informado e não é BR, força detecção internacional
  // Webhooks como Hotmart enviam telefone sem "+" mas informam o país
  const forceInternational = countryIso && countryIso.toUpperCase() !== 'BR'

  // Rule 1: Has + ou forceInternational → detecta DDI da lista ITU-T
  if (hasPlus || forceInternational) {
    const match = matchDDI(digits)
    if (match) {
      return {
        ddi: match.ddi,
        nationalNumber: normalizeNANP(match.ddi, match.rest),
        isBrazilian: match.ddi === '55',
      }
    }
  }

  // Rule 2: Starts with 55 and has 12+ digits → valida estrutura brasileira
  // Regras Anatel:
  // - DDD válido: 11-99
  // - Fixo: 8 dígitos (começa com 2-5)
  // - Celular DDDs 11-28: 9 dígitos (começa com 9) — regra META
  // - Celular DDDs 29-99: 8 dígitos (sem 9o dígito) — regra META
  // - DDDs 29-99 com 9 dígitos começando com 9: aceita (alguns sistemas adicionam 9o dígito)
  // Se a estrutura NÃO bate → tenta como internacional (55 era prefixo espúrio)
  if (digits.startsWith('55') && digits.length >= 12) {
    const dd = digits.substring(2, 4)
    const ddNum = parseInt(dd, 10)
    const nationalNumber = digits.substring(4)

    // Valida se a estrutura é compatível com número brasileiro
    const isValidBrazilianStructure =
      ddNum >= 11 &&
      ddNum <= 99 &&
      (// 8 dígitos: fixo ou celular sem 9o dígito (válido para todos os DDDs)
      nationalNumber.length === 8 ||
        // 9 dígitos começando com 9: celular com 9o dígito (DDDs 11-28 obrigatório, 29-99 tolerado)
        (nationalNumber.length === 9 && nationalNumber.startsWith('9')))

    if (isValidBrazilianStructure) {
      return { ddi: '55', nationalNumber: digits.substring(2), isBrazilian: true }
    }

    // Estrutura inválida para BR → tenta detectar como internacional (remove 55 espúrio).
    // Só aceita se o número nacional resultante for plausível para o DDI adivinhado —
    // senão um BR malformado (ex.: 15 dígitos) viraria um "+1" com 12 dígitos nacionais.
    const withoutPrefix = digits.substring(2)
    const match = matchDDI(withoutPrefix)
    if (match && isPlausibleNationalNumber(match.ddi, match.rest)) {
      return {
        ddi: match.ddi,
        nationalNumber: match.rest,
        isBrazilian: match.ddi === '55',
      }
    }

    // Fallback: assume brasileiro mesmo assim (número pode estar malformado)
    return { ddi: '55', nationalNumber: digits.substring(2), isBrazilian: true }
  }

  // Rule 3: 10-11 digits → valida estrutura BR, senão tenta internacional
  if (digits.length >= 10 && digits.length <= 11) {
    const dd = digits.substring(0, 2)
    const ddNum = parseInt(dd, 10)
    const localNumber = digits.substring(2)

    const isValidBR =
      ddNum >= 11 &&
      ddNum <= 99 &&
      (localNumber.length === 8 ||
        (localNumber.length === 9 && localNumber.startsWith('9')))

    if (isValidBR) {
      return { ddi: '55', nationalNumber: digits, isBrazilian: true }
    }

    // Estrutura inválida para BR → tenta detectar DDI internacional
    const match = matchDDI(digits)
    if (match && isPlausibleNationalNumber(match.ddi, match.rest)) {
      return {
        ddi: match.ddi,
        nationalNumber: match.rest,
        isBrazilian: match.ddi === '55',
      }
    }

    // Fallback: assume brasileiro (retrocompatibilidade)
    return { ddi: '55', nationalNumber: digits, isBrazilian: true }
  }

  // Rule 4: Not starting with 55, 12+ digits → try international DDI
  if (!digits.startsWith('55') && digits.length >= 12) {
    const match = matchDDI(digits)
    if (match && isPlausibleNationalNumber(match.ddi, match.rest)) {
      return {
        ddi: match.ddi,
        nationalNumber: match.rest,
        isBrazilian: match.ddi === '55',
      }
    }
  }

  // Rule 5: Default → assume Brazilian
  return { ddi: '55', nationalNumber: digits, isBrazilian: true }
}

// ══════════════════════════════════════════════════════════════
// VALIDAÇÃO
// ══════════════════════════════════════════════════════════════

/**
 * Valida se um telefone é válido (brasileiro ou internacional)
 *
 * Validação E.164:
 * - Total de dígitos (DDI + número nacional) ≤ 15
 * - Número nacional ≥ 4 dígitos (mínimo prático para países pequenos)
 *
 * @param phone - Telefone em qualquer formato
 * @returns true se o telefone é válido
 *
 * @example
 * isValidPhone('+14155551234')  // true (US)
 * isValidPhone('(11) 91234-5678') // true (BR)
 * isValidPhone('123')            // false
 */
export function isValidPhone(phone: string | number | null | undefined): boolean {
  if (!phone) return false

  const { ddi, nationalNumber, isBrazilian } = detectDDI(phone)

  if (isBrazilian) {
    return isValidBrazilianPhone(phone)
  }

  // Validação E.164: DDI + número nacional ≤ 15 dígitos no total
  return (
    !!ddi &&
    nationalNumber.length >= 4 &&
    ddi.length + nationalNumber.length <= 15
  )
}

/**
 * Valida se um telefone brasileiro é válido
 *
 * @param phone - Telefone em qualquer formato
 * @returns true se o telefone é válido
 *
 * @example
 * isValidBrazilianPhone('(11) 91234-5678') // true
 * isValidBrazilianPhone('123')             // false
 */
export function isValidBrazilianPhone(phone: string | number | null | undefined): boolean {
  if (!phone) return false
  const { ddd, number } = parsePhone(phone)

  // Valida DDD (11-99)
  const dddNum = parseInt(ddd, 10)
  if (isNaN(dddNum) || dddNum < 11 || dddNum > 99) return false

  // Valida tamanho do número (8 ou 9 dígitos)
  if (number.length < 8 || number.length > 9) return false

  return true
}

/**
 * Explica POR QUE um telefone é inválido, em PT-BR, para mensagens de erro
 * voltadas a quem integra (LPs, API pública) e à UI.
 *
 * Retorna `null` quando o telefone é válido (BR ou internacional E.164) ou
 * quando está vazio — telefone ausente não é erro (lead pode ter só email);
 * obrigatoriedade é regra do caller.
 *
 * @example
 * getPhoneValidationError('(11) 91234-5678')    // null (válido)
 * getPhoneValidationError('')                   // null (vazio não é erro)
 * getPhoneValidationError('+551196160768801')   // 'Telefone inválido: ... 15 dígitos ...'
 * getPhoneValidationError('1234')               // 'Telefone inválido: ... dígitos de menos ...'
 */
export function getPhoneValidationError(phone: string | number | null | undefined): string | null {
  if (!phone || !String(phone).trim()) return null
  if (isValidPhone(phone)) return null

  const raw = String(phone).trim()
  const digits = raw.replace(/\D/g, '')

  if (!digits.length) {
    return `Telefone inválido: "${raw}" não contém dígitos.`
  }

  const { isBrazilian } = detectDDI(phone)

  if (isBrazilian) {
    const { ddd, number } = parsePhone(phone)
    if (number.length > 9) {
      return `Telefone inválido: "${raw}" tem ${digits.length} dígitos — um número brasileiro tem no máximo 13 com o DDI (55 + DDD + celular de 9 dígitos, ex.: +55 11 91234-5678). Confira se não há dígitos a mais.`
    }
    if (number.length < 8) {
      return `Telefone inválido: "${raw}" tem dígitos de menos para um número brasileiro (esperado DDD + 8 ou 9 dígitos, ex.: 11 91234-5678).`
    }
    const dddNum = parseInt(ddd, 10)
    if (isNaN(dddNum) || dddNum < 11 || dddNum > 99) {
      return `Telefone inválido: o DDD "${ddd}" não existe no Brasil (DDDs válidos vão de 11 a 99).`
    }
    return `Telefone inválido: "${raw}" não é um número brasileiro válido.`
  }

  if (digits.length > 15) {
    return `Telefone inválido: "${raw}" tem ${digits.length} dígitos — o máximo internacional (padrão E.164) é 15, incluindo o código do país.`
  }
  return `Telefone inválido: "${raw}" não é um número internacional válido (esperado código do país com "+" e número nacional de pelo menos 4 dígitos, ex.: +351 912 345 678).`
}

// ══════════════════════════════════════════════════════════════
// EXTRAÇÃO / PARSING
// ══════════════════════════════════════════════════════════════

/**
 * Extrai o DDD de um número de telefone
 * Para números internacionais, retorna string vazia (conceito não existe fora do Brasil)
 *
 * @param phone - Telefone em qualquer formato
 * @returns DDD com 2 dígitos ou string vazia
 *
 * @example
 * extractDDD('(11) 91234-5678')  // '11'
 * extractDDD('+5511912345678')   // '11'
 * extractDDD('+14155551234')     // '' (internacional, sem DDD)
 */
export function extractDDD(phone: string | number | null | undefined): string {
  if (!phone) return ''

  const phoneStr = String(phone)

  // Formato com parênteses: (XX) — sempre brasileiro
  const parenthesesMatch = phoneStr.match(/\((\d{2})\)/)
  if (parenthesesMatch) return parenthesesMatch[1]

  const parsed = parsePhone(phone)
  // Internacional: sem conceito de DDD
  if (!parsed.isBrazilian) return ''
  return parsed.ddd
}

/**
 * Extrai apenas o número do telefone (sem DDD e sem DDI)
 *
 * @param phone - Telefone em qualquer formato
 * @returns Número sem DDD (8 ou 9 dígitos para BR, número nacional para internacional)
 *
 * @example
 * extractPhoneNumber('(11) 91234-5678')  // '912345678'
 * extractPhoneNumber('+5511912345678')   // '912345678'
 * extractPhoneNumber('+14155551234')     // '4155551234'
 */
export function extractPhoneNumber(phone: string | number | null | undefined): string {
  if (!phone) return ''

  const phoneStr = String(phone)

  // Formato com parênteses e hífen: (XX) XXXXX-XXXX — sempre brasileiro
  const formattedMatch = phoneStr.match(/\(\d{2}\)\s*(\d{4,5}[-\s]?\d{4})/)
  if (formattedMatch) {
    return formattedMatch[1].replace(/[-\s]/g, '')
  }

  const parsed = parsePhone(phone)
  return parsed.number
}

/**
 * Verifica se um DDD requer o 9º dígito
 * Desde 2016 TODOS os DDDs brasileiros requerem (Anatel Resolução 553/2010)
 *
 * @param ddd - DDD como string ou número
 * @returns true para todos os DDDs válidos (11-99)
 *
 * @example
 * dddRequiresNinthDigit('11') // true  (São Paulo)
 * dddRequiresNinthDigit('32') // true  (Juiz de Fora)
 * dddRequiresNinthDigit('71') // true  (Salvador)
 */
export function dddRequiresNinthDigit(ddd: string | number): boolean {
  const dddNum = typeof ddd === 'string' ? parseInt(ddd, 10) : ddd
  return dddNum >= 11 && dddNum <= 99
}

/**
 * Separa um telefone em suas partes componentes
 * Suporta números brasileiros e internacionais
 *
 * @param phone - Telefone em qualquer formato
 * @param countryIso - ISO do país (opcional)
 * @returns Objeto com ddi, ddd, number, isBrazilian e raw
 *
 * @example
 * parsePhone('+5511912345678') // { ddi: '55', ddd: '11', number: '912345678', isBrazilian: true, raw: '+5511912345678' }
 * parsePhone('(32) 1234-5678') // { ddi: '55', ddd: '32', number: '12345678', isBrazilian: true, raw: '(32) 1234-5678' }
 * parsePhone('+14155551234')   // { ddi: '1', ddd: '', number: '4155551234', isBrazilian: false, raw: '+14155551234' }
 * parsePhone('+351912345678')  // { ddi: '351', ddd: '', number: '912345678', isBrazilian: false, raw: '+351912345678' }
 */
export function parsePhone(
  phone: string | number | null | undefined,
  countryIso?: string,
): {
  ddi: string
  ddd: string
  number: string
  isBrazilian: boolean
  raw: string
} {
  if (!phone) return { ddi: '', ddd: '', number: '', isBrazilian: true, raw: '' }

  const rawInput = String(phone)
  const { ddi, nationalNumber, isBrazilian } = detectDDI(phone, countryIso)

  // Número muito curto para ter estrutura
  if (!nationalNumber || nationalNumber.length < 4) {
    return {
      ddi: '',
      ddd: '',
      number: nationalNumber || cleanPhone(phone),
      isBrazilian: true,
      raw: rawInput,
    }
  }

  if (isBrazilian) {
    // Brasileiro com DDD: 10+ dígitos no número nacional
    if (nationalNumber.length >= 10) {
      return {
        ddi: '55',
        ddd: nationalNumber.substring(0, 2),
        number: nationalNumber.substring(2),
        isBrazilian: true,
        raw: rawInput,
      }
    }
    // Brasileiro sem DDD
    return {
      ddi: '55',
      ddd: '',
      number: nationalNumber,
      isBrazilian: true,
      raw: rawInput,
    }
  }

  // Internacional: sem conceito de DDD
  return {
    ddi,
    ddd: '',
    number: nationalNumber,
    isBrazilian: false,
    raw: rawInput,
  }
}

// ══════════════════════════════════════════════════════════════
// NORMALIZAÇÃO
// ══════════════════════════════════════════════════════════════

/**
 * Normaliza telefone para formato WhatsApp/META
 * - Brasileiro: aplica regra do 9º dígito (META), formato 55DDXXXXXXXXX
 * - Internacional: retorna {DDI}{número} sem regras brasileiras
 *
 * Formato de saída: apenas dígitos (sem +), funciona para wa.me links
 *
 * @param phone - Telefone em qualquer formato
 * @param countryIso - ISO do país (opcional)
 * @returns Telefone normalizado
 *
 * @example
 * // Brasileiro
 * normalizePhone('(11) 8765-4321')   // '5511987654321' (celular legado 8 díg: injeta o 9)
 * normalizePhone('11912345678')       // '5511912345678'
 * normalizePhone('(11) 5104-1453')   // '551151041453'  (FIXO inicia 2-5: NÃO injeta o 9)
 *
 * // Internacional
 * normalizePhone('+14155551234')      // '14155551234'
 * normalizePhone('+351912345678')     // '351912345678'
 * normalizePhone('+244923456789')     // '244923456789'
 */
export function normalizePhone(
  phone: string | number | null | undefined,
  countryIso?: string,
): string {
  if (!phone) return ''

  const parsed = parsePhone(phone, countryIso)

  // Internacional: DDI + número nacional, sem regras brasileiras
  if (!parsed.isBrazilian) {
    return `${parsed.ddi}${parsed.number}`
  }

  // Brasileiro: lógica existente com regra do 9º dígito (META)
  const { ddd, number } = parsed

  if (!ddd || !number) {
    // Se não conseguiu extrair DDD, retorna apenas com 55
    const cleaned = cleanPhone(phone)
    return cleaned.startsWith('55') ? cleaned : `55${cleaned}`
  }

  let normalizedNumber = number

  // Anatel (Resolução 553/2010): o 9º dígito foi dado APENAS a celulares
  // (migração concluída em 2017); fixos continuam com 8 dígitos e iniciam 2-5.
  // Para input de 8 dígitos: 6-9 = celular legado (injeta o 9); 2-5 = FIXO
  // (nunca injetar — viraria o celular de outra pessoa); 0-1 = inválido como
  // fixo → assume celular moderno cujo 9 se perdeu upstream (injeta; preserva
  // a regressão do dedup p/ base8 iniciando 0-1, ex. 91055-7215).
  if (normalizedNumber.length === 8 && !/^[2-5]/.test(normalizedNumber)) {
    normalizedNumber = `9${normalizedNumber}`
  }

  return `${BRAZIL_COUNTRY_CODE}${ddd}${normalizedNumber}`
}

/**
 * Single source of truth para normalizar telefone ANTES de persistir em Leads.phone.
 *
 * Idempotente: aplicar 2× = aplicar 1×. Use em TODOS os call sites de
 * prisma.leads.create para garantir que dois fluxos diferentes (POST /api/lead,
 * tracking auto-create, form, batch import, etc) salvem o MESMO phone canônico
 * para a mesma identidade — pré-condição para o partial unique index funcionar
 * (Leads_phone_campaignId_companyId_unique_partial).
 *
 * @param input - Telefone em qualquer formato (raw do request)
 * @returns Phone canônico para armazenamento (apenas dígitos, com DDI 55 quando BR)
 */
export function normalizePhoneForStorage(input: string | number | null | undefined): string {
  return normalizePhone(input)
}

/**
 * Normaliza telefone para formato E.164 internacional
 * Aplica a regra do 9º dígito (META) e adiciona prefixo +
 *
 * Formato de saída: +{DDI}{número}
 *
 * @param phone - Telefone em qualquer formato
 * @returns Telefone em formato E.164
 *
 * @example
 * normalizePhoneE164('(11) 91234-5678') // '+5511912345678'
 * normalizePhoneE164('32 1234-5678')    // '+55321234567'
 * normalizePhoneE164('+14155551234')    // '+14155551234'
 */
export function normalizePhoneE164(phone: string | number | null | undefined): string {
  const normalized = normalizePhone(phone)
  return normalized ? `+${normalized}` : ''
}

// ══════════════════════════════════════════════════════════════
// FORMATAÇÃO
// ══════════════════════════════════════════════════════════════

/**
 * Formata telefone para exibição amigável
 * - Brasileiro: (XX) XXXXX-XXXX ou (XX) XXXX-XXXX
 * - Internacional: +{DDI} {número nacional}
 *
 * @param phone - Telefone em qualquer formato
 * @returns Telefone formatado para display
 *
 * @example
 * formatPhoneDisplay('5511912345678')   // '(11) 91234-5678'
 * formatPhoneDisplay('55321234567')     // '(32) 1234-5678'
 * formatPhoneDisplay('+14155551234')    // '+1 4155551234'
 * formatPhoneDisplay('+351912345678')   // '+351 912345678'
 */
export function formatPhoneDisplay(phone: string | number | null | undefined): string {
  if (!phone) return ''

  const parsed = parsePhone(phone)

  // Internacional: mostrar +DDI número nacional
  if (!parsed.isBrazilian && parsed.ddi && parsed.number) {
    return `+${parsed.ddi} ${parsed.number}`
  }

  // Brasileiro: formato existente
  const { ddd, number } = parsed

  if (!ddd || !number) {
    return cleanPhone(phone)
  }

  // Formata com ou sem 9º dígito
  if (number.length === 9) {
    // XXXXX-XXXX
    return `(${ddd}) ${number.substring(0, 5)}-${number.substring(5)}`
  } else if (number.length === 8) {
    // XXXX-XXXX
    return `(${ddd}) ${number.substring(0, 4)}-${number.substring(4)}`
  }

  return `(${ddd}) ${number}`
}

/**
 * Formata telefone progressivamente enquanto o usuário digita
 * Ideal para uso em inputs de formulário
 * - Se começa com "+": modo internacional (sem máscara brasileira)
 * - Sem "+": máscara brasileira (comportamento atual)
 *
 * @param value - Valor atual do input
 * @returns Valor formatado progressivamente
 *
 * @example
 * formatPhoneInput('11')            // '(11'
 * formatPhoneInput('119')           // '(11) 9'
 * formatPhoneInput('11912345678')   // '(11) 91234-5678'
 * formatPhoneInput('+1415')         // '+1415'
 * formatPhoneInput('+351912345678') // '+351912345678'
 */
export function formatPhoneInput(value: string): string {
  // Modo internacional: se usuário digita +
  if (value.startsWith('+')) {
    // Permite apenas + seguido de dígitos
    return '+' + value.slice(1).replace(/\D/g, '')
  }

  // Modo brasileiro: comportamento existente
  const numbers = cleanPhone(value)

  if (numbers.length <= 2) {
    return numbers.length > 0 ? `(${numbers}` : ''
  }

  if (numbers.length <= 7) {
    return `(${numbers.substring(0, 2)}) ${numbers.substring(2)}`
  }

  const ddd = numbers.substring(0, 2)
  const hasNinthDigit = numbers.length > 10

  if (hasNinthDigit) {
    // (XX) XXXXX-XXXX
    const middle = numbers.substring(2, 7)
    const end = numbers.substring(7, 11)
    return `(${ddd}) ${middle}-${end}`
  } else {
    // (XX) XXXX-XXXX
    const middle = numbers.substring(2, 6)
    const end = numbers.substring(6, 10)
    return `(${ddd}) ${middle}-${end}`
  }
}

// ══════════════════════════════════════════════════════════════
// WHATSAPP
// ══════════════════════════════════════════════════════════════

/**
 * Sanitiza telefone removendo caracteres especiais do WhatsApp
 * Remove sufixo @c.us, parênteses, hífens, espaços, pontos
 * Detecta DDI internacional ao invés de forçar 55
 *
 * @param phone - Telefone potencialmente com sufixos do WhatsApp
 * @returns Telefone limpo e normalizado
 *
 * @example
 * sanitizeWhatsAppPhone('5511912345678@c.us')    // '5511912345678'
 * sanitizeWhatsAppPhone('+55 (11) 91234-5678')   // '5511912345678'
 * sanitizeWhatsAppPhone('+14155551234@c.us')      // '14155551234'
 */
export function sanitizeWhatsAppPhone(phone: string | null | undefined): string {
  if (!phone) return ''

  // Remove sufixo @c.us e qualquer caractere não numérico
  const digits = String(phone)
    .replace(/@c\.us$/i, '')
    .replace(/\D/g, '')

  if (!digits) return ''

  // Já tem DDI brasileiro (55 + DDD + número): retorna como veio, sem injetar 9
  if (digits.startsWith('55') && digits.length >= 12) return digits

  // Sem DDI: 10 dígitos (DDD + fixo) ou 11 dígitos (DDD + celular 9XXXXXXXX)
  if (digits.length === 10 || digits.length === 11) return `55${digits}`

  // Internacional ou tamanho inesperado: devolve só os dígitos limpos
  return digits
}

// ══════════════════════════════════════════════════════════════
// UTILITÁRIOS
// ══════════════════════════════════════════════════════════════

/**
 * Retorna o nome do país/território associado a um DDI
 * Útil para exibir informações ao usuário
 *
 * @param ddi - Código do país (1-3 dígitos)
 * @returns Nome do país ou undefined se não encontrado
 *
 * @example
 * getCountryByDDI('55')  // 'Brasil'
 * getCountryByDDI('1')   // 'Estados Unidos / Canadá / Caribe (NANP)'
 * getCountryByDDI('351') // 'Portugal'
 * getCountryByDDI('999') // undefined
 */
export function getCountryByDDI(ddi: string): string | undefined {
  return COUNTRY_CALLING_CODES_MAP[ddi]
}

/**
 * Gera variantes de phone para deduplicação robusta — trata `+55` E o 9º dígito
 * móvel (Anatel 553/2010) como opcionais. DDD é sempre obrigatório.
 *
 * Para móveis BR, gera as 4 formas equivalentes do mesmo número:
 *   A) `55 DD 9 XXXXXXXX` (13 dig — com DDI + 9º)
 *   B) `55 DD XXXXXXXX`   (12 dig — com DDI, sem 9º)
 *   C) `DD XXXXXXXX`      (10 dig — sem DDI, sem 9º)
 *   D) `DD 9 XXXXXXXX`    (11 dig — sem DDI, com 9º)
 *
 * Heurística de móvel: o "base8" (últimos 8 dígitos sem o 9 móvel) deve começar
 * com 6, 7, 8 ou 9 (faixa Anatel pré-2016 para celulares). Para fixos (base8
 * começa com 2-5), só geramos ±55 — injetar 9 mudaria para um número diferente.
 *
 * `opts.legacyLandlineNine` (bridge de transição, SÓ para lookups de dedup de
 * Leads): até 2026-07 o normalizePhone injetava 9 também em FIXOS, então fixos
 * antigos estão gravados como `55DD9XXXXXXXX`. Com a flag, um input de fixo SEM
 * o 9 (10/12 dígitos, base8 2-5) também gera as formas com o 9 espúrio para
 * alcançar esses registros legados. Assimétrico de propósito: input COM 9
 * (11/13 dígitos) nunca gera a forma sem 9 — um celular moderno `9[2-5]XXXXXXX`
 * não pode casar com um fixo. Risco residual aceito: um fixo pode casar com um
 * registro 13-díg que era celular verdadeiro (indistinguível nos dados; mesmo
 * conflation que a regra antiga fazia na escrita). NÃO usar a flag em matching
 * de autorização/atribuição de conversas (whatsapp-chat, leads-dashboard).
 *
 * @example
 *   phoneVariants("5532988091300")  // ["5532988091300","553288091300","3288091300","32988091300"]
 *   phoneVariants("3288091300")     // idem (qualquer das 4 formas converge)
 *   phoneVariants("1133334444")     // ["1133334444","551133334444"] (fixo, só ±55)
 *   phoneVariants("1133334444", { legacyLandlineNine: true })
 *     // ["1133334444","551133334444","5511933334444","11933334444"] (±55 × ±9 espúrio)
 *   phoneVariants("123")            // [] (curto demais)
 */
export function phoneVariants(
  phone: string | number | null | undefined,
  opts?: { legacyLandlineNine?: boolean },
): string[] {
  if (!phone) return []
  const digits = String(phone).replace(/\D/g, '')
  if (digits.length < 8) return []

  const set = new Set<string>([digits])

  // Tenta extrair DDD (2 dig) + base8 (últimos 8 dig sem o 9 móvel) para gerar
  // as 4 formas. Os 4 casos abaixo cobrem A/B/C/D conforme docstring.
  let ddd = ''
  let base8 = ''

  if (digits.length === 13 && digits.startsWith('55') && digits[4] === '9') {
    ddd = digits.slice(2, 4); base8 = digits.slice(5)
  } else if (digits.length === 12 && digits.startsWith('55')) {
    ddd = digits.slice(2, 4); base8 = digits.slice(4)
  } else if (digits.length === 11 && !digits.startsWith('55') && digits[2] === '9') {
    ddd = digits.slice(0, 2); base8 = digits.slice(3)
  } else if (digits.length === 10 && !digits.startsWith('55')) {
    ddd = digits.slice(0, 2); base8 = digits.slice(2)
  }

  // Móveis BR (Anatel pré-2016): base8 começa com 6-9. Para esses, geramos
  // as 4 formas equivalentes. Para fixos (2-5), só ±55 — adicionar o 9 móvel
  // mudaria para um número de pessoa diferente.
  const isMobileBase8 = base8.length === 8 && /^[6-9]/.test(base8)
  const isLandlineBase8 = base8.length === 8 && /^[2-5]/.test(base8)
  // Formas de input que JÁ carregam o dígito 9 (13 = 55+DDD+9+base8; 11 = DDD+9+base8)
  const inputHasNine = digits.length === 13 || digits.length === 11

  if (ddd && isMobileBase8) {
    set.add(`55${ddd}9${base8}`)  // A
    set.add(`55${ddd}${base8}`)   // B
    set.add(`${ddd}${base8}`)     // C
    set.add(`${ddd}9${base8}`)    // D
  } else if (ddd && isLandlineBase8 && !inputHasNine && opts?.legacyLandlineNine) {
    // Bridge legado (ver docstring): fixo sem 9 também procura as formas com o
    // 9 espúrio que a regra antiga gravou. Nunca o inverso (assimétrico).
    set.add(`55${ddd}${base8}`)
    set.add(`${ddd}${base8}`)
    set.add(`55${ddd}9${base8}`)
    set.add(`${ddd}9${base8}`)
  } else {
    if (digits.startsWith('55') && digits.length >= 12) set.add(digits.slice(2))
    if (!digits.startsWith('55') && digits.length >= 8 && digits.length <= 11) set.add(`55${digits}`)
  }

  return Array.from(set)
}

/**
 * Retorna a chave canônica de phone para uso em locks distribuídos.
 *
 * Para garantir que paths concorrentes (consumer RabbitMQ + controller HTTP)
 * competam pelo MESMO Redis lock independentemente de o phone vir com ou sem
 * o prefixo `55`, normalizamos sempre para o formato SEM 55.
 *
 * @example
 *   canonicalPhoneForLock("5511228782931")        // "11228782931"
 *   canonicalPhoneForLock("11228782931")          // "11228782931"
 *   canonicalPhoneForLock("+55 (11) 22878-2931")  // "11228782931"
 *   canonicalPhoneForLock("")                     // ""
 */
export function canonicalPhoneForLock(phone: string | number | null | undefined): string {
  const digits = String(phone || '').replace(/\D/g, '')
  return digits.startsWith('55') && digits.length >= 12 ? digits.slice(2) : digits
}