import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { promises as fs } from 'fs';
import { join, extname } from 'path';
import type { BookDetail, BookListItem, ReadingProgress } from '@reader/shared';
import { PrismaService } from '../prisma/prisma.service';
import { ParserRegistry } from '../parsers/parser.registry';
import { ParsedCover } from '../parsers/interfaces/ebook-parser.interface';
import { getUploadDir } from '../common/paths';

// Books/covers live under ${READER_DATA_DIR}/uploads (overridable via UPLOAD_DIR).
// Resolved lazily so it picks up READER_DATA_DIR set during main.ts bootstrap.
const UPLOAD_DIR = getUploadDir();

const COVER_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

@Injectable()
export class BooksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly parsers: ParserRegistry,
  ) {}

  async upload(userId: string, file: Express.Multer.File): Promise<BookDetail> {
    const ext = extname(file.originalname).toLowerCase();
    if (ext !== '.epub') {
      throw new BadRequestException('Only .epub files are supported');
    }

    const parser = this.parsers.forExtension('epub');
    await parser.validate(file.buffer);
    const parsed = await parser.parse(file.buffer);

    const userDir = join(UPLOAD_DIR, userId);
    await fs.mkdir(userDir, { recursive: true });

    const book = await this.prisma.book.create({
      data: {
        userId,
        title: parsed.title,
        author: parsed.author,
        language: parsed.language,
        filePath: '', // set after we know the id
        fileSize: file.size,
        chapters: {
          create: parsed.chapters.map((c) => ({
            label: c.label,
            href: c.href,
            order: c.order,
          })),
        },
      },
    });

    const filePath = join(userDir, `${book.id}.epub`);
    await fs.writeFile(filePath, file.buffer);

    const coverPath = await this.writeCover(userDir, book.id, parsed.cover);

    const updated = await this.prisma.book.update({
      where: { id: book.id },
      data: { filePath, coverPath },
      include: { chapters: { orderBy: { order: 'asc' } } },
    });

    return this.toDetail(updated, null);
  }

  async list(userId: string): Promise<BookListItem[]> {
    const books = await this.prisma.book.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: { progress: { where: { userId } } },
    });
    return books.map((b) => this.toListItem(b, b.progress[0] ?? null));
  }

  async remove(userId: string, bookId: string): Promise<void> {
    const book = await this.requireOwned(userId, bookId);
    // Cascade deletes chapters, progress and saved translations (see schema).
    await this.prisma.book.delete({ where: { id: book.id } });
    // Best-effort cleanup of on-disk files; ignore if already gone.
    await Promise.all(
      [book.filePath, book.coverPath]
        .filter((p): p is string => Boolean(p))
        .map((p) => fs.rm(p, { force: true })),
    );
  }

  async getDetail(userId: string, bookId: string): Promise<BookDetail> {
    const book = await this.prisma.book.findUnique({
      where: { id: bookId },
      include: {
        chapters: { orderBy: { order: 'asc' } },
        progress: { where: { userId } },
      },
    });
    if (!book) throw new NotFoundException('Book not found');
    if (book.userId !== userId) throw new ForbiddenException();
    return this.toDetail(book, book.progress[0] ?? null);
  }

  /** Returns the on-disk path of the raw epub after verifying ownership. */
  async getFilePath(userId: string, bookId: string): Promise<string> {
    const book = await this.requireOwned(userId, bookId);
    return book.filePath;
  }

  async getCoverPath(userId: string, bookId: string): Promise<string> {
    const book = await this.requireOwned(userId, bookId);
    if (!book.coverPath) throw new NotFoundException('No cover');
    return book.coverPath;
  }

  private async requireOwned(userId: string, bookId: string) {
    const book = await this.prisma.book.findUnique({ where: { id: bookId } });
    if (!book) throw new NotFoundException('Book not found');
    if (book.userId !== userId) throw new ForbiddenException();
    return book;
  }

  private async writeCover(
    dir: string,
    bookId: string,
    cover: ParsedCover | null,
  ): Promise<string | null> {
    if (!cover) return null;
    const ext = COVER_EXT[cover.mimeType.toLowerCase()] ?? 'jpg';
    const path = join(dir, `${bookId}-cover.${ext}`);
    await fs.writeFile(path, cover.data);
    return path;
  }

  private toListItem(
    book: {
      id: string;
      title: string;
      author: string | null;
      coverPath: string | null;
      createdAt: Date;
    },
    progress: {
      cfi: string;
      percentage: number;
      chapterLabel: string | null;
      updatedAt: Date;
    } | null,
  ): BookListItem {
    return {
      id: book.id,
      title: book.title,
      author: book.author,
      coverUrl: book.coverPath ? `/books/${book.id}/cover` : null,
      createdAt: book.createdAt.toISOString(),
      progress: progress ? this.toProgress(book.id, progress) : null,
    };
  }

  private toDetail(
    book: {
      id: string;
      title: string;
      author: string | null;
      language: string | null;
      coverPath: string | null;
      createdAt: Date;
      chapters: { id: string; href: string; label: string; order: number }[];
    },
    progress: {
      cfi: string;
      percentage: number;
      chapterLabel: string | null;
      updatedAt: Date;
    } | null,
  ): BookDetail {
    return {
      ...this.toListItem(book, progress),
      language: book.language,
      fileUrl: `/books/${book.id}/file`,
      chapters: book.chapters.map((c) => ({
        id: c.id,
        href: c.href,
        label: c.label,
        order: c.order,
      })),
    };
  }

  private toProgress(
    bookId: string,
    p: { cfi: string; percentage: number; chapterLabel: string | null; updatedAt: Date },
  ): ReadingProgress {
    return {
      bookId,
      cfi: p.cfi,
      percentage: p.percentage,
      chapterLabel: p.chapterLabel,
      updatedAt: p.updatedAt.toISOString(),
    };
  }
}
