// Carrega .env ANTES de qualquer outro import (AppModule decide o modo PILOT_ONLY ao ser avaliado).
import 'dotenv/config'
// BigInt JSON serialization polyfill
;(BigInt.prototype as any).toJSON = function () {
  return Number(this)
}

import { NestFactory } from '@nestjs/core'
import { NestExpressApplication } from '@nestjs/platform-express'
import { Logger } from '@nestjs/common'
import { AppModule } from './app.module'
import { HdmValidationPipe } from 'src/shared/validation/hdm-validation.pipe'
import { captureRawBody } from 'src/shared/util/raw-body.util'
import { isTrustedProxyIp } from 'src/shared/util/client-ip.util'
import { json, urlencoded } from 'express'
// `import x = require()`: o tsconfig nao tem esModuleInterop.
/* eslint-disable @typescript-eslint/no-require-imports */
import cookieParser = require('cookie-parser')
import compression = require('compression')
/* eslint-enable @typescript-eslint/no-require-imports */
import helmet from 'helmet'
import { SafeExceptionFilter, bffClientIp, corsOriginCheck, parseCorsOrigins, requestLogger, validateEnv } from './modules/panel-auth/security/hardening'

async function bootstrap() {
  const logger = new Logger('Boot')

  // Fail-fast: em producao recusa SECRETKEY ausente/curta/placeholder (nunca imprime o valor).
  const envErrors = validateEnv(process.env)
  if (envErrors.length) {
    for (const e of envErrors) console.error(`[FATAL] ${e}`)
    process.exit(1)
  }
  if (process.env.NODE_ENV !== 'production' && (process.env.SECRETKEY ?? '').length < 32) {
    logger.warn('SECRETKEY com menos de 32 caracteres (em producao o boot seria recusado).')
  }

  const app = await NestFactory.create<NestExpressApplication>(AppModule)

  // Express confia so em proxies conhecidos (ver client-ip.util / TRUSTED_PROXY_CIDRS).
  app.set('trust proxy', (ip: string) => isTrustedProxyIp(ip))

  app.disable('x-powered-by')
  app.use(bffClientIp()) // IP real do usuario vindo do BFF autenticado (throttler e auditoria usam req.ip)
  app.use(requestLogger()) // so metodo/caminho/status/duracao: nunca corpo, query, Authorization ou telefone.
  app.use(
    helmet({
      // API pura (JSON): nada de recurso embutido, nada de iframe.
      contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"], baseUri: ["'none'"], formAction: ["'none'"] } },
      referrerPolicy: { policy: 'no-referrer' },
      crossOriginResourcePolicy: { policy: 'same-site' },
      crossOriginEmbedderPolicy: false,
      hsts: { maxAge: 15552000, includeSubDomains: true },
    }),
  )
  app.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store')
    next()
  })
  app.useGlobalFilters(new SafeExceptionFilter())
  app.use(compression({ threshold: 1024 }))
  app.use(cookieParser())

  const bodyLimit = process.env.BODY_LIMIT || '1mb'

  // rawBody so para as rotas de webhook que validam HMAC (ver raw-body.util).
  app.use(
    json({
      limit: bodyLimit,
      verify: (req: any, _res, buf) => {
        const divergencia = captureRawBody(req, buf)
        if (divergencia) logger.error(divergencia)
      },
    }),
  )
  app.use(urlencoded({ limit: bodyLimit, extended: true }))

  app.useGlobalPipes(new HdmValidationPipe({ transform: true }, process.env.VALIDATION_WHITELIST_DISABLED !== 'true'))

  // CORS: NEGA POR PADRAO. So origens EXATAS de CORS_ORIGINS (virgula). Sem curinga, sem "localhost" implicito:
  // em dev, liste http://localhost:3000 explicitamente.
  const allowedOrigins = parseCorsOrigins(process.env.CORS_ORIGINS)
  app.enableCors({
    origin: corsOriginCheck(allowedOrigins),
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'X-Signature', 'X-Hub-Signature-256', 'X-Webhook-Signature'],
    credentials: true,
    maxAge: 600,
  })

  const port = process.env.PORT ?? 5002
  // HOST=127.0.0.1 restringe ao loopback (recomendado para rodar local).
  if (process.env.HOST) await app.listen(port, process.env.HOST)
  else await app.listen(port)
  logger.log(`listening on ${port}`)

  const shutdown = async (signal: string) => {
    logger.warn(`${signal} recebido, fechando`)
    await app.close()
    process.exit(0)
  }
  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))
}

// Apos uma excecao nao tratada o estado do processo e incerto: registra e encerra, para o gerenciador (PM2/plataforma) reiniciar limpo.
process.on('uncaughtException', (err) => {
  console.error('[FATAL] uncaughtException:', err)
  process.exit(1)
})
process.on('unhandledRejection', (reason) => console.error('[FATAL] unhandledRejection:', reason))

bootstrap().catch((err) => {
  console.error('[FATAL] bootstrap() rejected:', err)
  process.exit(1)
})
