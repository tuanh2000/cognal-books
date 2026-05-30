import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { progressSchema, type UpsertProgressDto } from '@reader/shared';
import { CurrentUser, JwtUser } from '../common/current-user.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ReaderService } from './reader.service';

@Controller()
export class ReaderController {
  constructor(private readonly reader: ReaderService) {}

  @Post('progress')
  upsert(
    @CurrentUser() user: JwtUser,
    @Body(new ZodValidationPipe(progressSchema)) dto: UpsertProgressDto,
  ) {
    return this.reader.upsert(user.id, dto);
  }

  @Get('progress/:bookId')
  get(@CurrentUser() user: JwtUser, @Param('bookId') bookId: string) {
    return this.reader.get(user.id, bookId);
  }
}
