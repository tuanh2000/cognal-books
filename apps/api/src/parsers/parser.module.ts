import { Module } from '@nestjs/common';
import { EpubParser } from './epub/epub.parser';
import { ParserRegistry } from './parser.registry';

@Module({
  providers: [EpubParser, ParserRegistry],
  exports: [ParserRegistry],
})
export class ParserModule {}
