import { Injectable, BadRequestException } from '@nestjs/common';
import AdmZip from 'adm-zip';
import { XMLParser } from 'fast-xml-parser';
import {
  EbookParser,
  ParsedChapter,
  ParsedCover,
  ParsedEbook,
} from '../interfaces/ebook-parser.interface';

const xml = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  // Always treat these as arrays so single/multiple items parse uniformly.
  isArray: (name) => ['item', 'itemref', 'navPoint', 'rootfile'].includes(name),
});

/** Reads text content whether the node is a string or { '#text': ... }. */
function textOf(node: unknown): string | null {
  if (node == null) return null;
  if (typeof node === 'string') return node.trim() || null;
  if (Array.isArray(node)) return textOf(node[0]);
  if (typeof node === 'object' && '#text' in (node as Record<string, unknown>)) {
    return textOf((node as Record<string, unknown>)['#text']);
  }
  return null;
}

function dirOf(path: string): string {
  const i = path.lastIndexOf('/');
  return i === -1 ? '' : path.slice(0, i + 1);
}

function joinZipPath(base: string, rel: string): string {
  // Resolve "../" and "./" segments relative to the OPF directory.
  const stack = base.split('/').filter(Boolean);
  for (const seg of rel.split('/')) {
    if (seg === '..') stack.pop();
    else if (seg !== '.' && seg !== '') stack.push(seg);
  }
  return stack.join('/');
}

@Injectable()
export class EpubParser implements EbookParser {
  readonly extensions = ['epub'];

  validate(fileBuffer: Buffer): void {
    // EPUB files are ZIP archives — they start with "PK".
    if (fileBuffer.length < 4 || fileBuffer[0] !== 0x50 || fileBuffer[1] !== 0x4b) {
      throw new BadRequestException('File is not a valid EPUB (bad ZIP signature)');
    }
    try {
      const zip = new AdmZip(fileBuffer);
      if (!zip.getEntry('META-INF/container.xml')) {
        throw new Error('missing container.xml');
      }
    } catch {
      throw new BadRequestException('File is not a valid EPUB archive');
    }
  }

  async parse(fileBuffer: Buffer): Promise<ParsedEbook> {
    const zip = new AdmZip(fileBuffer);

    const opfPath = this.findOpfPath(zip);
    const opfDir = dirOf(opfPath);
    const opf = xml.parse(this.readText(zip, opfPath));
    const pkg = opf.package ?? {};

    const metadata = pkg.metadata ?? {};
    const title = textOf(metadata['dc:title']) ?? 'Untitled';
    const author = textOf(metadata['dc:creator']);
    const language = textOf(metadata['dc:language']);

    const manifestItems: Array<Record<string, string>> = pkg.manifest?.item ?? [];
    const byId = new Map<string, Record<string, string>>();
    for (const item of manifestItems) byId.set(item['@_id'], item);

    const chapters = this.buildChapters(zip, pkg, opfDir, byId);
    const cover = this.extractCover(zip, metadata, manifestItems, opfDir, byId);

    return { title, author, language, chapters, cover };
  }

  private findOpfPath(zip: AdmZip): string {
    const container = xml.parse(this.readText(zip, 'META-INF/container.xml'));
    const rootfile = container?.container?.rootfiles?.rootfile?.[0];
    const fullPath = rootfile?.['@_full-path'];
    if (!fullPath) throw new BadRequestException('EPUB container has no rootfile');
    return fullPath;
  }

  private buildChapters(
    zip: AdmZip,
    pkg: Record<string, any>,
    opfDir: string,
    byId: Map<string, Record<string, string>>,
  ): ParsedChapter[] {
    const itemrefs: Array<Record<string, string>> = pkg.spine?.itemref ?? [];
    const ncxLabels = this.readNcxLabels(zip, pkg, opfDir, byId);

    const chapters: ParsedChapter[] = [];
    itemrefs.forEach((ref, index) => {
      const item = byId.get(ref['@_idref']);
      if (!item) return;
      const href = joinZipPath(opfDir, item['@_href']);
      const label = ncxLabels.get(item['@_href']) ?? `Chapter ${index + 1}`;
      chapters.push({ label, href, order: index });
    });
    return chapters;
  }

  /** Map manifest href -> human label using the EPUB2 NCX table of contents. */
  private readNcxLabels(
    zip: AdmZip,
    pkg: Record<string, any>,
    opfDir: string,
    byId: Map<string, Record<string, string>>,
  ): Map<string, string> {
    const labels = new Map<string, string>();
    const tocId = pkg.spine?.['@_toc'];
    const ncxItem = tocId ? byId.get(tocId) : undefined;
    if (!ncxItem) return labels;

    try {
      const ncx = xml.parse(this.readText(zip, joinZipPath(opfDir, ncxItem['@_href'])));
      const points: Array<Record<string, any>> = ncx?.ncx?.navMap?.navPoint ?? [];
      const walk = (nodes: Array<Record<string, any>>) => {
        for (const p of nodes) {
          const label = textOf(p?.navLabel?.text);
          const src: string | undefined = p?.content?.['@_src'];
          if (label && src) labels.set(src.split('#')[0], label);
          if (p?.navPoint) walk(p.navPoint);
        }
      };
      walk(points);
    } catch {
      // NCX optional / malformed — fall back to generated labels.
    }
    return labels;
  }

  private extractCover(
    zip: AdmZip,
    metadata: Record<string, any>,
    manifestItems: Array<Record<string, string>>,
    opfDir: string,
    byId: Map<string, Record<string, string>>,
  ): ParsedCover | null {
    // EPUB3: manifest item with properties="cover-image".
    let coverItem = manifestItems.find((i) => (i['@_properties'] ?? '').includes('cover-image'));

    // EPUB2: <meta name="cover" content="cover-id" />
    if (!coverItem) {
      const metas = Array.isArray(metadata.meta) ? metadata.meta : [metadata.meta].filter(Boolean);
      const coverMeta = metas.find((m: Record<string, string>) => m?.['@_name'] === 'cover');
      const coverId = coverMeta?.['@_content'];
      if (coverId) coverItem = byId.get(coverId);
    }

    if (!coverItem) return null;
    const entry = zip.getEntry(joinZipPath(opfDir, coverItem['@_href']));
    if (!entry) return null;
    return { data: entry.getData(), mimeType: coverItem['@_media-type'] ?? 'image/jpeg' };
  }

  private readText(zip: AdmZip, path: string): string {
    const entry = zip.getEntry(path);
    if (!entry) throw new BadRequestException(`EPUB is missing ${path}`);
    return entry.getData().toString('utf-8');
  }
}
