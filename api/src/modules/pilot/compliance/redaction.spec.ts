import { flagSensitive, isValidCnpj, isValidCpf, luhn, pseudonymize, pseudonymizeDeep, redactPii, restoreLeadName } from './redaction'
import { maskPhone, normalizePhone } from './phone'

// Todos os documentos abaixo são fictícios, apenas com dígito verificador válido.
const CPF = '529.982.247-25'
const CPF_BARE = '52998224725'
const CNPJ = '11.222.333/0001-81'
const CARD = '4111 1111 1111 1111'

describe('validadores', () => {
  it('CPF, CNPJ e Luhn', () => {
    expect(isValidCpf(CPF)).toBe(true)
    expect(isValidCpf('529.982.247-24')).toBe(false)
    expect(isValidCpf('111.111.111-11')).toBe(false)
    expect(isValidCnpj(CNPJ)).toBe(true)
    expect(isValidCnpj('11.222.333/0001-80')).toBe(false)
    expect(luhn(CARD)).toBe(true)
    expect(luhn('4111 1111 1111 1112')).toBe(false)
  })
})

describe('redactPii', () => {
  it('mascara CPF com e sem pontuação', () => {
    expect(redactPii(`meu cpf é ${CPF}`).text).toBe('meu cpf é [CPF]')
    expect(redactPii(`cpf ${CPF_BARE} ok`).text).toBe('cpf [CPF] ok')
  })

  it('mascara CNPJ, e-mail e cartão', () => {
    const r = redactPii(`empresa ${CNPJ}, email joao.silva@gmail.com, cartão ${CARD}`)
    expect(r.text).toBe('empresa [CNPJ], email [EMAIL], cartão [CARTAO]')
    expect(r.found).toEqual(expect.arrayContaining(['cnpj', 'email', 'cartao']))
  })

  it('mascara RG', () => {
    expect(redactPii('RG 12.345.678-9 emitido em SSP').text).toContain('[RG]')
    expect(redactPii('rg: 1234567 SSP').text).toContain('[RG]')
  })

  it('mascara telefones em vários formatos, sem confundir com CPF', () => {
    for (const t of ['(83) 99999-1234', '83999991234', '+55 83 99999-1234', '83 9999-1234', '5583999991234']) {
      expect(redactPii(`me liga no ${t} por favor`).text).toBe('me liga no [TELEFONE] por favor')
    }
    expect(redactPii(`cpf ${CPF_BARE}`).text).toBe('cpf [CPF]')
  })

  it('não mexe em números comuns de conversa', () => {
    const t = 'Pago R$ 1900 por mês, somos 4 vidas, idades 34 e 61 anos'
    expect(redactPii(t).text).toBe(t)
  })

  it('mascara nomes conhecidos, com acento e sem acento, e usa [LEAD] para o lead', () => {
    const r = redactPii('Oi João, aqui é a Maria Souza. Joao da Silva confirmou.', { leadNames: ['João da Silva'], names: ['Maria Souza'] })
    expect(r.text).toBe('Oi [LEAD], aqui é a [NOME]. [LEAD] confirmou.')
  })

  it('não mascara pedaço de outra palavra', () => {
    expect(redactPii('Ana chegou, banana e Anais', { names: ['Ana'] }).text).toBe('[NOME] chegou, banana e Anais')
  })

  it('pega apresentação explícita mesmo sem lista de nomes', () => {
    expect(redactPii('Boa tarde, meu nome é Carlos Eduardo Lima e quero um plano').text).toBe('Boa tarde, meu nome é [NOME] e quero um plano')
    expect(redactPii('me chamo Beatriz').text).toBe('me chamo [NOME]')
  })

  it('telefone conhecido do lead em qualquer formatação', () => {
    const r = redactPii('Contato: 83 99999-1234 / +55 (83) 9 9999 1234', { phones: ['5583999991234'] })
    expect(r.text).toBe('Contato: [TELEFONE] / [TELEFONE]')
  })
})

describe('flagSensitive', () => {
  it.each([
    ['tenho diabetes tipo 2', 'condicao'],
    ['minha esposa está grávida', 'condicao'],
    ['tomo losartana e metformina', 'medicamento'],
    ['preciso fazer uma ressonância magnética', 'exame'],
    ['diagnóstico CID F32.1', 'cid'],
    ['laudo com E11.9', 'cid'],
    ['fiz cirurgia bariátrica', 'condicao'],
  ])('detecta "%s"', (text, cat) => {
    const r = flagSensitive(text)
    expect(r.containsSensitive).toBe(true)
    expect(r.categories).toContain(cat)
  })

  it('texto comercial neutro não é sensível', () => {
    expect(flagSensitive('Quero cotar um plano para 3 vidas em João Pessoa, orçamento 1500').containsSensitive).toBe(false)
  })
})

describe('pseudonimização para o LLM', () => {
  const who = { name: 'Maria Oliveira', phone: '5583999991234' }

  it('troca nome e telefone por marcadores estáveis', () => {
    const t = pseudonymize('Maria Oliveira aqui, me chama no (83) 99999-1234. CPF 529.982.247-25', who)
    expect(t).toBe('[LEAD] aqui, me chama no [TELEFONE]. CPF [CPF]')
    expect(t).not.toMatch(/Maria|99999|529/)
  })

  it('percorre objetos JSON', () => {
    const q = pseudonymizeDeep({ plano: 'Unimed', contato: { email: 'maria@x.com.br', nome: 'Maria' }, lista: ['83999991234'] }, who)
    expect(JSON.stringify(q)).toBe('{"plano":"Unimed","contato":{"email":"[EMAIL]","nome":"[LEAD]"},"lista":["[TELEFONE]"]}')
  })

  it('restoreLeadName devolve só o primeiro nome', () => {
    expect(restoreLeadName('Oi [LEAD], tudo bem?', 'Maria Oliveira')).toBe('Oi Maria, tudo bem?')
  })
})

describe('telefone', () => {
  it('normaliza e mascara', () => {
    expect(normalizePhone('(83) 99999-1234')).toBe('5583999991234')
    expect(() => normalizePhone('123')).toThrow()
    expect(maskPhone('5583999991234')).toBe('+55 83 9****-1234')
    expect(maskPhone('558333221234')).toBe('+55 83 ****-1234')
    expect(maskPhone('anon:abc')).toBe('****')
    expect(maskPhone(null)).toBeNull()
  })
})
