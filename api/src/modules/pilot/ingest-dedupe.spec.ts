import { DEDUPE_BUCKET_SECONDS, fallbackWid } from './ingest-dedupe'

const T = 1_700_000_000_000 // dentro de uma janela de 10 s
const msg = { direction: 'in' as const, author: 'lead', body: 'Oi, quero saber o preco' }

describe('fallbackWid (mensagem recebida sem wid)', () => {
  it('o mesmo conteudo na mesma janela gera a mesma chave (reenvio vira duplicata)', () => {
    expect(fallbackWid(msg, T)).toBe(fallbackWid({ ...msg }, T + 1000))
    expect(fallbackWid(msg, T)).toMatch(/^auto:[0-9a-f]{40}$/)
  })

  it('conteudo ou autor diferente gera chave diferente', () => {
    expect(fallbackWid({ ...msg, body: 'outra coisa' }, T)).not.toBe(fallbackWid(msg, T))
    expect(fallbackWid({ ...msg, author: 'humano' }, T)).not.toBe(fallbackWid(msg, T))
  })

  it('depois da janela a mesma frase e uma mensagem nova (o lead pode repetir "sim" mais tarde)', () => {
    expect(fallbackWid(msg, T + DEDUPE_BUCKET_SECONDS * 1000)).not.toBe(fallbackWid(msg, T))
  })

  it('mensagem ENVIADA nunca recebe chave: duas respostas iguais seguidas sao legitimas', () => {
    expect(fallbackWid({ ...msg, direction: 'out', author: 'humano' }, T)).toBeNull()
    expect(fallbackWid({ ...msg, direction: 'out', author: 'agente' }, T)).toBeNull()
  })
})
