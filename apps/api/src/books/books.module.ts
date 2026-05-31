import { Module } from '@nestjs/common';
import { BooksController } from './books.controller';
import { BooksAdminController } from './books-admin.controller';
import { BooksService } from './books.service';
import { ParserModule } from '../parsers/parser.module';

@Module({
  imports: [ParserModule],
  controllers: [BooksController, BooksAdminController],
  providers: [BooksService],
  exports: [BooksService],
})
export class BooksModule {}
