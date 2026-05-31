import { Body, Controller, Delete, Get, NotFoundException, Param, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import {
  discussSchema,
  translateSchema,
  type DiscussDto,
  type DiscussStreamEvent,
  type TranslateDto,
  type TranslateStreamEvent,
} from '@reader/shared';
import { CurrentUser, JwtUser } from '../common/current-user.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { BooksService } from '../books/books.service';
import { SettingsService } from '../settings/settings.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { TranslationService } from './translation.service';

@Controller()
export class TranslationController {
  constructor(
    private readonly translation: TranslationService,
    private readonly settings: SettingsService,
    private readonly books: BooksService,
    private readonly analytics: AnalyticsService,
  ) {}

  /** Streams a translation as Server-Sent Events. Returns cache hit instantly. */
  @Post('translate')
  async translate(
    @CurrentUser() user: JwtUser,
    @Body(new ZodValidationPipe(translateSchema)) dto: TranslateDto,
    @Res() res: Response,
  ): Promise<void> {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const send = (event: TranslateStreamEvent) => res.write(`data: ${JSON.stringify(event)}\n\n`);
    const hash = this.translation.hash(dto.text, dto.targetLang);

    // Save a located mark when the request is tied to a book location.
    const saveMark = (text: string) => {
      if (dto.bookId && dto.cfiRange) {
        return this.translation.saveMark(
          user.id,
          dto.bookId,
          dto.cfiRange,
          dto.text,
          text,
          dto.targetLang,
        );
      }
      return Promise.resolve();
    };

    try {
      // `force` bypasses the cache to re-translate and overwrite.
      const cached = dto.force ? null : await this.translation.findCached(hash);
      if (cached) {
        send({ type: 'meta', hash, cached: true });
        send({ type: 'token', value: cached.translatedText });
        await saveMark(cached.translatedText);
        send({ type: 'done', translatedText: cached.translatedText });
        this.analytics.log('translate', user.id, { targetLang: dto.targetLang, cached: true });
        res.end();
        return;
      }

      send({ type: 'meta', hash, cached: false });
      let full = '';
      const meta: { provider?: string } = {};
      // Use the user's own API keys when configured; falls back to shared env keys.
      const userProviders = await this.settings.buildUserProviders(user.id);
      for await (const token of this.translation.stream(
        dto.text,
        dto.targetLang,
        dto.context,
        meta,
        userProviders,
      )) {
        full += token;
        send({ type: 'token', value: token });
      }

      await this.translation.persist(hash, dto.text, full, dto.targetLang);
      await saveMark(full);
      send({ type: 'done', translatedText: full, provider: meta.provider });
      this.analytics.log('translate', user.id, {
        targetLang: dto.targetLang,
        cached: false,
        provider: meta.provider,
      });
      res.end();
    } catch (err) {
      send({ type: 'error', message: (err as Error).message ?? 'Translation failed' });
      res.end();
    }
  }

  /**
   * Streams a reading-assistant reply (summary or answer) about a selected
   * passage as Server-Sent Events. The book's metadata is looked up server-side
   * — verifying ownership — and injected into the prompt for context.
   */
  @Post('discuss')
  async discuss(
    @CurrentUser() user: JwtUser,
    @Body(new ZodValidationPipe(discussSchema)) dto: DiscussDto,
    @Res() res: Response,
  ): Promise<void> {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const send = (event: DiscussStreamEvent) => res.write(`data: ${JSON.stringify(event)}\n\n`);

    try {
      // getDetail enforces ownership (throws if the book isn't this user's).
      const book = await this.books.getDetail(user.id, dto.bookId);
      const meta: { provider?: string } = {};
      const userProviders = await this.settings.buildUserProviders(user.id);
      for await (const token of this.translation.discuss(
        dto.text,
        dto.messages,
        { title: book.title, author: book.author, language: book.language },
        dto.targetLang,
        meta,
        userProviders,
      )) {
        send({ type: 'token', value: token });
      }
      send({ type: 'done', provider: meta.provider });
      this.analytics.log('discuss', user.id, {
        targetLang: dto.targetLang,
        provider: meta.provider,
      });
      res.end();
    } catch (err) {
      send({ type: 'error', message: (err as Error).message ?? 'Discussion failed' });
      res.end();
    }
  }

  /** Direct cache lookup by hash (non-streaming). */
  @Get('translations/:hash')
  async byHash(@Param('hash') hash: string) {
    const cached = await this.translation.findCached(hash);
    if (!cached) throw new NotFoundException('Translation not cached');
    return cached;
  }

  /** All translations the user has saved against this book (for highlights). */
  @Get('books/:bookId/translations')
  listSaved(@CurrentUser() user: JwtUser, @Param('bookId') bookId: string) {
    return this.translation.listMarks(user.id, bookId);
  }

  /** Remove a saved translation. */
  @Delete('books/:bookId/translations/:id')
  async deleteSaved(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    await this.translation.deleteMark(user.id, id);
    return { ok: true };
  }
}
