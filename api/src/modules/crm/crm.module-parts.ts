import { CrmController } from './crm.controller'
import { crmEnabled } from './crm.rules'
import { CrmService } from './crm.service'
import { CRM_ADAPTER, DisabledCrm } from './crm.types'
import { PipedriveAdapter } from './pipedrive.adapter'

export { CrmController }
/** Providers do CRM, registrados em PilotModule (precisam de PgService, PilotService, AuditService e AdvisoryLockService). */
export const CRM_PROVIDERS = [
  CrmService,
  { provide: CRM_ADAPTER, useFactory: () => (crmEnabled() ? new PipedriveAdapter() : new DisabledCrm()) },
]
