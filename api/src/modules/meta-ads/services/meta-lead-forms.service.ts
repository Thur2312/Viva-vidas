import { Injectable, Logger, NotFoundException } from '@nestjs/common'
import * as crypto from 'crypto'
import { PrismaService } from 'src/database/prisma.service'
import { MetaAdsService } from './meta-ads.service'
import { META_API_BASE, META_API_VERSION } from '../constants/meta-ads.constants'

export interface MetaPage {
  id: string
  name: string
  access_token?: string
}

export interface MetaLeadForm {
  id: string
  name: string
  status: string
  locale?: string
  created_time?: string
}

export interface MetaLeadFormMappingDto {
  formId: string
  formName?: string
  pageId?: string
  pageName?: string
  verifyToken?: string
  campaignId: string
  companyId: string
}

@Injectable()
export class MetaLeadFormsService {
  private readonly logger = new Logger(MetaLeadFormsService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly metaAdsService: MetaAdsService,
  ) {}

  /**
   * Lista as Facebook Pages do usuário conectado via OAuth
   */
  async listPages(companyId: string): Promise<MetaPage[]> {
    const { accessToken } = await this.metaAdsService.getMetaCredentials(companyId)

    const url = `${META_API_BASE}/${META_API_VERSION}/me/accounts?fields=id,name,access_token&limit=100&access_token=${accessToken}`
    const response = await fetch(url)

    if (!response.ok) {
      const errorBody = await response.text()
      this.logger.error(`[Meta Lead Forms] Error listing pages: ${errorBody}`)
      throw new NotFoundException('Erro ao buscar páginas do Meta. Verifique a conexão OAuth.')
    }

    const data = await response.json()
    return data.data || []
  }

  /**
   * Lista os formulários de Lead Ads de uma Page específica
   */
  async listForms(companyId: string, pageId: string): Promise<MetaLeadForm[]> {
    const pages = await this.listPages(companyId)
    const page = pages.find(p => p.id === pageId)

    if (!page) {
      throw new NotFoundException(`Página ${pageId} não encontrada ou sem acesso`)
    }

    // Usar page access token para buscar os forms
    const token = page.access_token || (await this.metaAdsService.getMetaCredentials(companyId)).accessToken
    const url = `${META_API_BASE}/${META_API_VERSION}/${pageId}/leadgen_forms?fields=id,name,status,locale,created_time&limit=100&access_token=${token}`

    const response = await fetch(url)

    if (!response.ok) {
      const errorBody = await response.text()
      this.logger.error(`[Meta Lead Forms] Error listing forms for page ${pageId}: ${errorBody}`)
      throw new NotFoundException('Erro ao buscar formulários da página. Verifique as permissões.')
    }

    const data = await response.json()
    return data.data || []
  }

  /**
   * Lista todos os mapeamentos de forms → campanhas de uma empresa
   */
  async listMappings(companyId: string) {
    return this.prisma.metaLeadFormMapping.findMany({
      where: { companyId, deleted_at: null },
      orderBy: { createdAt: 'desc' },
    })
  }

  /**
   * Lista os mapeamentos de uma campanha específica
   */
  async listMappingsByCampaign(campaignId: string, companyId: string) {
    return this.prisma.metaLeadFormMapping.findMany({
      where: { campaignId, companyId, deleted_at: null },
      orderBy: { createdAt: 'desc' },
    })
  }

