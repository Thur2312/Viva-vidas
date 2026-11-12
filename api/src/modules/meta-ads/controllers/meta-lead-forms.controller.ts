import { Controller, Get, Post, Put, Delete, Body, Query, Param, ParseIntPipe, UseGuards } from '@nestjs/common'
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger'
import { JwtAuthGuard } from 'src/modules/auth/jwt-auth.guard'
import { MetaLeadFormsService, MetaLeadFormMappingDto } from '../services/meta-lead-forms.service'

@ApiTags('Meta ADS')
@Controller('meta-ads')
export class MetaLeadFormsController {
  constructor(
    private readonly metaLeadFormsService: MetaLeadFormsService,
  ) {}

  @Get('lead-forms/pages')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Lista Facebook Pages da empresa conectada' })
  @ApiQuery({ name: 'companyId', required: true })
  async listPages(@Query('companyId') companyId: string) {
    return this.metaLeadFormsService.listPages(companyId)
  }

  @Get('lead-forms/forms/:pageId')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Lista formularios de Lead Ads de uma Page' })
  @ApiQuery({ name: 'companyId', required: true })
  async listForms(
    @Param('pageId') pageId: string,
    @Query('companyId') companyId: string,
  ) {
    return this.metaLeadFormsService.listForms(companyId, pageId)
  }

  @Get('lead-forms/mappings')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Lista vinculos form → campanha de uma empresa' })
  @ApiQuery({ name: 'companyId', required: true })
  @ApiQuery({ name: 'campaignId', required: false })
  async listMappings(
    @Query('companyId') companyId: string,
    @Query('campaignId') campaignId?: string,
  ) {
    if (campaignId) {
      return this.metaLeadFormsService.listMappingsByCampaign(campaignId, companyId)
    }
    return this.metaLeadFormsService.listMappings(companyId)
  }

  @Post('lead-forms/mappings')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Vincula um formulario Meta a uma campanha HDM' })
  async createMapping(@Body() dto: MetaLeadFormMappingDto) {
    return this.metaLeadFormsService.createMapping(dto)
  }

  @Delete('lead-forms/mappings/:id')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Remove vinculo de formulario' })
  @ApiQuery({ name: 'companyId', required: true })
  async deleteMapping(
    @Param('id', ParseIntPipe) id: number,
    @Query('companyId') companyId: string,
  ) {
    return this.metaLeadFormsService.deleteMapping(id, companyId)
  }

  @Get('lead-forms/campaign-verify-token')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Busca ou cria o verify token da campanha' })
  @ApiQuery({ name: 'campaignId', required: true })
  @ApiQuery({ name: 'companyId', required: true })
  async getCampaignVerifyToken(
    @Query('campaignId') campaignId: string,
    @Query('companyId') companyId: string,
  ) {
    const verifyToken = await this.metaLeadFormsService.getOrCreateCampaignVerifyToken(campaignId, companyId)
    return { verifyToken }
  }

  @Put('lead-forms/campaign-verify-token')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Atualiza o verify token da campanha' })
  async updateCampaignVerifyToken(
    @Body() dto: { campaignId: string; companyId: string; verifyToken: string },
  ) {
    const verifyToken = await this.metaLeadFormsService.updateCampaignVerifyToken(dto.campaignId, dto.companyId, dto.verifyToken)
    return { verifyToken }
  }

  @Get('lead-forms/campaign-webhook-token')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Busca ou cria o hdmMetaLeadToken da campanha (token da URL)' })
  @ApiQuery({ name: 'campaignId', required: true })
  @ApiQuery({ name: 'companyId', required: true })
  async getCampaignWebhookToken(
    @Query('campaignId') campaignId: string,
    @Query('companyId') companyId: string,
  ) {
    const hdmMetaLeadToken = await this.metaLeadFormsService.getOrCreateHdmMetaLeadToken(campaignId, companyId)
    return { hdmMetaLeadToken }
  }

  @Put('lead-forms/campaign-webhook-token')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Regenera o hdmMetaLeadToken da campanha' })
  async regenerateCampaignWebhookToken(
    @Body() dto: { campaignId: string; companyId: string },
  ) {
    const hdmMetaLeadToken = await this.metaLeadFormsService.regenerateHdmMetaLeadToken(dto.campaignId, dto.companyId)
    return { hdmMetaLeadToken }
  }
}
