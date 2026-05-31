import { Module } from '@nestjs/common';
import { FeedbackService } from './feedback.service';
import { FeedbackController } from './feedback.controller';
import { FeedbackAdminController } from './feedback-admin.controller';

@Module({
  controllers: [FeedbackController, FeedbackAdminController],
  providers: [FeedbackService],
})
export class FeedbackModule {}
