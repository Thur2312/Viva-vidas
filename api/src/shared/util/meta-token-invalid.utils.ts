import { Logger } from '@nestjs/common'
import { PrismaService } from 'src/database/prisma.service'
import { triggerEventBus } from 'src/shared/events/trigger-event-bus'

const logger = new Logger('MetaTokenInvalid')

/**
 * Copy única do estado "token morto". O MetaQualityCard do front renderiza o
 * `error` gravado verbatim — esta string É a mensagem que o cliente lê na tela.
 */
export const META_TOKEN_INVALID_MESSAGE =
  'Token Meta invalidado — reconecte a conta Facebook em Configurações → Integrações'

/** decrypt() devolveu a entrada intacta com cara de envelope: a chave local não abre o dado. */
export const META_TOKEN_DECRYPT_FAILED_MESSAGE =
  'Falha ao decriptar o token Meta (ENCRYPTION_KEY divergente?) — regrave o token na tela de Integrações'

/**
 * Marca a(s) integração(ões) Meta ATIVA(s) da empresa como token-inválido.
 *
 * Funções puras sobre o PrismaService (@Global) em vez de um service: os chamadores
 * atravessam três módulos (TriggerModule detecta, MetaAdsModule e Parametrization
 * limpam) e um provider compartilhado criaria exatamente o ciclo de import que o
 * grafo atual evita.
 *
 * O WHERE `metaTokenInvalidAt: null` faz o `count > 0` significar TRANSIÇÃO
 * válido→inválido — é o gatilho da notificação, garantindo disparo único por
 * incidente mesmo com o cron de 5min batendo no mesmo erro.
 *
 * NUNCA usar Integrations.status = INACTIVE para isso: getMetaAccessToken e o cron
 * de refresh filtram ACTIVE — INACTIVE esconderia a integração dos dois e bloquearia
 * a própria recuperação.
 */
export async function markMetaTokenInvalid(
  prisma: PrismaService,
  companyId: string,
  reason: string,
): Promise<boolean> {
  const { count } = await prisma.integrations.updateMany({
    where: {
      companiesId: companyId,
      platform: { type: 'meta' },
      status: 'ACTIVE',
      deleted_at: null,
      metaAccessToken: { not: null },
      metaTokenInvalidAt: null,
    },
    data: {
      metaTokenInvalidAt: new Date(),
      metaTokenInvalidReason: reason.slice(0, 500),
    },
  })
  return count > 0
}

/**
 * Limpa o flag — chamar em TODO lugar que regrava `metaAccessToken` (callback OAuth,
 * refresh, PATCH manual da tela, probe com sucesso). Retorna true se havia flag.
 *
 * `releaseHeldEvents` (default true) zera o nextAttemptAt dos PENDING da empresa:
 * os eventos retidos pelo hold voltam a ser elegíveis no próximo ciclo do cron em
 * vez de esperar a janela de 60min vencer. O `disconnect` passa false — sem token
 * não há o que enviar, liberar só queimaria ciclos.
 */
export async function clearMetaTokenInvalid(
  prisma: PrismaService,
  companyId: string,
  opts: { releaseHeldEvents?: boolean } = {},
): Promise<boolean> {
  const { count } = await prisma.integrations.updateMany({
    where: {
      companiesId: companyId,
      platform: { type: 'meta' },
      deleted_at: null,
      metaTokenInvalidAt: { not: null },
    },
    data: { metaTokenInvalidAt: null, metaTokenInvalidReason: null },
  })

  if (count > 0 && (opts.releaseHeldEvents ?? true)) {
    await prisma.triggerTrackingEvent.updateMany({
      where: { companyId, status: 'PENDING', nextAttemptAt: { not: null } },
      data: { nextAttemptAt: null },
    })
  }

  return count > 0
}

/**
 * Assinatura estrutural do UserNotificationService.create — evita importar classe
 * de módulo dentro de shared/ (e mantém o parâmetro opcional nos specs).
 */
interface NotificationSink {
  create(input: {
    userId?: string | null
    companyId: string
    type: string
    title: string
    body?: string
    link?: string
    icon?: string
    metadata?: Record<string, any>
  }): Promise<unknown>
}

/**
 * Notificação in-app na TRANSIÇÃO — chamar SOMENTE quando markMetaTokenInvalid
 * devolveu true. Uma UserNotification POR gestor (OWNER/ADMIN ativos) em vez de
 * broadcast: para vendedor a informação é ruído, não há o que ele faça. Padrão de
 * lead-distribution-notifier.service.ts. Nunca lança — notificação não pode
 * derrubar envio nem medição.
 */
export async function notifyMetaTokenInvalid(
  prisma: PrismaService,
  notifications: NotificationSink | undefined,
  companyId: string,
  reason: string,
): Promise<void> {
  try {
    try {
      triggerEventBus.emit('notification.sse', { companyId, eventType: 'meta.token_invalid' })
    } catch (erro: any) {
      logger.error(`[MetaToken] falha ao emitir SSE: ${erro?.message ?? erro}`)
    }

    if (!notifications) return

    const gestores = await prisma.client.companyMember.findMany({
      where: {
        companyId,
        status: 'ACTIVE',
        role: { in: ['OWNER', 'ADMIN'] as any },
        userId: { not: null },
      },
      select: { userId: true },
    })

    for (const gestor of gestores) {
      try {
        await notifications.create({
          userId: gestor.userId,
          companyId,
          type: 'meta.token_invalid',
          title: 'Conexão Meta perdida — reconecte o Facebook',
          body:
            'O Facebook invalidou o token da integração (ex.: troca de senha). ' +
            'O envio de conversões e a medição de qualidade ficam pausados até reconectar.',
          link: '/settings/integration',
          icon: 'alert-triangle',
          metadata: { reason },
        })
      } catch (erro: any) {
        logger.error(`[MetaToken] falha ao persistir notificação: ${erro?.message ?? erro}`)
      }
    }
  } catch (erro: any) {
    logger.error(`[MetaToken] notificação falhou: ${erro?.message ?? erro}`)
  }
}
