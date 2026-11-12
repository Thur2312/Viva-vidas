import { AdvisoryLockService } from './advisory-lock.service'
import { BroadcastsController } from './broadcasts.controller'
import { BroadcastsService } from './broadcasts.service'
import { BroadcastsWorker } from './broadcasts.worker'
import { HealthService } from './health.service'
import { TemplatesService } from './templates.service'

export { BroadcastsController }
/** Providers do módulo de disparos, registrados em PilotModule com uma única linha. */
export const BROADCASTS_PROVIDERS = [AdvisoryLockService, HealthService, TemplatesService, BroadcastsService, BroadcastsWorker]
