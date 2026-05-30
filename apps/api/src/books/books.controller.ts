import {
  Controller,
  Get,
  Param,
  Post,
  Res,
  UploadedFile,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Response } from 'express';
import { createReadStream } from 'fs';
import { CurrentUser, JwtUser } from '../common/current-user.decorator';
import { BooksService } from './books.service';

const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_MB ?? 50) * 1024 * 1024;

@Controller('books')
export class BooksController {
  constructor(private readonly books: BooksService) {}

  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_UPLOAD_BYTES },
      fileFilter: (_req, file, cb) => {
        const ok =
          file.mimetype === 'application/epub+zip' ||
          file.originalname.toLowerCase().endsWith('.epub');
        cb(ok ? null : new BadRequestException('Only .epub files are allowed'), ok);
      },
    }),
  )
  upload(@CurrentUser() user: JwtUser, @UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('No file uploaded');
    return this.books.upload(user.id, file);
  }

  @Get()
  list(@CurrentUser() user: JwtUser) {
    return this.books.list(user.id);
  }

  @Get(':id')
  detail(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.books.getDetail(user.id, id);
  }

  @Get(':id/file')
  async file(@CurrentUser() user: JwtUser, @Param('id') id: string, @Res() res: Response) {
    const path = await this.books.getFilePath(user.id, id);
    res.setHeader('Content-Type', 'application/epub+zip');
    createReadStream(path).pipe(res);
  }

  @Get(':id/cover')
  async cover(@CurrentUser() user: JwtUser, @Param('id') id: string, @Res() res: Response) {
    const path = await this.books.getCoverPath(user.id, id);
    res.setHeader('Cache-Control', 'private, max-age=86400');
    createReadStream(path).pipe(res);
  }
}
