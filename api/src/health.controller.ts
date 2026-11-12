import { Controller, Get } from '@nestjs/common'
import { SkipThrottle } from '@nestjs/throttler'
import { Public } from './modules/auth/public.decorator'

@Controller('health')
@SkipThrottle()
export class HealthController {
  @Get()
  @Public()
  check() {
    return { status: 'ok' }
  }
}
