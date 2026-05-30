'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import ePub, { type Book, type Rendition, type NavItem } from 'epubjs';
import { useTheme } from 'next-themes';
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Home,
  Languages,
  Loader2,
  Minus,
  Plus,
  Sparkles,
} from 'lucide-react';
import { api } from '@/lib/api';
import type { SavedTranslation } from '@reader/shared';
import { useReaderPrefs } from '@/lib/store';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/theme-toggle';
import { TranslationPanel, type PanelRequest } from './translation-panel';
import { DiscussPanel, type DiscussRequest } from './discuss-panel';
import { cn } from '@/lib/utils';

interface SelectionState {
  text: string;
  cfiRange: string;
  x: number;
  y: number;
}

/* ── Saved-translation geometry helpers (operate on EPUB.js Contents) ── */

function contentsList(rendition: any): any[] {
  const cs = rendition?.getContents?.();
  if (!cs) return [];
  return Array.isArray(cs) ? cs : [cs];
}

/** Resolve a CFI range to a DOM Range within a section, or null if not here. */
function resolveRange(contents: any, cfi: string): Range | null {
  try {
    const r = contents.range(cfi);
    return r && r.startContainer ? r : null;
  } catch {
    return null;
  }
}

/** Do the ranges share actual content (true overlap, not mere touching)? */
function rangesShareContent(doc: Document, a: Range, b: Range): boolean {
  try {
    const laterStart = a.compareBoundaryPoints(Range.START_TO_START, b) >= 0 ? a : b;
    const earlierEnd = a.compareBoundaryPoints(Range.END_TO_END, b) <= 0 ? a : b;
    const inter = doc.createRange();
    inter.setStart(laterStart.startContainer, laterStart.startOffset);
    inter.setEnd(earlierEnd.endContainer, earlierEnd.endOffset);
    return !inter.collapsed && inter.toString().trim().length > 0;
  } catch {
    return false;
  }
}

// Saved (translated) paragraphs get a dim amber highlight; the one currently
// open in the panel gets the `.is-active` class (stronger orange, see globals.css).
const HL_DIM = { fill: '#fbbf24', 'fill-opacity': '0.24' };

