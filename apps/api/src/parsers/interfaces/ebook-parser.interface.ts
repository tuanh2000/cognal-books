/**
 * Contract every ebook-format parser must implement.
 * Adding PDF/MOBI later = implement this + register it in ParserRegistry.
 * Nothing else in the codebase needs to change.
 */
export interface ParsedChapter {
  label: string;
  href: string;
  order: number;
}

export interface ParsedCover {
  /** Raw image bytes. */
  data: Buffer;
  /** e.g. "image/jpeg" — used to pick a file extension. */
  mimeType: string;
}

export interface ParsedEbook {
  title: string;
  author: string | null;
  language: string | null;
  chapters: ParsedChapter[];
  cover: ParsedCover | null;
}

export interface EbookParser {
  /** File extensions (lowercase, no dot) this parser handles, e.g. ['epub']. */
  readonly extensions: string[];
  /** Quick structural validation of the file bytes. Throws if invalid. */
  validate(fileBuffer: Buffer): Promise<void> | void;
  /** Extract metadata, chapter list and cover. */
  parse(fileBuffer: Buffer): Promise<ParsedEbook>;
}
