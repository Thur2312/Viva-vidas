import { Injectable, Logger } from '@nestjs/common'
import { PrismaService } from 'src/database/prisma.service'
import { triggerEventBus } from 'src/shared/events/trigger-event-bus'
import { TrackingActionConfigService } from './tracking-action-config.service'

@Injectable()
export class TrackingEventService {
  private readonly logger = new Logger(TrackingEventService.name)

  constructor(
    private prisma: PrismaService,
    private actionConfig: TrackingActionConfigService,
  ) {}

  /**
   * Emits a tracking event to the trigger event bus so triggers
   * with entityType=TRACKING can react to it.
   * Enriches payload with full lead data for Meta CAPI Advanced Matching.
   */
  async emitTrackingEvent(
    tracking: { companyId: string; campaignId?: string; email?: string; phone?: string; action?: string },
  ) {
    try {
      // Build lead lookup condition: by email or phone
      const leadWhereCondition = tracking.email
        ? { email: tracking.email, campaign: { companyId: tracking.companyId } }
        : tracking.phone
          ? { phone: tracking.phone, campaign: { companyId: tracking.companyId } }
          : null

      // Catalogo da acao (nome na Meta + peso). Resolvido AQUI, junto do lead, e
      // nao na hora de enviar: e o que coloca o peso no payload antes de as
      // condicoes rodarem, tornando `tracking.value >= 50` uma condicao de
      // verdade em vez de comparacao contra `undefined`.
      //
      // A campanha do proprio tracking escolhe o escopo: o mesmo `optin` pode
      // valer 80 no lancamento e 30 no blog. Sem campanha, cai no padrao da
      // empresa.
      //
      // O `.catch()` aqui nao e redundante com o try/catch interno do
      // `resolve()`: sem ele, uma rejeicao levaria o `emitTrackingEvent` inteiro
      // para o catch de baixo e o evento NAO seria emitido — catalogo quebrado
      // viraria trigger que nao dispara e conversao perdida, em silencio. Ele
      // tambem evita unhandled rejection se o lookup do lead estourar primeiro,
      // porque a promise ja esta em voo antes do `await`.
      const actionConfigPromise = this.actionConfig
        .resolve(tracking.companyId, tracking.campaignId, tracking.action)
        .catch(() => null)

      // Fetch full lead data for enrichment
      const lead = leadWhereCondition
        ? await this.prisma.leads.findFirst({
            where: leadWhereCondition,
            select: {
              id: true,
              name: true,
              email: true,
              phone: true,
              city: true,
              state: true,
              leadIp: true,
              sellerId: true,
              campaignId: true,
              utm_source: true,
              utm_medium: true,
              utm_campaign: true,
              utm_content: true,
              utm_term: true,
              fbc: true,
              gclid: true,
              adset_id: true,
              adset_name: true,
              ad_id: true,
              ad_name: true,
              source: true,
              // Advanced Matching extras
              fbclid: true,
              fbp: true,
              page_id: true,
              form_id: true,
              browser_data: true,
              geo_data: true,
              source_url: true,
              // Contact com dados pessoais
              contacts: {
                select: {
                  cep: true,
                  birthDay: true,
                  birthMonth: true,
                },
                take: 1,
              },
            },
          })
        : null

      const actionConfig = await actionConfigPromise

      // Extract browser_data and geo_data from JSONB
      const browserData = lead?.browser_data as Record<string, any> | null
      const geoData = lead?.geo_data as Record<string, any> | null
      const contact = lead?.contacts?.[0] || null

      // Derive country from geo_data if available
      const geoCountry = geoData?.country_code?.toLowerCase() || geoData?.country?.toLowerCase() || null

      setImmediate(() => {
        triggerEventBus.emitTracking({
          companyId: tracking.companyId,
          eventType: 'CREATED',
          payload: {
            // Map action → eventName (trigger conditions use eventName)
            eventName: tracking.action || null,
            // Map campaignId → leadCampaignId (trigger conditions use leadCampaignId)
            leadCampaignId: tracking.campaignId || null,
            companyId: tracking.companyId,
            campaignId: tracking.campaignId || null,
            // Lead identity
            id: lead?.id || null,
            name: lead?.name || null,
            email: tracking.email || lead?.email || null,
            phone: lead?.phone || null,
            city: lead?.city || null,
            state: lead?.state || null,
            country: 'br',
            geoCountry,
            leadIp: lead?.leadIp || null,
            sellerId: lead?.sellerId ? String(lead.sellerId) : null,
            // UTMs from lead
            utm_source: lead?.utm_source || null,
            utm_medium: lead?.utm_medium || null,
            utm_campaign: lead?.utm_campaign || null,
            utm_content: lead?.utm_content || null,
            utm_term: lead?.utm_term || null,
            fbc: lead?.fbc || null,
            gclid: lead?.gclid || null,
            // Ads data from lead
            adset_id: lead?.adset_id || null,
            adset_name: lead?.adset_name || null,
            ad_id: lead?.ad_id || null,
            ad_name: lead?.ad_name || null,
            // Source
            importSource: lead?.source || null,
            // Advanced Matching extras
            fbclid: lead?.fbclid || null,
            fbp: lead?.fbp || null,
            page_id: lead?.page_id || null,
            form_id: lead?.form_id || null,
            userAgent: browserData?.user_agent || browserData?.userAgent || null,
            // Contact data
            cep: contact?.cep || null,
            birthDay: contact?.birthDay || null,
            birthMonth: contact?.birthMonth || null,
            // Event source URL (obrigatorio para action_source=website)
            sourceUrl: lead?.source_url || null,
            // Catalogo da empresa. Spread condicional de proposito: chave ausente
            // e descartada pelo `shouldSkipWhenAbsent()` do TriggerConditionService,
            // enquanto `null` explicito seria avaliado — e `Number(null)` e 0, o que
            // faria `tracking.value >= 0` casar toda acao sem catalogo.
            ...(actionConfig?.eventValue != null && { value: actionConfig.eventValue }),
            ...(actionConfig?.metaEventName && { metaEventName: actionConfig.metaEventName }),
            ...(actionConfig?.label && { actionLabel: actionConfig.label }),
          },
        })
      })
    } catch (error) {
      this.logger.error(`[Trigger] Failed to emit tracking event: ${error.message}`)
    }
  }
}
