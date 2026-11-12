export interface CrmStatus {
  provider: string
  configured: boolean
  missing: string[]
}

/** Erro da API do CRM. `status` 0 = falha de rede/timeout. Nunca carrega o corpo da resposta (pode ter dado pessoal). */
export class CrmApiError extends Error {
  constructor(public readonly status: number, what = 'crm') {
    super(`${what}: HTTP ${status}`)
  }
}

export class CrmNotConfiguredError extends Error {
  constructor(public readonly missing: string[]) {
    super(`CRM nao configurado: falta ${missing.join(', ')}`)
  }
}

export interface DealPatch {
  stageId?: number
  value?: number
  status?: 'open' | 'won' | 'lost'
}

/** Contrato minimo com o CRM. Hoje so o Pipedrive implementa; sem credenciais vale o DisabledCrm (falha fechado). */
export interface CrmAdapter {
  readonly id: string
  status(): CrmStatus
  findPersonByPhone(phone: string): Promise<number | null>
  createPerson(p: { name: string | null; phone: string }): Promise<number>
  findOpenDeal(personId: number): Promise<number | null>
  createDeal(personId: number, d: DealPatch & { title: string }): Promise<number>
  updateDeal(dealId: number, d: DealPatch): Promise<void>
  addNote(dealId: number, text: string): Promise<void>
  /** Direito de exclusao (LGPD): apaga a pessoa no CRM. */
  deletePerson(personId: number): Promise<void>
}

export const CRM_ADAPTER = Symbol('CRM_ADAPTER')

export class DisabledCrm implements CrmAdapter {
  readonly id = 'disabled'
  constructor(private readonly missing: string[] = ['CRM_PROVIDER (use "pipedrive")']) {}
  status(): CrmStatus { return { provider: this.id, configured: false, missing: this.missing } }
  private no(): never { throw new CrmNotConfiguredError(this.missing) }
  async findPersonByPhone(): Promise<number | null> { return this.no() }
  async createPerson(): Promise<number> { return this.no() }
  async findOpenDeal(): Promise<number | null> { return this.no() }
  async createDeal(): Promise<number> { return this.no() }
  async updateDeal(): Promise<void> { return this.no() }
  async addNote(): Promise<void> { return this.no() }
  async deletePerson(): Promise<void> { return this.no() }
}
