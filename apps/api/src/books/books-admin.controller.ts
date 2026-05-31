import {
  BadRequestException,
  Controller,
  Delete,
  Param,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { AdminGuard } from '../common/admin.guard';
import { BooksService } from './books.service';

const MAX_COVER_BYTES = 5 * 1024 * 1024;

/** Admin-only book management for the dashboard. */
@UseGuards(AdminGuard)
@Controller('admin/books')
export class BooksAdminController {
  constructor(private readonly books: BooksService) {}

  /** Permanently delete any book (DB rows + on-disk file + cover). */
  @Delete(':id')
  async remove(@Param('id') id: string) {
    await this.books.adminRemove(id);
    return { ok: true };
  }

  /** Replace a book's cover image (the "avatar"). */
  @Post(':id/cover')
  @UseInterceptors(
    FileInterceptor('cover', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_COVER_BYTES },
      fileFilter: (_req, file, cb) => {
        const ok = file.mimetype.startsWith('image/');
        cb(ok ? null : new BadRequestException('Cover must be an image'), ok);
      },
    }),
  )
  async setCover(@Param('id') id: string, @UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('No image uploaded');
    await this.books.adminSetCover(id, { data: file.buffer, mimeType: file.mimetype });
    return { ok: true };
  }
}
