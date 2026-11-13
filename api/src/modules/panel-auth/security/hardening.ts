import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common'
import type { NextFunction, Request, Response } from 'express'
import { createHash, randomUUID, timingSafeEqual } from 'crypto'
import { isIP } from 'net'

// ───────────── Validacao de ambiente (fail-fast) ─────────────
const PLACEHOLDER_RE = /^(change.?me|your[-_ ]?|placeholder|example|secret|secretkey|password|senha|xxx+|test|dev|default|todo|jwt[-_]?secret|insecure)/i

/** Retorna os erros que impedem o boot. Em producao: SECRETKEY >= 32 chars e nao-placeholder. */
export function validateEnv(env: NodeJS.ProcessEnv): string[] {
  const errors: string[] = []
  const prod = env.NODE_ENV === 'production'
  const key = env.SECRETKEY ?? ''
  if (!key) errors.push('SECRETKEY ausente (assina/valida o JWT)')
  else if (prod) {
    if (key.length < 32) errors.push('SECRETKEY curta demais (minimo 32 caracteres em producao)')
    if (PLACEHOLDER_RE.test(key) || /^(.)\1+$/.test(key)) errors.push('SECRETKEY parece um placeholder; gere um segredo aleatorio')
  }
  if (prod && (env.CORS_ORIGINS ?? '').split(',').some((o) => o.trim() === '*')) errors.push('CORS_ORIGINS nao pode conter "*"')
  if (prod) {
    // Modulos herdados (meta-ads, tracking...) isolam tenant pelo TenantGuard, que por padrao LIBERA rota sem companyId.
    // Em producao: ou sobe so o piloto (PILOT_ONLY) ou liga o modo estrito.
    if (env.PILOT_ONLY !== 'true' && env.TENANT_GUARD_ENFORCE !== 'true') errors.push('producao exige PILOT_ONLY=true ou TENANT_GUARD_ENFORCE=true')
    // Kill-switch que desliga a assinatura do webhook do WhatsApp: nunca em producao.
    if (env.WHATSAPP_META_WEBHOOK_SIGNATURE_DISABLED === 'true') errors.push('WHATSAPP_META_WEBHOOK_SIGNATURE_DISABLED=true nao e permitido em producao')
    // Sem a chave, a API enxerga um unico IP (o do BFF): o limite de login por IP vira um balde global
    // e qualquer pessoa consegue travar o login de todos.
    if ((env.BFF_SHARED_KEY ?? '').length < 32) errors.push('producao exige BFF_SHARED_KEY com 32+ caracteres (mesmo valor no web/)')
  }
  return errors
}

// ───────────── IP real do usuario quando o BFF (Next) esta na frente ─────────────
const sha = (v: string) => createHash('sha256').update(v).digest()

/**
 * O BFF chama a API de um IP publico e unico (o do servidor Next), entao `req.ip` vira sempre o mesmo para todo mundo:
 * o limite de login por IP vira um balde unico e a auditoria grava o IP errado. O BFF manda o IP do usuario em
 * `x-bff-client-ip`, junto com `x-bff-key`. So com a chave certa (BFF_SHARED_KEY) o IP e aceito; sem a env, nada muda.
 */
export function bffClientIp(secret = process.env.BFF_SHARED_KEY) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const key = req.headers['x-bff-key']
    const ip = req.headers['x-bff-client-ip']
    if (secret && typeof key === 'string' && typeof ip === 'string' && timingSafeEqual(sha(key), sha(secret)) && isIP(ip.trim())) {
      Object.defineProperty(req, 'ip', { value: ip.trim(), configurable: true })
    }
    next()
  }
}

// ───────────── Redacao de logs ─────────────
/** Mascara telefones (8+ digitos), tokens Bearer/JWT e valores longos tipo segredo. */
export function scrub(text: string): string {
  return String(text)
    .replace(/:\/\/[^\s/@]+@/g, '://[redacted]@')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g, '[jwt]')
    .replace(/\+?\d[\d\s().-]{6,}\d/g, '[num]')
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, '[redacted]')
}

/** Caminho sem query string; segmentos numericos longos/tokens viram placeholders. */
export function safePath(url: string): string {
  const path = String(url ?? '').split('?')[0].split('#')[0]
  return path
    .split('/')
    .map((seg) => (/^\d{6,}$/.test(seg) || (seg.length >= 32 && !/^[0-9a-f-]{36}$/i.test(seg)) ? ':redacted' : seg))
    .join('/')
}

/** Log de requisicao: SO metodo, caminho sem query, status, duracao e id. Nunca corpo/headers/query. */
export function requestLogger() {
  const logger = new Logger('HTTP')
  return (req: Request, res: Response, next: NextFunction) => {
    const start = Date.now()
    const id = randomUUID().slice(0, 8)
    ;(req as any).reqId = id
    res.setHeader('X-Request-Id', id)
    const path = safePath(req.originalUrl ?? req.url)
    res.on('finish', () => {
      if (path === '/health') return
      logger.log(`${id} ${req.method} ${path} ${res.statusCode} ${Date.now() - start}ms`)
    })
    next()
  }
}

// ───────────── Filtro de excecoes: nada interno em respostas 5xx ─────────────
@Catch()
export class SafeExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exception')

  catch(exception: unknown, host: ArgumentsHost) {
    const http = host.switchToHttp()
    const res = http.getResponse<Response>()
    const req = http.getRequest<Request>()
    if (res.headersSent) return

    const status = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR
    // 502/503 LANCADOS DE PROPOSITO por nos (ex.: "Chat nao configurado", "Agenda indisponivel") levam o motivo ao painel:
    // as mensagens sao nossas, em pt-BR, sem segredo nem dado pessoal. Excecao inesperada (500) continua generica.
    if (exception instanceof HttpException && (status === 502 || status === 503)) {
      this.logger.warn(`${(req as any).reqId ?? '-'} ${req.method} ${safePath(req.originalUrl ?? req.url)} -> ${status}`)
      const body = exception.getResponse()
      res.status(status).json(typeof body === 'string' ? { statusCode: status, message: body } : body)
      return
    }
    if (status >= 500) {
      const err = exception as any
      this.logger.error(`${(req as any).reqId ?? '-'} ${req.method} ${safePath(req.originalUrl ?? req.url)} -> ${status} ${err?.name ?? 'Error'}: ${scrub(err?.message ?? '')}`)
      res.status(status).json({ statusCode: status, message: 'Internal server error' })
      return
    }
    if (exception instanceof HttpException) {
      const body = exception.getResponse()
      res.status(status).json(typeof body === 'string' ? { statusCode: status, message: body } : body)
      return
    }
    res.status(status).json({ statusCode: status, message: 'Error' })
  }
}

// ───────────── CORS: nega por padrao ─────────────
export function parseCorsOrigins(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((o) => o.trim().replace(/\/+$/, ''))
    .filter((o) => o && o !== '*')
}

export function corsOriginCheck(allowed: string[]) {
  return (origin: string | undefined, cb: (err: Error | null, allow?: boolean) => void) => {
    // Sem Origin = nao e navegador (curl, servidor): CORS nao se aplica.
    if (!origin) return cb(null, true)
    return cb(null, allowed.includes(origin))
  }
}
