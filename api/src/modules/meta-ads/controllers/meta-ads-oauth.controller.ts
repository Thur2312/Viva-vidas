import { Controller, Get, Post, Delete, Query, Param, Res, UseGuards } from '@nestjs/common'
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger'
import { Response } from 'express'
import { JwtAuthGuard } from 'src/modules/auth/jwt-auth.guard'
import { Roles } from 'src/modules/panel-auth/roles.decorator'
import { Public } from 'src/modules/auth/public.decorator'
import { MetaAdsOAuthService } from '../services/meta-ads-oauth.service'

@ApiTags('Meta ADS')
@Roles('owner')
@Controller(['meta-ads', 'api/meta-ads'])
export class MetaAdsOAuthController {
  constructor(
    private readonly metaAdsOAuthService: MetaAdsOAuthService,
  ) {}

  // ===== ENDPOINTS OAUTH =====

  @Get('oauth/login')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Gera URL de login OAuth do Facebook' })
  @ApiQuery({ name: 'companyId', required: true })
  async oauthLogin(@Query('companyId') companyId: string) {
    return this.metaAdsOAuthService.generateLoginUrl(companyId)
  }

  @Public()
  @Get('oauth/callback')
  @ApiOperation({ summary: 'Callback do Facebook OAuth (sem guard - Facebook redireciona)' })
  async oauthCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Res() res: Response,
  ) {
    const result = await this.metaAdsOAuthService.handleCallback(code, state)
    return res.redirect(result.redirectUrl)
  }

  @Get('oauth/status')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Retorna status da conexao OAuth' })
  @ApiQuery({ name: 'companyId', required: true })
  @ApiQuery({
    name: 'probe',
    required: false,
    description: '1 = valida o token na Graph API (GET /me) e auto-marca/limpa o flag de invalidacao',
  })
  async oauthStatus(
    @Query('companyId') companyId: string,
    @Query('probe') probe?: string,
  ) {
    return this.metaAdsOAuthService.getConnectionStatus(companyId, probe === '1')
  }

  @Delete('oauth/disconnect')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Desconecta conta Facebook OAuth' })
  @ApiQuery({ name: 'companyId', required: true })
  async oauthDisconnect(@Query('companyId') companyId: string) {
    return this.metaAdsOAuthService.disconnect(companyId)
  }

  // ===== ENDPOINTS DISCOVERY =====

  @Get('business-managers')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Lista Business Managers do usuario conectado' })
  @ApiQuery({ name: 'companyId', required: true })
  async listBusinessManagers(@Query('companyId') companyId: string) {
    return this.metaAdsOAuthService.listBusinessManagers(companyId)
  }

  @Get('ad-accounts')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Lista Ad Accounts (opcional: filtrar por Business Manager)' })
  @ApiQuery({ name: 'companyId', required: true })
  @ApiQuery({ name: 'businessId', required: false })
  async listAdAccounts(
    @Query('companyId') companyId: string,
    @Query('businessId') businessId?: string,
  ) {
    return this.metaAdsOAuthService.listAdAccounts(companyId, businessId)
  }

  @Post('ad-accounts/:accountId')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Seleciona e salva Ad Account para a integracao' })
  @ApiQuery({ name: 'companyId', required: true })
  async selectAdAccount(
    @Param('accountId') accountId: string,
    @Query('companyId') companyId: string,
  ) {
    return this.metaAdsOAuthService.selectAdAccount(companyId, accountId)
  }
}
