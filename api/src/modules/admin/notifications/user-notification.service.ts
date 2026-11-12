import { Injectable, Logger } from '@nestjs/common'

export interface CreateUserNotificationInput {
  userId?: string | null
  companyId: string
  type: string
  title: string
  body?: string
  link?: string
  icon?: string
  metadata?: Record<string, any>
}

/** STUB: notificacoes in-app do HDM (tabela de notificacoes nao existe aqui). So loga. */
@Injectable()
export class UserNotificationService {
  private readonly logger = new Logger(UserNotificationService.name)

  async create(input: CreateUserNotificationInput) {
    this.logger.warn(`[STUB] notificacao ignorada company=${input.companyId} type=${input.type}`)
    return null
  }
}
