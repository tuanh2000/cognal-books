import { Module } from '@nestjs/common';
import { ReaderController } from './reader.controller';
import { ReaderService } from './reader.service';

@Module({
  controllers: [ReaderController],
  providers: [ReaderService],
})
export class ReaderModule {}
