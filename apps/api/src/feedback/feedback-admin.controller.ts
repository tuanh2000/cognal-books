import { Body, Controller, Get, Param, Patch, Query, UseGuards } from '@nestjs/common';
import { AdminGuard } from '../common/admin.guard';
import { FeedbackService } from './feedback.service';

/** Admin-only feedback management for the dashboard. */
@UseGuards(AdminGuard)
@Controller('admin/feedback')
export class FeedbackAdminController {
  constructor(private readonly feedback: FeedbackService) {}

  @Get()
  list(
    @Query('status') status?: 'open' | 'resolved' | 'all',
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.feedback.list(
      status ?? 'all',
      limit ? Number(limit) : 25,
      offset ? Number(offset) : 0,
    );
  }

  @Patch(':id')
  setResolved(@Param('id') id: string, @Body() body: { resolved?: boolean }) {
    return this.feedback.setResolved(id, body?.resolved !== false);
  }
}
