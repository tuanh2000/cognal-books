import { Module } from '@nestjs/common';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';

@Module({
  controllers: [SettingsController],
  providers: [SettingsService],
  // Exported so TranslationModule can resolve a user's own keys per request.
  exports: [SettingsService],
})
export class SettingsModule {}
