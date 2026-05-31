import { Body, Controller, Post } from '@nestjs/common';
import { submitFeedbackSchema, type SubmitFeedbackDto } from '@reader/shared';
import { CurrentUser, JwtUser } from '../common/current-user.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { AnalyticsService } from '../analytics/analytics.service';
import { FeedbackService } from './feedback.service';

@Controller('feedback')
export class FeedbackController {
  constructor(
    private readonly feedback: FeedbackService,
    private readonly analytics: AnalyticsService,
  ) {}

  /** Submit feedback. The email is taken from the authenticated user. */
  @Post()
  async submit(
    @CurrentUser() user: JwtUser,
    @Body(new ZodValidationPipe(submitFeedbackSchema)) dto: SubmitFeedbackDto,
  ) {
    const created = await this.feedback.create(user.id, user.email, dto.message);
    this.analytics.log('feedback', user.id);
    return created;
  }
}
