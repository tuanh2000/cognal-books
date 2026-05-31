import { Controller, Delete, Param, UseGuards } from '@nestjs/common';
import { AdminGuard } from '../common/admin.guard';
import { BooksService } from './books.service';

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
}