export function EpubReader({ bookId }: { bookId: string }) {
  const viewerRef = useRef<HTMLDivElement>(null);
  const bookRef = useRef<Book | null>(null);
  const renditionRef = useRef<Rendition | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Authoritative saved marks for this book (with ids), used for overlap checks.
  const savedMarksRef = useRef<SavedTranslation[]>([]);
  // Drawn-highlight cfi -> displayed text (covers merged "union" cfis too).
  const marksRef = useRef<Map<string, { sourceText: string; translatedText: string }>>(new Map());
  const highlightedRef = useRef<Set<string>>(new Set());
  // cfi -> EPUB.js Annotation object (so we can toggle the active class on it).
  const annotationsRef = useRef<Map<string, any>>(new Map());
  // The highlight cfi currently shown in the panel (drawn in the active colour).
  const activeCfiRef = useRef<string | null>(null);

  const { resolvedTheme } = useTheme();
  const { fontSize, setFontSize } = useReaderPrefs();

  const [loading, setLoading] = useState(true);
  const [toc, setToc] = useState<NavItem[]>([]);
  const [percentage, setPercentage] = useState(0);
  const [chapterLabel, setChapterLabel] = useState<string>('');
  const [selection, setSelection] = useState<SelectionState | null>(null);
  const [translateRequest, setTranslateRequest] = useState<PanelRequest | null>(null);
  const [discussRequest, setDiscussRequest] = useState<DiscussRequest | null>(null);

  // Draw a dim highlight once; clicking it reopens the panel with the stored
  // text. The returned annotation lets us toggle the active class on its
  // element later (no remove/re-add, which EPUB.js renders unreliably).
  const addHighlight = useCallback((rendition: Rendition, cfiRange: string) => {
    if (highlightedRef.current.has(cfiRange)) return;
    try {
      const ann = rendition.annotations.add(
        'highlight',
        cfiRange,
        {},
        () => {
          const m = marksRef.current.get(cfiRange);
          setDiscussRequest(null);
          setTranslateRequest({
            text: m?.sourceText ?? '',
            cfiRange,
            preloaded: m?.translatedText ?? '',
          });
        },
        'translated-hl',
        HL_DIM,
      );
      annotationsRef.current.set(cfiRange, ann);
      highlightedRef.current.add(cfiRange);
      // Re-apply active class if this is the highlight currently in the panel.
      if (cfiRange === activeCfiRef.current) {
        ((ann as any)?.mark?.element as Element | undefined)?.classList.add('is-active');
      }
    } catch {
      /* ignore */
    }
  }, []);

  // Toggle the active (in-panel) highlight by flipping a CSS class.
  const setActiveHighlight = useCallback((cfiRange: string | null) => {
    const prev = activeCfiRef.current;
    if (prev === cfiRange) return;
    activeCfiRef.current = cfiRange;
    const el = (cfi: string | null) =>
      cfi ? (annotationsRef.current.get(cfi)?.mark?.element as Element | undefined) : undefined;
    el(prev)?.classList.remove('is-active');
    el(cfiRange)?.classList.add('is-active');
  }, []);

  // Draw each saved translation as its own highlight (no merging with neighbours).
  const drawSavedHighlights = useCallback(
    (contents: any) => {
      const rendition = renditionRef.current;
      if (!rendition || !contents) return;
      for (const m of savedMarksRef.current) {
        if (highlightedRef.current.has(m.cfiRange)) continue;
        if (!resolveRange(contents, m.cfiRange)) continue; // not in this section
        marksRef.current.set(m.cfiRange, {
          sourceText: m.sourceText,
          translatedText: m.translatedText,
        });
        addHighlight(rendition, m.cfiRange);
      }
    },
    [addHighlight],
  );

  // Clear all highlights, refetch saved marks, and redraw.
  const refreshMarks = useCallback(async () => {
    const rendition = renditionRef.current;
    if (!rendition) return;
    for (const cfi of highlightedRef.current) {
      try {
        rendition.annotations.remove(cfi, 'highlight');
      } catch {
        /* ignore */
      }
    }
    highlightedRef.current.clear();
    annotationsRef.current.clear();
    marksRef.current.clear();
    try {
      savedMarksRef.current = await api.listSavedTranslations(bookId);
    } catch {
      return;
    }
    for (const c of contentsList(rendition)) drawSavedHighlights(c);
  }, [bookId, drawSavedHighlights]);

  // After a fresh translation: delete any older marks it overlaps, then redraw.
  const handleTranslated = useCallback(
    async (newCfi: string) => {
      const rendition = renditionRef.current;
      if (!rendition) return;

      let contents: any = null;
      let newRange: Range | null = null;
      for (const c of contentsList(rendition)) {
        const r = resolveRange(c, newCfi);
        if (r) {
          contents = c;
          newRange = r;
          break;
        }
      }

      if (contents && newRange) {
        const overlapped = savedMarksRef.current.filter((m) => {
          if (m.cfiRange === newCfi) return false;
          const r = resolveRange(contents, m.cfiRange);
          return r != null && rangesShareContent(contents.document, newRange as Range, r);
        });
        await Promise.all(
          overlapped.map((m) => api.deleteSavedTranslation(bookId, m.id).catch(() => undefined)),
        );
      }

      await refreshMarks();
    },
    [bookId, refreshMarks],
  );

  const applyTheme = useCallback(
    (rendition: Rendition) => {
      const dark = resolvedTheme === 'dark';
      rendition.themes.override('color', dark ? '#e7e2da' : '#1a1714');
      rendition.themes.override('background', dark ? '#16130f' : '#faf8f4');
      rendition.themes.fontSize(`${fontSize}%`);
    },
    [resolvedTheme, fontSize],
  );

  // ── Initialise the book once. ──
  useEffect(() => {
    let cancelled = false;

    async function init() {
      const [detail, buffer] = await Promise.all([api.getBook(bookId), api.getBookFile(bookId)]);
      if (cancelled || !viewerRef.current) return;

      // Reset per-book mark state (the component may be reused across books).
      savedMarksRef.current = [];
      marksRef.current.clear();
      highlightedRef.current.clear();
      annotationsRef.current.clear();
      activeCfiRef.current = null;

      const book = ePub(buffer);
      bookRef.current = book;

      const rendition = book.renderTo(viewerRef.current, {
        width: '100%',
        height: '100%',
        // Continuous vertical scroll (no page breaks) so a paragraph that used to
        // straddle a page boundary renders whole and can be selected/translated in
        // one go. prev()/next() (side arrows + ←/→ keys) scroll by one viewport.
        flow: 'scrolled',
        manager: 'continuous',
        // EPUB.js renders chapters into an `about:srcdoc` iframe, which browser
        // translation extensions cannot reach. The only alternative render
        // method (`blobUrl`) breaks rendering with this engine version, so we
        // keep srcdoc and provide in-app translation instead. Keep the iframe
        // sandboxed (no scripted content) for safety.
        allowScriptedContent: false,
      });
      renditionRef.current = rendition;
      applyTheme(rendition);

      await rendition.display(detail.progress?.cfi ?? undefined);
      if (cancelled) return;
      setLoading(false);

      book.loaded.navigation.then((nav) => !cancelled && setToc(nav.toc));

      // Load this user's saved translations and draw them (adjacent ones merged).
      api
        .listSavedTranslations(bookId)
        .then((marks) => {
          if (cancelled) return;
          savedMarksRef.current = marks;
          for (const c of contentsList(rendition)) drawSavedHighlights(c);
        })
        .catch(() => undefined);

      // Redraw highlights whenever a section renders (e.g. page turns).
      rendition.on('rendered', () => {
        if (cancelled) return;
        for (const c of contentsList(rendition)) drawSavedHighlights(c);
      });

      // Build the locations index so we can compute reading percentage.
      book.locations.generate(1650).then(() => {
        if (cancelled) return;
        const loc = rendition.currentLocation() as unknown as { start?: { cfi: string } };
        if (loc?.start?.cfi) {
          setPercentage(book.locations.percentageFromCfi(loc.start.cfi) * 100);
        }
      });

      rendition.on('relocated', (location: any) => {
        const cfi: string = location.start.cfi;
        const pct = book.locations.length() ? book.locations.percentageFromCfi(cfi) * 100 : 0;
        setPercentage(pct);

        const href: string = location.start.href;
        const chapter = findChapter(book.navigation?.toc ?? [], href);
        if (chapter) setChapterLabel(chapter.label.trim());

        if (selectionTimer.current) clearTimeout(selectionTimer.current);
        setSelection(null);
        // NOTE: do NOT close the translation panel here. In continuous-scroll mode
        // `relocated` fires on every scroll, so dismissing it would close a
        // translation the instant the reader scrolls. The panel has its own close.
        for (const c of contentsList(rendition)) drawSavedHighlights(c);
        queueSave(cfi, pct, chapter?.label.trim());
      });

      let lastContents: any = null;

      // Wait until the selection has settled before showing the popup, so it
      // appears once — after you finish selecting — instead of flickering while
      // you're still dragging across a long paragraph.
      rendition.on('selected', (cfiRange: string, contents: any) => {
        lastContents = contents;
        if (selectionTimer.current) clearTimeout(selectionTimer.current);
        selectionTimer.current = setTimeout(() => {
          const range = contents.range(cfiRange);
          const text = contents.window.getSelection()?.toString()?.trim();
          if (!text || !range) return;
          const rect = range.getBoundingClientRect();
          const iframe = contents.document.defaultView.frameElement as HTMLElement | null;
          const offset = iframe?.getBoundingClientRect() ?? { left: 0, top: 0 };
          setSelection({
            text,
            cfiRange,
            x: offset.left + rect.left + rect.width / 2,
            y: offset.top + rect.top,
          });
        }, 450);
      });

      // A click that ends a drag-selection must NOT dismiss the popup. Only
      // dismiss on a genuine click with no active selection.
      rendition.on('click', () => {
        const stillSelected = lastContents?.window?.getSelection?.()?.toString?.().trim();
        if (!stillSelected) {
          if (selectionTimer.current) clearTimeout(selectionTimer.current);
          setSelection(null);
        }
      });
    }

    init();
    return () => {
      cancelled = true;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      if (selectionTimer.current) clearTimeout(selectionTimer.current);
      bookRef.current?.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId]);

  // ── Re-apply theme / font size when they change. ──
  useEffect(() => {
    if (renditionRef.current) applyTheme(renditionRef.current);
  }, [applyTheme]);

  // ── Keep the active (in-panel) highlight in sync with the open panel. ──
  useEffect(() => {
    setActiveHighlight(translateRequest?.cfiRange ?? null);
  }, [translateRequest, setActiveHighlight]);

  // ── Keyboard navigation. ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') renditionRef.current?.prev();
      if (e.key === 'ArrowRight') renditionRef.current?.next();
    };
    window.addEventListener('keyup', onKey);
    return () => window.removeEventListener('keyup', onKey);
  }, []);

  function queueSave(cfi: string, pct: number, label?: string) {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      api
        .saveProgress({
          bookId,
          cfi,
          percentage: Math.min(100, Math.max(0, pct)),
          chapterLabel: label,
        })
        .catch(() => undefined);
    }, 800);
  }

  const goTo = (href: string) => {
    // The contents sidebar is always visible, so navigating just changes the page.
    renditionRef.current?.display(href);
  };

  const panelOpen = translateRequest != null;

  return (
    <div className="relative flex h-screen flex-col overflow-hidden bg-background">
      {/* Top bar */}
      <header className="flex h-14 shrink-0 items-center justify-between border-b px-3">
        <div className="flex items-center gap-1">
          <Button asChild variant="ghost" size="icon" aria-label="Home">
            <Link href="/">
              <Home className="h-5 w-5" />
            </Link>
          </Button>
          <Button asChild variant="ghost" size="icon" aria-label="Back to library">
            <Link href="/library">
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
        </div>

        <p className="line-clamp-1 px-2 text-sm text-muted-foreground">{chapterLabel}</p>

        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Smaller text"
            onClick={() => setFontSize(fontSize - 10)}
          >
            <Minus className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Larger text"
            onClick={() => setFontSize(fontSize + 10)}
          >
            <Plus className="h-4 w-4" />
          </Button>
          <ThemeToggle />
        </div>
      </header>

      {/* Body */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Table of contents — always-visible sidebar */}
        <aside className="w-72 shrink-0 overflow-y-auto border-r bg-card p-4">
          <h3 className="mb-3 px-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Contents
          </h3>
          <nav className="space-y-0.5">
            {toc.map((item) => (
              <button
                key={item.href}
                onClick={() => goTo(item.href)}
                className="block w-full truncate rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
              >
                {item.label.trim()}
              </button>
            ))}
          </nav>
        </aside>

        {/* Reading area */}
        <div className="relative min-h-0 flex-1 overflow-hidden">
          {loading && (
            <div className="absolute inset-0 z-20 flex items-center justify-center bg-background">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          )}

          {/* Page nav arrows */}
          <button
            onClick={() => renditionRef.current?.prev()}
            aria-label="Previous page"
            className="absolute left-0 top-0 z-10 flex h-full w-12 items-center justify-center text-muted-foreground/40 hover:bg-accent/40 hover:text-foreground"
          >
            <ChevronLeft className="h-6 w-6" />
          </button>
          <button
            onClick={() => renditionRef.current?.next()}
            aria-label="Next page"
            // When the translation panel is open it covers the right edge, so
            // shift this arrow to sit just left of the panel and stay clickable.
            className={cn(
              'absolute top-0 z-10 flex h-full w-12 items-center justify-center text-muted-foreground/40 transition-[right] hover:bg-accent/40 hover:text-foreground',
              panelOpen ? 'right-0 md:right-[28rem]' : 'right-0',
            )}
          >
            <ChevronRight className="h-6 w-6" />
          </button>

          {/* The EPUB renders here. NOTE: the render target must stay padding-free —
            padding on this element breaks EPUB.js column/step math so page turns
            stop working. Reading margins live on this wrapper + the epub theme.
            The wide max-width lets `spread: 'auto'` show a two-page spread on
            desktop while collapsing to one page on narrow/mobile screens, and
            scales up to use large screens (more content per page). */}
          <div className="mx-auto h-full w-full max-w-[1600px] px-10 lg:px-16">
            <div ref={viewerRef} className="h-full w-full" />
          </div>

          {/* Selection popup */}
          {selection && (
            <div
              className="fixed z-40 flex -translate-x-1/2 -translate-y-full gap-1.5 animate-fade-in"
              style={{ left: selection.x, top: selection.y - 8 }}
            >
              <Button
                size="sm"
                className="shadow-lg"
                onClick={() => {
                  setDiscussRequest(null);
                  setTranslateRequest({ text: selection.text, cfiRange: selection.cfiRange });
                  setSelection(null);
                }}
              >
                <Languages className="h-4 w-4" />
                Translate
              </Button>
              <Button
                size="sm"
                variant="secondary"
                className="shadow-lg"
                onClick={() => {
                  setTranslateRequest(null);
                  setDiscussRequest({ text: selection.text, cfiRange: selection.cfiRange });
                  setSelection(null);
                }}
              >
                <Sparkles className="h-4 w-4" />
                Discuss
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Progress bar */}
      <div className="h-1 shrink-0 bg-muted">
        <div className="h-full bg-primary transition-all" style={{ width: `${percentage}%` }} />
      </div>

      <TranslationPanel
        request={translateRequest}
        bookId={bookId}
        onClose={() => setTranslateRequest(null)}
        onTranslated={handleTranslated}
        onDiscuss={(text, cfiRange) => {
          setTranslateRequest(null);
          setDiscussRequest({ text, cfiRange });
        }}
      />

      <DiscussPanel
        request={discussRequest}
        bookId={bookId}
        onClose={() => setDiscussRequest(null)}
      />
    </div>
  );
}

function findChapter(toc: NavItem[], href: string): NavItem | undefined {
  const base = href.split('#')[0];
  for (const item of toc) {
    if (item.href.split('#')[0].endsWith(base) || base.endsWith(item.href.split('#')[0])) {
      return item;
    }
    if (item.subitems?.length) {
      const found = findChapter(item.subitems, href);
      if (found) return found;
    }
  }
  return undefined;
}
