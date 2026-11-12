import { Body, Controller, Get, Post, Query, Req } from '@nestjs/common'
import { IsISO8601, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator'
import { Type } from 'class-transformer'
import { NoTenant } from '../auth/no-tenant.decorator'
import { Roles } from '../panel-auth/roles.decorator'
import { requestCtx } from '../pilot/compliance/audit.service'
import { CalendarService } from './calendar.service'

export class SlotsQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) limit?: number
}

export class BookDto {
  @IsUUID() leadId!: string
  @IsISO8601() start!: string
}

/** Agenda (JWT). Ver status e horarios: qualquer papel. Agendar: manager ou owner. */
@Controller('pilot/calendar')
export class CalendarController {
  constructor(private readonly cal: CalendarService) {}

  @NoTenant() @Roles('viewer') @Get('status')
  status() { return this.cal.status() }

  @NoTenant() @Roles('viewer') @Get('slots')
  slots(@Query() q: SlotsQuery) { return this.cal.slots(q.limit ?? 20) }

  @NoTenant() @Roles('manager') @Post('book')
  book(@Body() dto: BookDto, @Req() req: any) { return this.cal.book(dto.leadId, dto.start, requestCtx(req)) }
}
