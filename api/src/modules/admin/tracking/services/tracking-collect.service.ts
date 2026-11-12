import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common'
import { PrismaService } from 'src/database/prisma.service'
import { CollectEventDto } from '../dto/create-tracking.dto'
import { formatName, formatPhone } from 'src/shared/util/utils'
import { TrackingEventService } from './tracking-event.service'
import { TrackingLeadService } from './tracking-lead.service'
import { TrackingAuthService } from './tracking-auth.service'
import { isCdnEdgeIp, isTrustedProxyIp, normalizeIp } from 'src/shared/util/client-ip.util'

@Injectable()
export class TrackingCollectService {
  private readonly logger = new Logger(TrackingCollectService.name)

  constructor(
    private prisma: PrismaService,
    private trackingEventService: TrackingEventService,
    private trackingLeadService: TrackingLeadService,
    private trackingAuthService: TrackingAuthService,
  ) {}

  private sanitize(v: unknown, maxLen = 200): string | null {
    if (!v || typeof v !== 'string') return null
    const trimmed = v.trim().substring(0, maxLen)
    return trimmed || null
  }

  private sanitizeEmail(v: unknown): string | null {
    if (!v || typeof v !== 'string') return null
    const clean = v.toLowerCase().trim().substring(0, 200)
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean) ? clean : null
  }

  /** IP do visitante, ou `null` quando o que chegou e borda de CDN ou proxy nosso. */
  private visitorIp(value: string | null): string | null {
    const ip = normalizeIp(value)
    if (!ip) return null
    return isCdnEdgeIp(ip) || isTrustedProxyIp(ip) ? null : ip
  }

  private isValidUUID(v: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v)
  }

  async collectEvent(dto: CollectEventDto, subdomain: string) {
    // Validar campos obrigatórios
    const clientHash = dto.client_hash?.toLowerCase()
    if (!clientHash || !/^[a-z0-9_-]{2,50}$/i.test(clientHash)) {
      throw new HttpException('client_hash inválido', HttpStatus.BAD_REQUEST)
    }
    if (!dto.visitor_id || !this.isValidUUID(dto.visitor_id)) {
      throw new HttpException('visitor_id inválido', HttpStatus.BAD_REQUEST)
    }
    if (!dto.session_id || !this.isValidUUID(dto.session_id)) {
      throw new HttpException('session_id inválido', HttpStatus.BAD_REQUEST)
    }
    if (!dto.event || typeof dto.event !== 'string' || dto.event.length > 50) {
      throw new HttpException('event inválido', HttpStatus.BAD_REQUEST)
    }

    const ip = dto.server_ip || null

    // Parse form_data JSON para JSONB (validar e limitar tamanho)
    let formDataJsonb: string | null = null
    if (dto.form_data) {
      try {
        const parsed = JSON.parse(dto.form_data)
        const sanitized = JSON.stringify(parsed).substring(0, 10000)
        formDataJsonb = sanitized
      } catch {
        formDataJsonb = null
      }
    }

    // 1) INSERT no tracking_events (tabela v5+)
    await this.prisma.$queryRawUnsafe(
      `INSERT INTO tracking_events (
        client_hash, campaign_id, form_config_id,
        visitor_id, session_id, event,
        page, url, referrer,
        button_text, button_tag, button_href, button_id, button_classes,
        button_track,
        click_x, click_y, page_x, page_y, viewport_w, viewport_h, scroll_y,
        scroll_pct,
        time_on_page_ms,
        form_nome, form_email, form_telefone, form_id, form_action,
        form_data,
        fbc, fbclid, fbp,
        utm_source, utm_medium, utm_campaign, utm_content, utm_term,
        ua, ip, client_ts
      ) VALUES (
        $1,$2,$3,$4::uuid,$5::uuid,$6,$7,$8,$9,$10,$11,$12,$13,$14,
        $15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30::jsonb,
        $31,$32,$33,$34,$35,$36,$37,$38,$39,$40::inet,$41::timestamptz
      )`,
      clientHash,
      this.sanitize(dto.campaign_id, 100),
      this.sanitize(dto.form_config_id, 100),
      dto.visitor_id,
      dto.session_id,
      dto.event,
      this.sanitize(dto.page, 500),
      this.sanitize(dto.url, 2000),
      this.sanitize(dto.referrer, 2000),
      this.sanitize(dto.button_text, 150),
      this.sanitize(dto.button_tag, 20),
      this.sanitize(dto.button_href, 2000),
      this.sanitize(dto.button_id, 100),
      this.sanitize(dto.button_classes, 300),
      this.sanitize(dto.button_track, 200),
      typeof dto.click_x === 'number' ? dto.click_x : null,
      typeof dto.click_y === 'number' ? dto.click_y : null,
      typeof dto.page_x === 'number' ? dto.page_x : null,
      typeof dto.page_y === 'number' ? dto.page_y : null,
      typeof dto.viewport_w === 'number' ? dto.viewport_w : null,
      typeof dto.viewport_h === 'number' ? dto.viewport_h : null,
      typeof dto.scroll_y === 'number' ? dto.scroll_y : null,
      typeof dto.scroll_pct === 'number' ? dto.scroll_pct : null,
      typeof dto.time_on_page_ms === 'number' ? dto.time_on_page_ms : null,
      this.sanitize(dto.form_nome),
      this.sanitizeEmail(dto.form_email),
      this.sanitize(dto.form_telefone, 30),
      this.sanitize(dto.form_id, 100),
      this.sanitize(dto.form_action, 2000),
      formDataJsonb,
      this.sanitize(dto.fbc, 500),
      this.sanitize(dto.fbclid, 500),
      this.sanitize(dto.fbp, 500),
      this.sanitize(dto.utm_source, 200),
      this.sanitize(dto.utm_medium, 200),
      this.sanitize(dto.utm_campaign, 200),
      this.sanitize(dto.utm_content, 200),
      this.sanitize(dto.utm_term, 200),
      this.sanitize(dto.ua, 500),
      ip,
      dto.timestamp || new Date().toISOString(),
    )

    // 2) Identity stitching: se form_submit com email, upsert na visitor_identities
    const email = this.sanitizeEmail(dto.form_email)
    if (email && dto.event === 'form_submit') {
      await this.prisma.$queryRawUnsafe(
        `INSERT INTO visitor_identities (
          client_hash, campaign_id, form_config_id,
          visitor_id, email, nome, telefone, ip, fbc, fbp
        ) VALUES ($1,$2,$3,$4::uuid,$5,$6,$7,$8::inet,$9,$10)
        ON CONFLICT (client_hash, visitor_id, email) DO UPDATE SET
          nome = COALESCE(EXCLUDED.nome, visitor_identities.nome),
          telefone = COALESCE(EXCLUDED.telefone, visitor_identities.telefone),
          fbc = COALESCE(EXCLUDED.fbc, visitor_identities.fbc),
          fbp = COALESCE(EXCLUDED.fbp, visitor_identities.fbp),
          campaign_id = COALESCE(EXCLUDED.campaign_id, visitor_identities.campaign_id),
          form_config_id = COALESCE(EXCLUDED.form_config_id, visitor_identities.form_config_id),
          updated_at = NOW()`,
        clientHash,
        this.sanitize(dto.campaign_id, 100),
        this.sanitize(dto.form_config_id, 100),
        dto.visitor_id,
        email,
        this.sanitize(dto.form_nome),
        this.sanitize(dto.form_telefone, 30),
        ip,
        this.sanitize(dto.fbc, 500),
        this.sanitize(dto.fbp, 500),
      )

      // 3) Também registrar no Tracking antigo + criar lead (backward compat)
      // Buscar empresa pelo subdomain para manter integração com triggers/leads
      try {
        const company = await this.prisma.client.companies.findFirst({
          where: { subdomain, status: 'ACTIVE' },
        })

        if (company && dto.campaign_id) {
          const campaign = await this.prisma.campaigns.findFirst({
            where: { campaignId: dto.campaign_id, companyId: company.id },
            select: { campaignId: true, companyId: true, columnSetId: true, name: true },
          })

          if (campaign) {
            const formattedPhone = dto.form_telefone ? formatPhone(dto.form_telefone) : ''
            const formattedName = dto.form_nome ? formatName(dto.form_nome) : ''

            // ANTES do emit, de propósito: o `emitTrackingEvent` monta o payload
            // LENDO o lead, então enriquecer depois deixaria justamente o primeiro
            // evento — o OPTIN, que é o mais valioso — sair sem `fbc`/`fbp`/UA.
            //
            // Auto-create idempotente — defesa contra race está dentro do service (Redis lock + P2002 catch)
            //
            // O bloco de navegador é o que o `tracker.js` acabou de mandar e que
            // ninguém mais tem como obter depois: `_fbp` e `_fbc` são cookies do
            // domínio do cliente, e o `fbclid` só existe na query da landing.
            // Até 28/08/2026 eles morriam aqui — daí `fbc` em 0% nos eventos Meta.
            //
            // `formattedName`: mesmo motivo. Até aqui o nome era gravado só na
            // tabela `Tracking` (linha abaixo) e nunca no Lead — o evento OPTIN saía
            // pro trigger/Meta CAPI só com e-mail, mesmo quando o formulário já
            // mandava o nome nesta mesma requisição.
            await this.trackingLeadService.findOrCreateLeadFromTracking(
              email,
              campaign,
              formattedPhone,
              {
                utm_source: dto.utm_source,
                utm_medium: dto.utm_medium,
                utm_campaign: dto.utm_campaign,
                utm_content: dto.utm_content,
                utm_term: dto.utm_term,
              },
              {
                fbc: this.sanitize(dto.fbc, 500),
                fbp: this.sanitize(dto.fbp, 500),
                fbclid: this.sanitize(dto.fbclid, 500),
                userAgent: this.sanitize(dto.ua, 500),
                sourceUrl: this.sanitize(dto.url, 2000),
                // Mesma regra do `TransformLeadDataPipe`: endereco de borda ou de
                // proxy nosso nao e do visitante, e ir para a Meta como se fosse
                // manda a conversao para o pais errado. Melhor vazio que errado.
                leadIp: this.visitorIp(ip),
              },
              formattedName,
            )

            // Dedup: evita OPTIN duplicado quando múltiplos scripts disparam no mesmo submit
            const alreadyHasOptin = await this.trackingAuthService.hasRecentOptin(email, campaign.companyId)

            if (!alreadyHasOptin) {
              // Criar tracking na tabela antiga para manter triggers funcionando
              await this.prisma.tracking.create({
                data: {
                  sessionId: dto.visitor_id,
                  campaignId: campaign.campaignId,
                  companyId: campaign.companyId,
                  email: email,
                  name: formattedName,
                  phone: formattedPhone,
                  action: 'OPTIN',
                  ip: ip || '',
                  url: dto.url || '',
                  referral: dto.referrer || '',
                  device: dto.ua || '',
                  timestamp: new Date(),
                  timestamp_2: Math.floor(Date.now() / 1000),
                  fbc: dto.fbc || '',
                  utm_source: dto.utm_source || '',
                  utm_medium: dto.utm_medium || '',
                  utm_campaign: dto.utm_campaign || '',
                  utm_content: dto.utm_content || '',
                  utm_term: dto.utm_term || '',
                },
              })

              // Emitir evento para triggers
              this.trackingEventService.emitTrackingEvent({
                companyId: campaign.companyId,
                campaignId: campaign.campaignId,
                email,
                phone: formattedPhone,
                action: 'OPTIN',
              })
            }

          }
        }
      } catch (err) {
        this.logger.error(`[collect] Backward compat error: ${err.message}`)
      }
    }

    return { ok: true }
  }
}
