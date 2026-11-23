import { PlaybookData } from './types'

export function emptyPlaybookTemplate(): PlaybookData {
  return {
    oferta: { descricao: '', publico: '' },
    campos: [],
    criterios: {},
    objecoes: [],
    fatos: [],
    tom: { formalidade: '', tamanho: '', emoji: '', frases: [] },
    regrasProibidas: [],
    passagemHumano: { quando: [] },
    agenda: { tiposReuniao: [], duracaoMin: 0, janelas: '', prometer: '' },
    cadencia: { maxTentativas: 0, mensagem: '' },
    exemplos: {
      oferta: 'Descreva o que a corretora vende, para quem, em linguagem do cliente. EXEMPLO (não ativo): "Ajudamos famílias a escolher um plano que cabe no bolso."',
      campos: 'Liste os dados a perguntar, em ordem. Dado sensível (saúde) nunca é perguntado nem obrigatório. EXEMPLO (não ativo): chave "cidade", pergunta "Em que cidade vocês moram?".',
      criterios: 'Regra sobre os campos que torna o lead qualificado ou desqualificado. EXEMPLO (não ativo): qualificado = cidade preenchida.',
      objecoes: 'Para cada objeção: como o lead diz, resposta recomendada e o que nunca dizer. EXEMPLO (não ativo): gatilho "tá caro".',
      fatos: 'Texto exato que o agente pode afirmar. O que não estiver aqui vai para uma pessoa. EXEMPLO (não ativo): "Fato de exemplo".',
      tom: 'Formalidade, tamanho das mensagens, uso de emoji e frases suas. EXEMPLO (não ativo): "Oi, tudo bem?".',
      regrasProibidas: 'O que o agente nunca diz ou faz, além das regras fixas do sistema. EXEMPLO (não ativo): "Nunca prometer desconto".',
      passagemHumano: 'Quando repassar para uma pessoa. EXEMPLO (não ativo): "Quando o lead pedir para falar com humano".',
      agenda: 'Tipos de reunião, duração, janelas e o que prometer. EXEMPLO (não ativo): "Conversa de 20 minutos".',
      cadencia: 'Quantas tentativas sem resposta e o que dizer (hoje: não insistir após 2 mensagens). EXEMPLO (não ativo): 2 tentativas.',
    },
  }
}
