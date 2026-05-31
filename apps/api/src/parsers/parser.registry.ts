import { Injectable, UnsupportedMediaTypeException } from '@nestjs/common';
import { EbookParser } from './interfaces/ebook-parser.interface';
import { EpubParser } from './epub/epub.parser';
import { PdfParser } from './pdf/pdf.parser';

/**
 * Resolves the right parser for a given file extension.
 * Register additional formats (MOBI, …) here — callers stay untouched.
 */
@Injectable()
export class ParserRegistry {
  private readonly parsers: EbookParser[];

  constructor(epub: EpubParser, pdf: PdfParser) {
    this.parsers = [epub, pdf];
  }

  forExtension(extension: string): EbookParser {
    const ext = extension.toLowerCase().replace(/^\./, '');
    const parser = this.parsers.find((p) => p.extensions.includes(ext));
    if (!parser) {
      throw new UnsupportedMediaTypeException(`Unsupported ebook format: .${ext}`);
    }
    return parser;
  }
}
