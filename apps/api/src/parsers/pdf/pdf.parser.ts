import { Injectable, BadRequestException } from '@nestjs/common';
import { EbookParser, ParsedChapter, ParsedEbook } from '../interfaces/ebook-parser.interface';

// pdf.js (legacy) tries to require the native `canvas` package on load to
// polyfill DOMMatrix/Path2D for RENDERING. We only read metadata + outline
// here (no rendering), so we predefine harmless stubs: pdf.js then sees the
// globals already exist and skips the canvas require (and its noisy warnings).
const g = globalThis as unknown as Record<string, unknown>;
if (typeof g.DOMMatrix === 'undefined') g.DOMMatrix = class {};
if (typeof g.Path2D === 'undefined') g.Path2D = class {};

// pdf.js (legacy CommonJS build) runs fine in Node for metadata + outline
// extraction. Loaded via require so it works under the API's CommonJS output
// and Electron's bundled Node.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfjs = require('pdfjs-dist/legacy/build/pdf.js');

interface PdfOutlineNode {
  title: string;
  dest: string | unknown[] | null;
  items?: PdfOutlineNode[];
}

/** Parser for PDF documents. Extracts title/author + the bookmark outline. */
@Injectable()
export class PdfParser implements EbookParser {
  readonly extensions = ['pdf'];

  validate(fileBuffer: Buffer): void {
    // PDFs begin with the "%PDF-" header. Allow a small leading-junk tolerance
    // (some files prepend a BOM/whitespace) by scanning the first 1KB.
    const head = fileBuffer.subarray(0, 1024).toString('latin1');
    if (!head.includes('%PDF-')) {
      throw new BadRequestException('File is not a valid PDF (missing %PDF header)');
    }
  }

  async parse(fileBuffer: Buffer): Promise<ParsedEbook> {
    let doc: any;
    try {
      // Copy into a fresh Uint8Array — pdf.js transfers/detaches the buffer.
      const data = new Uint8Array(fileBuffer);
      doc = await pdfjs.getDocument({
        data,
        // Keep everything on the main thread; no worker/eval in Node.
        useWorkerFetch: false,
        isEvalSupported: false,
        useSystemFonts: true,
      }).promise;
    } catch (err) {
      throw new BadRequestException(
        `Could not read PDF: ${(err as Error).message ?? 'unknown error'}`,
      );
    }

    try {
      const meta = await doc.getMetadata().catch(() => null);
      const info = (meta?.info ?? {}) as Record<string, unknown>;
      const title = (info.Title as string | undefined)?.trim() || 'Untitled';
      const author = (info.Author as string | undefined)?.trim() || null;
      const language = (info.Language as string | undefined)?.trim() || null;

      const chapters = await this.buildChapters(doc);
      // Covers are rendered client-side (page 1) and uploaded separately, so the
      // parser does not produce one.
      return { title, author, language, chapters, cover: null };
    } finally {
      await doc.cleanup?.();
      await doc.destroy?.();
    }
  }

  /** Flatten the PDF outline (bookmarks) into ordered chapters with page hrefs. */
  private async buildChapters(doc: any): Promise<ParsedChapter[]> {
    let outline: PdfOutlineNode[] | null = null;
    try {
      outline = await doc.getOutline();
    } catch {
      outline = null;
    }
    if (!outline || outline.length === 0) return [];

    const chapters: ParsedChapter[] = [];
    const walk = async (nodes: PdfOutlineNode[]) => {
      for (const node of nodes) {
        const page = await this.resolvePage(doc, node.dest);
        const label = node.title?.trim();
        if (label && page != null) {
          // href is the 0-based page index as a string; the reader jumps to it.
          chapters.push({ label, href: String(page), order: chapters.length });
        }
        if (node.items?.length) await walk(node.items);
      }
    };
    await walk(outline);
    return chapters;
  }

  /** Resolve an outline destination to a 0-based page index, or null. */
  private async resolvePage(doc: any, dest: PdfOutlineNode['dest']): Promise<number | null> {
    try {
      const explicit = typeof dest === 'string' ? await doc.getDestination(dest) : dest;
      if (!Array.isArray(explicit) || explicit.length === 0) return null;
      const ref = explicit[0];
      // ref is a page reference object; getPageIndex returns its 0-based index.
      const index = await doc.getPageIndex(ref);
      return typeof index === 'number' ? index : null;
    } catch {
      return null;
    }
  }
}
