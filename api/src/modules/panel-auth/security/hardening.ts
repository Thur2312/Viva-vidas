import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common'
import type { NextFunction, Request, Response } from 'express'
import { randomUUID } from 'crypto'

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
  return errors
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
