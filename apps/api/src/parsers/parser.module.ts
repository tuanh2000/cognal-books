import { Module } from '@nestjs/common';
import { EpubParser } from './epub/epub.parser';
import { PdfParser } from './pdf/pdf.parser';
import { ParserRegistry } from './parser.registry';

@Module({
  providers: [EpubParser, PdfParser, ParserRegistry],
  exports: [ParserRegistry],
})
export class ParserModule {}
