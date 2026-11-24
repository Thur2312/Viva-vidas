import { Injectable, ServiceUnavailableException, BadGatewayException } from '@nestjs/common'

export interface SendTextInput {
  phone: string
  body: string
  connectionId?: string
  requestedBy?: string // id do usuário do painel (auditoria no chat)
}
export interface SendTemplateInput {
  phone: string
  templateName: string
  language?: string
  variables?: string[]
  connectionId?: string
  requestedBy?: string
}
export interface TemplateInfo {
  name: string
  status: string // PENDING | APPROVED | REJECTED | PAUSED ...
  category: string
  language: string
  rejected_reason?: string | null
}
export interface NumberHealthInfo {
  qualityRating: 'GREEN' | 'YELLOW' | 'RED' | 'UNKNOWN'
  limitTier: string
  dailyLimit: number | null
  status: string | null
  nameStatus: string | null
  accountReviewStatus: string | null
  checkedAt: string
}
export interface ConnectionInfo {
  id: number
  name: string
  status: string // CONNECTED | qrcode | OPENING | DISCONNECTED | PAIRING | TIMEOUT
  number: string | null
  qrDataUrl: string | null
}
export interface CreateTemplateInput {
  name: string
  category: 'MARKETING' | 'UTILITY'
  language?: string
  bodyText: string
  bodyExamples?: string[]
  footerText?: string
  buttons?: { type: 'QUICK_REPLY' | 'URL' | 'PHONE_NUMBER'; text: string; url?: string; phone_number?: string }[]
}

/**
 * Único caminho de SAÍDA para o WhatsApp. O painel/API nunca fala com a Meta direto:
 * chama o chat (horizon-chat-api) em `POST {CHAT_API_URL}/pilot-bridge/*`, autenticado por
 * `x-pilot-key: CHAT_BRIDGE_KEY` (chave distinta da PILOT_API_KEY, que vale na direção oposta).
 * Sem as variáveis, falha FECHADO com 503 e mensagem honesta. Nunca registra telefone nem texto.
 */
@Injectable()
export class ChatGatewayService {
  private get url() { return (process.env.CHAT_API_URL || '').replace(/\/+$/, '') }
  private get key() { return process.env.CHAT_BRIDGE_KEY || '' }
  private get connectionId() { return process.env.CHAT_CONNECTION_ID || undefined }

  configured(): boolean {
    if (!this.url || !this.key) return false
    try {
      const u = new URL(this.url)
      return u.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(u.hostname)
    } catch { return false }
  }

  status() {
    const missing = ['CHAT_API_URL', 'CHAT_BRIDGE_KEY'].filter((k) => !process.env[k])
    return { configured: this.configured(), missing, connectionId: this.connectionId ?? null }
  }

  async sendText(i: SendTextInput): Promise<{ wid: string }> {
    return this.call('POST', '/pilot-bridge/send', { type: 'text', phone: i.phone, text: i.body, connectionId: i.connectionId ?? this.connectionId, requestedBy: i.requestedBy })
  }

  async sendTemplate(i: SendTemplateInput): Promise<{ wid: string }> {
    return this.call('POST', '/pilot-bridge/send', {
      type: 'template', phone: i.phone, templateName: i.templateName, language: i.language ?? 'pt_BR',
      variables: i.variables ?? [], connectionId: i.connectionId ?? this.connectionId, requestedBy: i.requestedBy,
    })
  }

  async listTemplates(status?: string): Promise<TemplateInfo[]> {
    const q = new URLSearchParams()
    if (this.connectionId) q.set('connectionId', this.connectionId)
    if (status) q.set('status', status)
    const r = await this.call<{ data: TemplateInfo[] }>('GET', `/pilot-bridge/templates?${q}`)
    return r.data ?? []
  }

  async createTemplate(i: CreateTemplateInput) {
    return this.call('POST', '/pilot-bridge/templates', { ...i, connectionId: this.connectionId })
  }

