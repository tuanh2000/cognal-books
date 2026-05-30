import { Injectable, NotFoundException } from '@nestjs/common';
import type { ReadingProgress, UpsertProgressDto } from '@reader/shared';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ReaderService {
  constructor(private readonly prisma: PrismaService) {}

  async upsert(userId: string, dto: UpsertProgressDto): Promise<ReadingProgress> {
    const row = await this.prisma.readingProgress.upsert({
      where: { userId_bookId: { userId, bookId: dto.bookId } },
      create: {
        userId,
        bookId: dto.bookId,
        cfi: dto.cfi,
        percentage: dto.percentage,
        chapterLabel: dto.chapterLabel ?? null,
      },
      update: {
        cfi: dto.cfi,
        percentage: dto.percentage,
        chapterLabel: dto.chapterLabel ?? null,
      },
    });
    return this.toDto(row);
  }

  async get(userId: string, bookId: string): Promise<ReadingProgress | null> {
    const row = await this.prisma.readingProgress.findUnique({
      where: { userId_bookId: { userId, bookId } },
    });
    return row ? this.toDto(row) : null;
  }

  private toDto(row: {
    bookId: string;
    cfi: string;
    percentage: number;
    chapterLabel: string | null;
    updatedAt: Date;
  }): ReadingProgress {
    return {
      bookId: row.bookId,
      cfi: row.cfi,
      percentage: row.percentage,
      chapterLabel: row.chapterLabel,
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
