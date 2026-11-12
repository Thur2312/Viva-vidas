// Config da CLI do Prisma. PRECISA ficar na raiz do projeto: o Prisma procura
// `prisma.config.ts` aqui e em mais lugar nenhum. Este arquivo passou um tempo em
// `prisma/prisma.config.ts`, onde nunca foi lido — o schema era achado só pela convenção
// padrão `prisma/schema.prisma`, e a config era decorativa.
//
// ⚠ Carregar o .env aqui NÃO é opcional. A partir do momento em que este arquivo existe, o
//   Prisma anuncia "Prisma config detected, skipping environment variable loading" e para de
//   ler o .env sozinho — todo comando morre com "Environment variable not found: DATABASE_URL".
//   Em produção (Railway/Docker) as variáveis já vêm injetadas no ambiente e o dotenv não
//   encontra arquivo nenhum, o que é inofensivo: ele simplesmente não sobrescreve nada.
import 'dotenv/config'

import type { PrismaConfig } from 'prisma'

export default {
  // Caminho explícito em vez de convenção. As migrations continuam saindo em
  // `prisma/migrations/`, ao lado do schema.
  schema: 'prisma/schema.prisma',
} satisfies PrismaConfig
