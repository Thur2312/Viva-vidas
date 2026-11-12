import { Body, Controller, Get, HttpCode, Post, Req } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { Public } from '../auth/public.decorator'
import { NoTenant } from '../auth/no-tenant.decorator'
import { PanelAuthService } from './panel-auth.service'

/** Rate limit estrito por IP (somado ao bloqueio por usuario do service). */
const LOGIN_LIMIT = { default: { limit: 10, ttl: 60_000 } }
const REFRESH_LIMIT = { default: { limit: 30, ttl: 60_000 } }

@Controller('panel-auth')
@NoTenant()
export class PanelAuthController {
  constructor(private readonly auth: PanelAuthService) {}

  // `@Body() body: any`: o corpo e validado a mao no service (qualquer falha vira 401 generico).
  @Public() @Throttle(LOGIN_LIMIT) @Post('login') @HttpCode(200)
  login(@Body() body: any, @Req() req: any) {
    return this.auth.login(body?.email, body?.password, req.headers?.['user-agent'])
  }

  @Public() @Throttle(REFRESH_LIMIT) @Post('refresh') @HttpCode(200)
  refresh(@Body() body: any, @Req() req: any) {
    return this.auth.refresh(body?.refreshToken, req.headers?.['user-agent'])
  }

  @Public() @Throttle(REFRESH_LIMIT) @Post('logout') @HttpCode(204)
  async logout(@Body() body: any) {
    await this.auth.logout(body?.refreshToken)
  }

  @Get('me')
  me(@Req() req: any) {
    return this.auth.me(req.user.id)
  }
}
