import { Module } from '@nestjs/common';
import { TranslationController } from './translation.controller';
import { TranslationService } from './translation.service';
import { SettingsModule } from '../settings/settings.module';
import { BooksModule } from '../books/books.module';

@Module({
  imports: [SettingsModule, BooksModule],
  controllers: [TranslationController],
  providers: [TranslationService],
})
export class TranslationModule {}
