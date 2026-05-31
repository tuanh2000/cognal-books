import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { PrismaModule } from './prisma/prisma.module';
import { BooksModule } from './books/books.module';
import { ReaderModule } from './reader/reader.module';
import { TranslationModule } from './translation/translation.module';
import { SettingsModule } from './settings/settings.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { HealthController } from './health/health.controller';
import { AuthGuard } from './common/auth.guard';
import { UserThrottlerGuard } from './common/user-throttler.guard';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // Per-user rate limiting (keyed in a later phase). 120 requests / minute.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    PrismaModule,
    BooksModule,
    ReaderModule,
    TranslationModule,
    SettingsModule,
    AnalyticsModule,
  ],
  controllers: [HealthController],
  providers: [
    // Authenticate every request (verifies the web app's access token) unless
    // the route is marked @Public(). Runs before the throttler so the throttler
    // can key the rate limit on the authenticated user.
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: UserThrottlerGuard },
  ],
})
export class AppModule {}
