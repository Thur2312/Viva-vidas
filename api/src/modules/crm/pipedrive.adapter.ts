import { CrmAdapter, CrmApiError, CrmStatus, DealPatch } from './crm.types'

const TIMEOUT_MS = 15_000
/** Subdominio da conta (ex.: "alberto" em alberto.pipedrive.com). So letras, numeros e hifen: nada de host arbitrario (SSRF). */
const DOMAIN_RE = /^[a-z0-9](?:[a-z0-9-]{0,60}[a-z0-9])?$/i

/**
 * Pipedrive API v1 por fetch (sem SDK). Token no cabecalho `x-api-token` (nunca na URL: URL vai para log de proxy).
 * ATENCAO: ainda NAO foi exercitado contra o Pipedrive real (sem conta no ambiente de desenvolvimento); so contra
 * o contrato documentado, com fetch simulado nos testes. Confirme os campos na primeira execucao com a conta real.
 */
export class PipedriveAdapter implements CrmAdapter {
  readonly id = 'pipedrive'

  private get domain() { return (process.env.PIPEDRIVE_DOMAIN ?? '').trim() }
  private get token() { return process.env.PIPEDRIVE_API_TOKEN ?? '' }

  status(): CrmStatus {
    const missing: string[] = []
    if (!DOMAIN_RE.test(this.domain)) missing.push('PIPEDRIVE_DOMAIN')
    if (!this.token) missing.push('PIPEDRIVE_API_TOKEN')
    return { provider: this.id, configured: missing.length === 0, missing }
  }

  private async call<T = any>(method: string, path: string, body?: unknown): Promise<T> {
    const s = this.status()
    if (!s.configured) throw new CrmApiError(0, 'nao_configurado')
    let res: Response
    try {
      res = await fetch(`https://${this.domain}.pipedrive.com/api/v1${path}`, {
        method,
        headers: { 'x-api-token': this.token, accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
    } catch {
      throw new CrmApiError(0, `${method} ${path.split('?')[0]}`)
    }
    if (!res.ok) throw new CrmApiError(res.status, `${method} ${path.split('?')[0].replace(/\d+/g, ':id')}`)
    const j = (await res.json().catch(() => null)) as any
    if (!j || j.success === false) throw new CrmApiError(502, 'resposta_invalida')
    return j as T
  }

  async findPersonByPhone(phone: string): Promise<number | null> {
    const j = await this.call(`GET`, `/persons/search?${new URLSearchParams({ term: phone, fields: 'phone', exact_match: 'true', limit: '1' })}`)
    const id = j.data?.items?.[0]?.item?.id
    return Number.isInteger(id) ? id : null
  }

  async createPerson(p: { name: string | null; phone: string }): Promise<number> {
    const j = await this.call('POST', '/persons', { name: p.name?.trim() || 'Lead WhatsApp', phone: [{ value: p.phone, primary: true, label: 'mobile' }] })
    return this.idOf(j)
  }

  async findOpenDeal(personId: number): Promise<number | null> {
    const j = await this.call('GET', `/persons/${personId}/deals?status=open&limit=1`)
    const id = j.data?.[0]?.id
    return Number.isInteger(id) ? id : null
  }

  async createDeal(personId: number, d: DealPatch & { title: string }): Promise<number> {
    const j = await this.call('POST', '/deals', {
      title: d.title, person_id: personId, currency: 'BRL',
      ...(d.stageId ? { stage_id: d.stageId } : {}), ...(d.value != null ? { value: d.value } : {}),
    })
    return this.idOf(j)
  }

  async updateDeal(dealId: number, d: DealPatch): Promise<void> {
    const body = { ...(d.stageId ? { stage_id: d.stageId } : {}), ...(d.status ? { status: d.status } : {}), ...(d.value != null ? { value: d.value } : {}) }
    if (Object.keys(body).length) await this.call('PUT', `/deals/${dealId}`, body)
  }

  async addNote(dealId: number, text: string): Promise<void> {
    await this.call('POST', '/notes', { content: text, deal_id: dealId })
  }

  async deletePerson(personId: number): Promise<void> {
    try {
      await this.call('DELETE', `/persons/${personId}`)
    } catch (e) {
      if (e instanceof CrmApiError && e.status === 404) return // ja nao existe: o objetivo (apagar) esta cumprido
      throw e
    }
  }

  private idOf(j: any): number {
    const id = j?.data?.id
    if (!Number.isInteger(id)) throw new CrmApiError(502, 'resposta_sem_id')
    return id
  }
}
