import { Controller, Get, Header, Query, Res } from '@nestjs/common'
import { NoTenant } from '../auth/no-tenant.decorator'
import { Public } from '../auth/public.decorator'
import { Roles } from '../panel-auth/roles.decorator'
import { GoogleOAuthService } from './google-oauth.service'

const MSG: Record<string, string> = {
  estado_invalido: 'O pedido de conexão expirou ou é inválido. Volte ao painel e clique em Conectar de novo.',
  negado: 'A autorização foi negada no Google. Nada foi conectado.',
  sem_refresh_token: 'O Google não devolveu a permissão permanente. Remova o acesso do app em myaccount.google.com/permissions e conecte de novo.',
  troca_falhou: 'Não foi possível concluir a conexão com o Google. Confira o Client ID e o Client Secret.',
  faltam_credenciais: 'Faltam o Client ID e o Client Secret do Google no painel.',
}

/** Conexão da Google Agenda pelo painel. `start` é do dono; `callback` é o retorno do Google (protegido por `state` assinado). */
@Controller('pilot/calendar/oauth')
@NoTenant()
export class GoogleOAuthController {
  constructor(private readonly oauth: GoogleOAuthService) {}

  @Roles('owner') @Get('start')
  @Header('Cache-Control', 'no-store')
  start() {
    return this.oauth.start()
  }

  @Public() @Get('callback')
  @Header('Cache-Control', 'no-store')
  async callback(@Query('code') code: string, @Query('state') state: string, @Query('error') error: string, @Res() res: any) {
    const r = await this.oauth.finish(code, state, error)
    const motivo = 'error' in r ? r.error : 'ok'
    const panel = this.oauth.panelUrl()
    if (panel) return res.redirect(302, `${panel}/integracoes?google=${motivo}`)
    // Sem endereço do painel configurado: página simples, sem dados do token.
    const texto = r.ok ? 'Google Agenda conectada. Pode fechar esta janela e voltar ao painel.' : MSG[motivo] ?? 'Não foi possível conectar.'
    return res.status(r.ok ? 200 : 400).type('html').send(`<!doctype html><meta charset="utf-8"><title>Google Agenda</title><body style="font:16px system-ui;max-width:32rem;margin:4rem auto;padding:0 1rem"><p>${texto}</p>`)
  }
}
