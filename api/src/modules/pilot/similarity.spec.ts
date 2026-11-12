import { classify, similarity } from './similarity'

describe('similarity', () => {
  it('textos iguais valem 1 e ignoram acento, caixa e pontuação', () => {
    expect(similarity('Qual é o valor do seu plano atual?', 'qual e o valor do seu plano atual')).toBe(1)
  })
  it('textos sem relação ficam baixos', () => {
    expect(similarity('Posso marcar amanhã às 10h?', 'O plano cobre exames de rotina')).toBeLessThan(0.2)
  })
  it('edição leve cai em "editou"', () => {
    const s = similarity('Qual o valor do seu plano atual hoje?', 'Me conta, qual o valor do plano que você paga hoje?')
    expect(classify(s)).toBe('editou')
  })
  it('vazio contra vazio é 1 e vazio contra texto é 0', () => {
    expect(similarity('', '')).toBe(1)
    expect(similarity('', 'oi')).toBe(0)
  })
  it('classifica pelos limites', () => {
    expect(classify(0.9)).toBe('igual')
    expect(classify(0.5)).toBe('editou')
    expect(classify(0.2)).toBe('diferente')
  })
})
