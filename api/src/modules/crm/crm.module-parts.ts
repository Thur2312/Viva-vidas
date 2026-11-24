import { CrmController } from './crm.controller'
import { CrmService } from './crm.service'
import { CRM_ADAPTER } from './crm.types'
import { DynamicCrm } from '../calendar/dynamic-adapters'

export { CrmController }
/** Providers do CRM, registrados em PilotModule (precisam de PgService, PilotService, AuditService e AdvisoryLockService). */
export const CRM_PROVIDERS = [
  CrmService,
  { provide: CRM_ADAPTER, useFactory: () => new DynamicCrm() },
]
