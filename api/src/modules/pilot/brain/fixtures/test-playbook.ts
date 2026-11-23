import { PlaybookData } from '../types'

/** EXEMPLO FICTÍCIO DE TESTE. Não contém informação comercial real. */
export const testPlaybook: PlaybookData = {
  oferta: {
    descricao: 'EXEMPLO FICTÍCIO DE TESTE: corretora de exemplo que orienta famílias na escolha de um plano.',
    publico: 'Famílias fictícias de teste',
  },
  campos: [
    { chave: 'plano_atual', pergunta: 'Vocês já têm plano hoje?', porque: 'Entender o ponto de partida', obrigatorio: true, ordem: 1, sensivel: false, valores: ['sim', 'nao'] },
    { chave: 'vidas', pergunta: 'Quantas pessoas entrariam no plano?', porque: 'Dimensionar a proposta', obrigatorio: true, ordem: 2, sensivel: false },
    { chave: 'cidade', pergunta: 'Em que cidade vocês moram?', porque: 'Ver se atendemos a região', obrigatorio: true, ordem: 3, sensivel: false },
    { chave: 'condicao_saude', pergunta: 'FICTÍCIO: nunca perguntar', porque: 'Exercita a exclusão de dado sensível', obrigatorio: false, ordem: 4, sensivel: true },
  ],
  criterios: {
    qualificado: {
      all: [
        { campo: 'vidas', op: 'gte', valor: 1 },
        { campo: 'cidade', op: 'presente' },
        { campo: 'plano_atual', op: 'presente' },
      ],
    },
    desqualificado: { campo: 'vidas', op: 'lt', valor: 1 },
  },
  objecoes: [
    { id: 'preco', gatilho: 'tá caro', resposta: 'Texto fictício de resposta sobre preço.', nuncaDizer: ['desconto garantido'] },
    { id: 'carencia', gatilho: 'e a carência?', resposta: 'Texto fictício de resposta sobre carência.', nuncaDizer: ['sem carência'] },
  ],
  fatos: [
    { id: 'fato_a', texto: 'FATO FICTÍCIO A (placeholder de teste).' },
    { id: 'fato_b', texto: 'FATO FICTÍCIO B (placeholder de teste).' },
  ],
  tom: { formalidade: 'informal', tamanho: 'curto', emoji: 'raro', frases: ['Oi, tudo bem?'] },
  regrasProibidas: ['Nunca prometer desconto'],
  passagemHumano: { quando: ['Lead pede um humano', 'Assunto fora dos fatos aprovados'] },
  agenda: { tiposReuniao: ['Conversa de exemplo'], duracaoMin: 20, janelas: 'dias úteis (fictício)', prometer: 'Uma conversa de exemplo' },
  cadencia: { maxTentativas: 2, mensagem: 'Oi! Ainda posso ajudar?' },
}