  /**
   * Saúde do número (qualidade/limite da Meta) lida pelo chat. Nunca lança: devolve o motivo explícito,
   * sem valores inventados. Códigos: chat_nao_configurado, chat_indisponivel, token_expirado, sem_permissao, ...
   */
  async numberHealth(): Promise<{ ok: true; data: NumberHealthInfo } | { ok: false; error: string }> {
    if (!this.configured()) return { ok: false, error: 'chat_nao_configurado' }
    const q = new URLSearchParams()
    if (this.connectionId) q.set('connectionId', this.connectionId)
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 10_000)
    try {
      const res = await fetch(`${this.url}/pilot-bridge/number-health?${q}`, { headers: { 'x-pilot-key': this.key }, signal: ctrl.signal })
      const body: any = await res.json().catch(() => ({}))
      if (!res.ok) return { ok: false, error: typeof body?.error === 'string' ? body.error.slice(0, 60) : 'chat_indisponivel' }
      return { ok: true, data: body as NumberHealthInfo }
    } catch {
      return { ok: false, error: 'chat_indisponivel' }
    } finally {
      clearTimeout(t)
    }
  }

  /**
   * Estado da conexão do WhatsApp no chat e, enquanto aguarda pareamento, o QR (data URL).
   * Nunca lança: devolve o motivo explícito. O QR é credencial de sessão: só chega ao painel para o dono.
   */
  async connection(): Promise<{ ok: true; data: ConnectionInfo } | { ok: false; error: string }> {
    if (!this.configured()) return { ok: false, error: 'chat_nao_configurado' }
    const q = new URLSearchParams()
    if (this.connectionId) q.set('connectionId', this.connectionId)
    try {
      return { ok: true, data: await this.call<ConnectionInfo>('GET', `/pilot-bridge/connection?${q}`) }
    } catch (e: any) {
      return { ok: false, error: e?.status === 503 ? 'chat_nao_configurado' : 'chat_indisponivel' }
    }
  }

  /**
   * Pede ao chat para iniciar a sessão do WhatsApp (gera o QR). Idempotente no chat: conectado não é tocado.
   * Nunca lança: devolve o motivo explícito.
   */
  async startConnection(): Promise<{ ok: true; data: { id: number; status: string; started: boolean } } | { ok: false; error: string }> {
    if (!this.configured()) return { ok: false, error: 'chat_nao_configurado' }
    try {
      return { ok: true, data: await this.call('POST', '/pilot-bridge/connection/start', { connectionId: this.connectionId }) }
    } catch (e: any) {
      return { ok: false, error: e?.status === 503 ? 'chat_nao_configurado' : 'chat_indisponivel' }
    }
  }

  /**
   * Cadastra/atualiza a conexão da API OFICIAL (Cloud API) no chat. O token só passa por aqui a caminho do chat:
   * não é gravado nem logado nesta API, e a resposta nunca o devolve. O chat confere o token na Graph antes de salvar.
   * Nunca lança: devolve o motivo explícito.
   */
  async connectOfficial(i: { phoneNumberId: string; wabaId: string; accessToken: string; name?: string }): Promise<
    { ok: true; data: { id: number; status: string; created: boolean } } | { ok: false; error: string }
  > {
    if (!this.configured()) return { ok: false, error: 'chat_nao_configurado' }
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 15_000)
    try {
      const res = await fetch(this.url + '/pilot-bridge/connection/official', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-pilot-key': this.key },
        body: JSON.stringify({ phoneNumberId: i.phoneNumberId, wabaId: i.wabaId, accessToken: i.accessToken, name: i.name }),
        signal: ctrl.signal,
      })
      if (res.ok) return { ok: true, data: (await res.json()) as { id: number; status: string; created: boolean } }
      if (res.status === 400) {
        const j: any = await res.json().catch(() => null)
        const code = String(j?.error ?? j?.code ?? '')
        return { ok: false, error: code === 'credenciais_invalidas' ? 'credenciais_invalidas' : 'dados_invalidos' }
      }
      return { ok: false, error: res.status === 503 ? 'chat_nao_configurado' : 'chat_indisponivel' }
    } catch {
      return { ok: false, error: 'chat_indisponivel' }
    } finally {
      clearTimeout(t)
    }
  }

  private async call<T = any>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    if (!this.configured()) throw new ServiceUnavailableException('Chat não configurado (CHAT_API_URL / CHAT_BRIDGE_KEY)')
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 10_000)
    try {
      const res = await fetch(this.url + path, {
        method,
        headers: { 'content-type': 'application/json', 'x-pilot-key': this.key },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: ctrl.signal,
      })
      if (!res.ok) throw new BadGatewayException(`Chat respondeu ${res.status}`)
      return (await res.json()) as T
    } catch (e: any) {
      if (e?.status) throw e // já é HttpException
      throw new BadGatewayException(e?.name === 'AbortError' ? 'Chat não respondeu a tempo' : 'Falha ao falar com o chat')
    } finally {
      clearTimeout(t)
    }
  }
}
