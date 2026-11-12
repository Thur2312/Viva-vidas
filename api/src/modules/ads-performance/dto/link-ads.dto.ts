import { IsString, IsArray, IsNotEmpty } from 'class-validator'
import { ApiProperty } from '@nestjs/swagger'

export class LinkAdsDto {
  @ApiProperty({ description: 'ID da campanha HDM' })
  @IsString()
  @IsNotEmpty()
  campaignId: string

  @ApiProperty({ description: 'IDs das campanhas externas (Meta) para vincular', type: [String] })
  @IsArray()
  @IsString({ each: true })
  externalCampaignIds: string[]
}

export class UnlinkAdsDto {
  @ApiProperty({ description: 'ID da campanha HDM' })
  @IsString()
  @IsNotEmpty()
  campaignId: string

  @ApiProperty({ description: 'IDs das campanhas externas (Meta) para desvincular', type: [String] })
  @IsArray()
  @IsString({ each: true })
  externalCampaignIds: string[]
}
