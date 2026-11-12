import { Controller, Post, Body, Query, Req } from '@nestjs/common'
import { TrackingService } from './tracking.service'
import { ApiTags } from '@nestjs/swagger'
import { Public } from 'src/modules/auth/public.decorator'
import { SkipLogging } from 'src/shared/decorators/skip-logging.decorator'
import { SkipThrottle } from '@nestjs/throttler'
import { Request } from 'express'
import { resolveClientIpOrEmpty } from 'src/shared/util/client-ip.util'

@ApiTags('Track')
@Public()
@SkipThrottle()
@SkipLogging()
@Controller('track')
export class TrackController {
  constructor(private readonly trackingService: TrackingService) {}

  /**
   * Rota unificada de tracking.
   * Aceita query params + JSON body (body tem prioridade).
   * Auth: API key de campanha OU secret key de empresa (campo "key").
   *
   * Exemplos:
   *   POST /track?action=optin&email=x@y.com&key=ABC123
   *   POST /track  { "action": "optin", "email": "x@y.com", "key": "ABC123", "url": "https://..." }
   */
  @Post()
  async track(@Body() body: any, @Query() query: any, @Req() req: Request) {
    // Merge query params e body (body tem prioridade)
    const data = { ...query, ...body }

    // Extrair key do header x-api-key se não veio no body/query
    if (!data.key) {
      data.key = req.headers['x-api-key'] as string || ''
    }

    // Extrair IP do request se não veio nos dados
    if (!data.ip) {
      data.ip = resolveClientIpOrEmpty(req)
    }

    return this.trackingService.createTrackingByKey(data)
  }
}
