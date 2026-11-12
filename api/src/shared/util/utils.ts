import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'

export function extractNumbersAsString(input: string): string {
  // Use a regular expression to find all numbers in the string
  const matches = input.match(/\d+/g)

  // If there are no matches, return an empty string
  if (!matches) {
    return ''
  }

  // Join the matches into a single string and return it
  return matches.join('')
}

export function formatCNPJ(cnpj: string): string {
  // Remove any non-digit characters
  const digits = cnpj.replace(/\D/g, '')

  // Pad with leading zeros if necessary
  const paddedDigits = digits.padStart(14, '0')

  // Format the CNPJ
  return paddedDigits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')
}

export function formatCurrentDate() {
  const now = new Date()
  const formattedDate = format(now, "dd 'de' MMMM 'de' yyyy", { locale: ptBR })
  return formattedDate
}

export function normalizeString(input) {
  return input
    .toLowerCase() // Convert the string to lowercase
    .normalize('NFD') // Normalize the string to decompose combined letters
    .replace(/[\u0300-\u036f]/g, '') // Remove diacritical marks
    .replace(/[^a-z0-9\s]/g, '') // Remove any non-alphanumeric characters except spaces
    .replace(/\s+/g, '_') // Replace spaces with underscores
}

export function capitalizeFirstName(name: string): string {
  if (!name || !name.trim()) return name

  // Capitalize the first letter of each word, preserving the full name
  return name
    .toLowerCase()
    .trim()
    .split(/\s+/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

// Re-exporta funções de telefone do módulo centralizado
export {
  cleanPhone,
  extractDDD,
  extractPhoneNumber,
  parsePhone,
  normalizePhone,
  normalizePhoneE164,
  formatPhoneDisplay,
  formatPhoneInput,
  sanitizeWhatsAppPhone as phoneNumberSanitizer, // Alias para compatibilidade
  isValidBrazilianPhone,
  dddRequiresNinthDigit,
} from './phone.utils'

export const getYearMonthDay = () => {
  const now = new Date()
  const anoMesDia = format(now, 'yyyyMMdd')

  return anoMesDia
}

export function uuidToNumber(uuid: string): number {
  let hash = 0
  for (let i = 0; i < uuid.length; i++) {
    const char = uuid.charCodeAt(i)
    hash = (hash << 5) - hash + char
    hash = hash & hash // Convert to 32-bit integer
  }
  return Math.abs(hash)
}

export function generateToken() {
  const characters = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
  let token = ''

  for (let i = 0; i < 14; i++) {
    const randomIndex = Math.floor(Math.random() * characters.length)
    token += characters.charAt(randomIndex)
  }

  return token
}

// Função auxiliar para formatar o nome
export const formatName = (name: string) => {
  if (!name || !name.trim()) return ''

  // Capitaliza a primeira letra de cada palavra, preservando o nome completo
  return name
    .trim()
    .split(/\s+/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ')
}

// Alias para compatibilidade - usar normalizePhone do phone.utils.ts
export { normalizePhone as formatPhone } from './phone.utils'

/**
 * Extrai e processa informações de UTM de uma string
 * @param utmString - A string contendo informações de UTM (pode ser uma URL ou apenas os parâmetros)
 * @returns Objeto com os parâmetros UTM extraídos e processados
 */
export const parseUtms = (utmString: string): Record<string, string> => {
  if (!utmString) return {}

  try {
    const utmParams: Record<string, string> = {}
    let queryString = utmString

    // 1. Extração da Query String
    if (utmString.includes('?')) {
      const urlParts = utmString.split('?')
      queryString = urlParts[1] || ''
    }

    queryString = queryString.replace(/\|/g, '&')

    const searchParams = new URLSearchParams(queryString)

    const utmKeys = [
      'utm_source',
      'utm_medium',
      'utm_campaign',
      'utm_content',
      'utm_term',
      'utm_id',
      'utm_var1',
      'utm_fb',
      'utm_gclid',
      'fbclid',
      'gclid',
    ]

    for (const [key, value] of searchParams.entries()) {
      if (utmKeys.includes(key) || key.startsWith('utm_')) {
        utmParams[key] = value
      }
    }

    return utmParams
  } catch (error) {
    console.error('Erro ao processar UTMs:', error)
    return {}
  }
}

/**
 * Normaliza uma string removendo espaços, convertendo para minúsculas
 * e substituindo espaços por underlines
 * @param input - String a ser normalizada
 * @returns String normalizada
 */
export function normalizeAction(input: string): string {
  if (!input || typeof input !== 'string') {
    return ''
  }

  return input
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
}

/**
 * Função utilitária para garantir que o documento (CPF/CNPJ) seja sempre salvo limpo
 * Remove todos os caracteres não numéricos (pontos, traços, barras, espaços, etc.)
 *
 * @param document - Documento com ou sem formatação (CPF/CNPJ)
 * @returns String contendo apenas os números do documento
 *
 * @example
 * ensureCleanDocument('123.456.789-01') // retorna '12345678901'
 * ensureCleanDocument('12.345.678/0001-95') // retorna '12345678000195'
 * ensureCleanDocument('12345678901') // retorna '12345678901' (já limpo)
 */
export function ensureCleanDocument(document: string | number): string {
  if (!document) return ''

  // Converte para string caso seja número
  const docString = String(document)

  // Remove todos os caracteres não numéricos
  const cleanDocument = docString.replace(/\D/g, '')


  return cleanDocument
}

export function convertTiptapHtmlToWordText(html: string): string {
  if (!html) return ''

  let text = html

  // Handle any HTML encoding first
  text = text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')

  // Handle paragraphs first - convert to proper line breaks
  text = text.replace(/<p[^>]*>/gi, '')
  text = text.replace(/<\/p>/gi, '\n')

  // Convert strong/bold tags - keep the content with visual emphasis
  text = text.replace(/<strong[^>]*>(.*?)<\/strong>/gi, (match, content) => {
    return content // Keep content but we'll make it visually distinct
  })

  text = text.replace(/<b[^>]*>(.*?)<\/b>/gi, '$1')

  // Convert italic tags
  text = text.replace(/<em[^>]*>(.*?)<\/em>/gi, '$1')
  text = text.replace(/<i[^>]*>(.*?)<\/i>/gi, '$1')

  // Handle underline tags
  text = text.replace(/<u[^>]*>(.*?)<\/u>/gi, '$1')

  // Handle other structural elements
  text = text.replace(/<div[^>]*>/gi, '')
  text = text.replace(/<\/div>/gi, '\n')
  text = text.replace(/<span[^>]*>/gi, '')
  text = text.replace(/<\/span>/gi, '')
  text = text.replace(/<br[^>]*\/?>/gi, '\n')

  // Handle unordered lists with proper bullet formatting
  text = text.replace(/<ul[^>]*>/gi, '')
  text = text.replace(/<\/ul>/gi, '\n')
  text = text.replace(/<li[^>]*>/gi, '* ')
  text = text.replace(/<\/li>/gi, '\n')

  // Handle ordered lists with numbers
  let listCounter = 1
  text = text.replace(/<ol[^>]*>/gi, () => {
    listCounter = 1
    return ''
  })
  text = text.replace(/<\/ol>/gi, '\n')
  text = text.replace(/<li[^>]*>/gi, () => `${listCounter++}. `)

  // Handle headings - preserve the content
  text = text.replace(/<h[1-6][^>]*>(.*?)<\/h[1-6]>/gi, '$1\n')

  // Handle blockquotes
  text = text.replace(/<blockquote[^>]*>(.*?)<\/blockquote>/gi, '$1\n')

  // Remove any remaining HTML tags
  text = text.replace(/<[^>]*>/g, '')

  // Decode HTML entities
  text = text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&hellip;/g, '...')
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')


  // Clean up line breaks - preserve single line breaks, remove excessive ones
  text = text.replace(/\n\s*\n\s*\n+/g, '\n\n') // Max 2 consecutive line breaks
  text = text.replace(/^\s+|\s+$/g, '') // Trim start and end
  text = text.replace(/[ \t]+/g, ' ') // Multiple spaces to single space
  text = text.replace(/\n +/g, '\n') // Remove spaces after line breaks
  text = text.replace(/ +\n/g, '\n') // Remove spaces before line breaks

  // Fix bullet points spacing
  text = text.replace(/\n\*/g, '\n* ')
  text = text.replace(/\* +/g, '* ')

  // Ensure numbered lists are properly formatted
  text = text.replace(/(\d+\.\s)/g, '\n$1')

  // Final cleanup - ensure no empty lines at start
  text = text.replace(/^\n+/, '')

  const result = text.trim()
  return result
}

// Simplified main function that always uses the robust converter
export function convertHtmlToPlainText(html: string): string {
  if (!html) return ''

  // Convert to string if it's not already
  const htmlString = String(html)
  // If it contains HTML, convert it
  if (htmlString.includes('<') && htmlString.includes('>')) {
    const result = convertTiptapHtmlToWordText(htmlString)
    return result
  }

  return htmlString
}
