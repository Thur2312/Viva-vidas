import { Injectable } from '@nestjs/common'
import { PrismaService } from 'src/database/prisma.service'

@Injectable()
export class TrackingQueryService {
  constructor(private prisma: PrismaService) {}

  async getLeadTracking(email: string, phone: string, companyId: string) {
    // Buscar todos os trackings pelo email/phone E companyId
    // Também incluir trackings que tenham o mesmo sessionId
    const identityConditions: any[] = []
    if (email) identityConditions.push({ email })
    if (phone) identityConditions.push({ phone })

    if (identityConditions.length === 0) {
      return []
    }

    const identityTrackings = await this.prisma.tracking.findMany({
      where: {
        companyId: companyId,
        OR: identityConditions,
      },
      select: {
        sessionId: true,
      },
      distinct: ['sessionId'],
    })

    const sessionIds = identityTrackings
      .map(tracking => tracking.sessionId)
      .filter(sessionId => sessionId && sessionId.trim() !== '')

    // Buscar todos os eventos relacionados: por email, phone OU por sessionIds relacionados
    const orConditions: any[] = [...identityConditions]
    if (sessionIds.length > 0) {
      orConditions.push({ sessionId: { in: sessionIds } })
    }

    const trackingsRaw = await this.prisma.tracking.findMany({
      where: {
        companyId: companyId,
        OR: orConditions,
      },
      include: {
        campaign: {
          select: {
            name: true,
          },
        },
      },
    })

    // Deduplicar OPTINs idênticos (mesmo email, <10s de diferença)
    const optinTimestamps = new Map<string, number>()
    const trackings = trackingsRaw.filter((r: any) => {
      if (r.action?.toUpperCase() !== 'OPTIN') return true
      const ts = r.timestamp_2 ? r.timestamp_2 : Math.floor(r.timestamp.getTime() / 1000)
      const key = r.email?.toLowerCase() || ''
      const prev = optinTimestamps.get(key)
      if (prev !== undefined && Math.abs(ts - prev) <= 10) return false
      optinTimestamps.set(key, ts)
      return true
    })

    // Ordenar por timestamp_2 (unix) quando disponível, senão por timestamp
    return trackings.sort((a: any, b: any) => {
      const timestampA = a.timestamp_2 ? a.timestamp_2 : Math.floor(a.timestamp.getTime() / 1000)
      const timestampB = b.timestamp_2 ? b.timestamp_2 : Math.floor(b.timestamp.getTime() / 1000)
      return timestampB - timestampA // Ordem decrescente (mais recente primeiro)
    })
  }
}