  /**
   * Vincula um formulário Meta a uma campanha HDM
   */
  async createMapping(dto: MetaLeadFormMappingDto) {
    // Verificar se já existe mapeamento para este form (mesmo soft-deleted)
    const existing = await this.prisma.metaLeadFormMapping.findFirst({
      where: { formId: dto.formId, companyId: dto.companyId },
    })

    let mapping
    if (existing) {
      // Se estava soft-deleted, reativar. Se não, atualizar campanha.
      mapping = await this.prisma.metaLeadFormMapping.update({
        where: { id: existing.id },
        data: {
          campaignId: dto.campaignId,
          formName: dto.formName || existing.formName,
          pageId: dto.pageId || existing.pageId,
          pageName: dto.pageName || existing.pageName,
          verifyToken: dto.verifyToken !== undefined ? dto.verifyToken : existing.verifyToken,
          deleted_at: null,
        },
      })
    } else {
      mapping = await this.prisma.metaLeadFormMapping.create({
        data: {
          formId: dto.formId,
          formName: dto.formName || '',
          pageId: dto.pageId || '',
          pageName: dto.pageName || '',
          verifyToken: dto.verifyToken,
          campaignId: dto.campaignId,
          companyId: dto.companyId,
        },
      })
    }

    // A entrega de leadgen exige a página inscrita no app (POST subscribed_apps).
    // Não-fatal: falha aqui não pode impedir o vínculo (página pode ser inscrita manualmente).
    if (mapping.pageId) {
      await this.subscribePageToLeadgen(dto.companyId, mapping.pageId)
    }

    return mapping
  }

  /**
   * Inscreve a página no campo leadgen do app (POST /{page-id}/subscribed_apps).
   * Sem isso a Meta NÃO entrega webhooks de leadgen — a inscrição se perde quando
   * o OAuth é desconectado/reautorizado. Não-fatal: retorna false e loga em erro.
   */
  async subscribePageToLeadgen(companyId: string, pageId: string): Promise<boolean> {
    try {
      const { accessToken } = await this.metaAdsService.getMetaCredentials(companyId)
      if (!accessToken) {
        this.logger.warn(`[Meta Leads] Sem access token para inscrever página ${pageId} (company=${companyId})`)
        return false
      }

      const pageResp = await fetch(
        `${META_API_BASE}/${META_API_VERSION}/${pageId}?fields=access_token&access_token=${accessToken}`,
      )
      const pageData = await pageResp.json()
      if (!pageData?.access_token) {
        this.logger.warn(
          `[Meta Leads] Sem page token para inscrever página ${pageId}: ${JSON.stringify(pageData?.error || pageData)}`,
        )
        return false
      }

      const subResp = await fetch(
        `${META_API_BASE}/${META_API_VERSION}/${pageId}/subscribed_apps?subscribed_fields=leadgen&access_token=${pageData.access_token}`,
        { method: 'POST' },
      )
      const subData = await subResp.json()
      if (subData?.success) {
        this.logger.log(`[Meta Leads] Página ${pageId} inscrita no campo leadgen (company=${companyId})`)
        return true
      }

      this.logger.warn(
        `[Meta Leads] Falha ao inscrever página ${pageId}: ${JSON.stringify(subData?.error || subData)}`,
      )
      return false
    } catch (error) {
      this.logger.warn(`[Meta Leads] Erro ao inscrever página ${pageId}: ${error.message}`)
      return false
    }
  }

  /**
   * Reinscreve todas as páginas com mapeamento ativo da empresa.
   * Chamado após reconexão OAuth (a reautorização derruba a inscrição anterior).
   */
  async resubscribeMappedPages(companyId: string): Promise<void> {
    const mappings = await this.prisma.metaLeadFormMapping.findMany({
      where: { companyId, deleted_at: null, pageId: { not: '' } },
      select: { pageId: true },
      distinct: ['pageId'],
    })

    for (const { pageId } of mappings) {
      await this.subscribePageToLeadgen(companyId, pageId)
    }
  }

  /**
   * Remove o vínculo de um formulário (soft delete)
   */
  async deleteMapping(id: number, companyId: string) {
    const mapping = await this.prisma.metaLeadFormMapping.findFirst({
      where: { id, companyId, deleted_at: null },
    })

    if (!mapping) {
      throw new NotFoundException('Mapeamento não encontrado')
    }

    return this.prisma.metaLeadFormMapping.update({
      where: { id },
      data: { deleted_at: new Date() },
    })
  }

  /**
   * Busca a campanha vinculada a um form_id
   * Usado pelo webhook de Meta Leads
   */
  async findCampaignByFormId(formId: string, companyId: string): Promise<string | null> {
    const mapping = await this.prisma.metaLeadFormMapping.findFirst({
      where: { formId, companyId, deleted_at: null },
      select: { campaignId: true },
    })

    return mapping?.campaignId || null
  }

