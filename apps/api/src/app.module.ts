import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { PrismaModule } from './prisma/prisma.module';
import { BooksModule } from './books/books.module';
import { ReaderModule } from './reader/reader.module';
import { TranslationModule } from './translation/translation.module';
import { SettingsModule } from './settings/settings.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // Rate limiting is harmless locally; kept so an accidental tight loop in the
    // renderer can't hammer the embedded server. 120 requests / minute.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    PrismaModule,
    BooksModule,
    ReaderModule,
    TranslationModule,
    SettingsModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
