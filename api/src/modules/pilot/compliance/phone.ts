export function normalizePhone(raw: string): string {
  const d = (raw || '').replace(/\D/g, '')
  if (d.length < 10) throw new Error('Telefone inválido')
  return d.length <= 11 ? `55${d}` : d
}

/** Máscara para listagens: `+55 83 9****-1234`. Só o DDD e os 4 últimos dígitos ficam visíveis. */
export function maskPhone(phone: string | null | undefined): string | null {
  if (!phone) return null
  const d = String(phone).replace(/\D/g, '')
  if (d.length < 10 || String(phone).startsWith('anon:')) return '****'
  const national = d.startsWith('55') && d.length >= 12 ? d.slice(2) : d
  const ddd = national.slice(0, 2)
  const rest = national.slice(2)
  const hasNine = rest.length === 9
  return `+55 ${ddd} ${hasNine ? rest[0] : ''}****-${rest.slice(-4)}`
}