  /**
   * Busca ou cria o verify token da campanha.
   * Gera automaticamente se não existir.
   */
  async getOrCreateCampaignVerifyToken(campaignId: string, companyId: string): Promise<string> {
    const campaign = await this.prisma.campaigns.findFirst({
      where: { campaignId, companyId },
      select: { metaLeadsVerifyToken: true },
    })

    if (!campaign) {
      throw new NotFoundException('Campanha não encontrada')
    }

    if (campaign.metaLeadsVerifyToken) {
      return campaign.metaLeadsVerifyToken
    }

    // Auto-gerar token
    const token = crypto.randomBytes(24).toString('base64url')

    await this.prisma.campaigns.update({
      where: { campaignId },
      data: { metaLeadsVerifyToken: token },
    })

    return token
  }

  /**
   * Busca ou cria o hdmMetaLeadToken da campanha (token da URL do webhook).
   */
  async getOrCreateHdmMetaLeadToken(campaignId: string, companyId: string): Promise<string> {
    const campaign = await this.prisma.campaigns.findFirst({
      where: { campaignId, companyId },
      select: { hdmMetaLeadToken: true, name: true },
    })

    if (!campaign) {
      throw new NotFoundException('Campanha não encontrada')
    }

    if (campaign.hdmMetaLeadToken) {
      return campaign.hdmMetaLeadToken
    }

    // Gera token: 3 primeiras letras do nome + 6 chars hex (ex: con9a0081)
    const prefix = (campaign.name || 'cam')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
      .slice(0, 3)
      .padEnd(3, 'x')

    const suffix = crypto.randomBytes(4).toString('hex').slice(0, 6)
    const token = `${prefix}${suffix}`

    await this.prisma.campaigns.update({
      where: { campaignId },
      data: { hdmMetaLeadToken: token },
    })

    return token
  }

  /**
   * Regenera o hdmMetaLeadToken (invalida a URL anterior).
   */
  async regenerateHdmMetaLeadToken(campaignId: string, companyId: string): Promise<string> {
    const campaign = await this.prisma.campaigns.findFirst({
      where: { campaignId, companyId },
      select: { name: true },
    })

    if (!campaign) {
      throw new NotFoundException('Campanha não encontrada')
    }

    const prefix = (campaign.name || 'cam')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
      .slice(0, 3)
      .padEnd(3, 'x')

    const suffix = crypto.randomBytes(4).toString('hex').slice(0, 6)
    const token = `${prefix}${suffix}`

    await this.prisma.campaigns.update({
      where: { campaignId },
      data: { hdmMetaLeadToken: token },
    })

    return token
  }

  /**
   * Atualiza o verify token da campanha com um valor customizado.
   */
  async updateCampaignVerifyToken(campaignId: string, companyId: string, verifyToken: string): Promise<string> {
    const campaign = await this.prisma.campaigns.findFirst({
      where: { campaignId, companyId },
      select: { campaignId: true },
    })

    if (!campaign) {
      throw new NotFoundException('Campanha não encontrada')
    }

    await this.prisma.campaigns.update({
      where: { campaignId },
      data: { metaLeadsVerifyToken: verifyToken },
    })

    return verifyToken
  }

  /**
   * Lista todos os verify tokens válidos de campanhas de uma empresa.
   * Usado pelo webhook para validar handshake.
   */
  async listCampaignVerifyTokensByCompanyId(companyId: string): Promise<string[]> {
    const campaigns = await this.prisma.campaigns.findMany({
      where: {
        companyId,
        deleted_at: null,
        metaLeadsVerifyToken: { not: null },
      },
      select: { metaLeadsVerifyToken: true },
    })

    return campaigns
      .map(c => c.metaLeadsVerifyToken)
      .filter((t): t is string => !!t)
  }

  /**
   * Busca a campanha pelo verify token (para roteamento no webhook).
   */
  async findCampaignByVerifyToken(verifyToken: string, companyId: string): Promise<string | null> {
    const campaign = await this.prisma.campaigns.findFirst({
      where: {
        companyId,
        metaLeadsVerifyToken: verifyToken,
        deleted_at: null,
      },
      select: { campaignId: true },
    })

    return campaign?.campaignId || null
  }
}
