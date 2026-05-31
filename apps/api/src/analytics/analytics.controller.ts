import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AdminGuard } from '../common/admin.guard';
import { AnalyticsService } from './analytics.service';

/** Admin-only analytics endpoints backing the /admin dashboard. */
@UseGuards(AdminGuard)
@Controller('admin/analytics')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('summary')
  summary(@Query('days') days?: string) {
    return this.analytics.summary(days ? Number(days) : 30);
  }
}
