import {
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Res,
  UploadedFiles,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Response } from 'express';
import { createReadStream } from 'fs';
import { CurrentUser, JwtUser } from '../common/current-user.decorator';
import { BooksService } from './books.service';

const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_MB ?? 50) * 1024 * 1024;

type UploadFields = { file?: Express.Multer.File[]; cover?: Express.Multer.File[] };

@Controller('books')
export class BooksController {
  constructor(private readonly books: BooksService) {}

  @Post('upload')
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'file', maxCount: 1 },
        { name: 'cover', maxCount: 1 },
      ],
      {
        storage: memoryStorage(),
        limits: { fileSize: MAX_UPLOAD_BYTES },
        fileFilter: (_req, file, cb) => {
          // The cover is a client-rendered image; the book must be epub/pdf.
          // (Size is enforced by limits.fileSize — file.size is not known here.)
          if (file.fieldname === 'cover') {
            const okCover = file.mimetype.startsWith('image/');
            return cb(okCover ? null : new BadRequestException('Invalid cover image'), okCover);
          }
          const name = file.originalname.toLowerCase();
          const ok =
            file.mimetype === 'application/epub+zip' ||
            file.mimetype === 'application/pdf' ||
            name.endsWith('.epub') ||
            name.endsWith('.pdf');
          cb(ok ? null : new BadRequestException('Only .epub and .pdf files are allowed'), ok);
        },
      },
    ),
  )
  upload(@CurrentUser() user: JwtUser, @UploadedFiles() files?: UploadFields) {
    const file = files?.file?.[0];
    if (!file) throw new BadRequestException('No file uploaded');
    return this.books.upload(user.id, file, files?.cover?.[0]);
  }

  @Get()
  list(@CurrentUser() user: JwtUser) {
    return this.books.list(user.id);
  }

  @Get(':id')
  detail(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.books.getDetail(user.id, id);
  }

  @Delete(':id')
  async remove(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    await this.books.remove(user.id, id);
    return { ok: true };
  }

  @Get(':id/file')
  async file(@CurrentUser() user: JwtUser, @Param('id') id: string, @Res() res: Response) {
    const { path, mimeType } = await this.books.getFileLocation(user.id, id);
    res.setHeader('Content-Type', mimeType);
    createReadStream(path).pipe(res);
  }

  @Get(':id/cover')
  async cover(@CurrentUser() user: JwtUser, @Param('id') id: string, @Res() res: Response) {
    const path = await this.books.getCoverPath(user.id, id);
    res.setHeader('Cache-Control', 'private, max-age=86400');
    createReadStream(path).pipe(res);
  }
}
