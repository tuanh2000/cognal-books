'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import * as pdfjsLib from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { ArrowLeft, Home, Languages, Loader2, Minus, Plus, Sparkles } from 'lucide-react';
import { api } from '@/lib/api';
import type { ChapterSummary, SavedTranslation } from '@reader/shared';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/theme-toggle';
import { TranslationPanel, type PanelRequest } from './translation-panel';
import { DiscussPanel, type DiscussRequest } from './discuss-panel';
import { cn } from '@/lib/utils';

// The worker ships in public/ (copied by scripts/copy-pdf-worker.mjs) and is
// served at the app root in dev (/) and packaged (app://local/) alike.
pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

interface SelectionState {
  text: string;
  /** JSON locator: {"page":n,"start":i,"end":j} — stored in the cfiRange field. */
  locator: string;
  x: number;
  y: number;
}

/** A PDF location: 1-based page + character offsets into that page's text. */
interface PdfAnchor {
  page: number;
  start: number;
  end: number;
}

function parseAnchor(locator: string): PdfAnchor | null {
  try {
    const a = JSON.parse(locator);
    if (typeof a?.page === 'number' && typeof a?.start === 'number' && typeof a?.end === 'number') {
      return a;
    }
  } catch {
    /* ignore */
  }
  return null;
}

/* ── Text-layer offset helpers (map DOM selection ↔ page char offsets) ── */

/** Char offset of (node, offsetInNode) within a text layer, in document order. */
function charOffsetOf(layer: HTMLElement, node: Node, offsetInNode: number): number {
  const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT);
  let total = 0;
  let cur = walker.nextNode();
  while (cur) {
    if (cur === node) return total + offsetInNode;
    total += cur.textContent?.length ?? 0;
    cur = walker.nextNode();
  }
  return total;
}

/** Build a DOM Range spanning [start, end) char offsets within a text layer. */
function rangeFromOffsets(layer: HTMLElement, start: number, end: number): Range | null {
  const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT);
  let total = 0;
  let startNode: Node | null = null;
  let startOff = 0;
  let endNode: Node | null = null;
  let endOff = 0;
  let cur = walker.nextNode();
  while (cur) {
    const len = cur.textContent?.length ?? 0;
    if (!startNode && start <= total + len) {
      startNode = cur;
      startOff = start - total;
    }
    if (end <= total + len) {
      endNode = cur;
      endOff = end - total;
      break;
    }
    total += len;
    cur = walker.nextNode();
  }
  if (!startNode || !endNode) return null;
  try {
    const range = document.createRange();
    range.setStart(startNode, startOff);
    range.setEnd(endNode, endOff);
    return range;
  } catch {
    return null;
  }
}

export function PdfReader({ bookId }: { bookId: string }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const pdfRef = useRef<PDFDocumentProxy | null>(null);
  const pageWrapsRef = useRef<Map<number, HTMLDivElement>>(new Map());
  const textLayersRef = useRef<Map<number, HTMLDivElement>>(new Map());
  const hlLayersRef = useRef<Map<number, HTMLDivElement>>(new Map());
  const renderedRef = useRef<Set<number>>(new Set());
  const baseScaleRef = useRef(1);
  const zoomRef = useRef(1);
  const savedMarksRef = useRef<SavedTranslation[]>([]);
  const activeLocatorRef = useRef<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [loading, setLoading] = useState(true);
  const [numPages, setNumPages] = useState(0);
  const [chapters, setChapters] = useState<ChapterSummary[]>([]);
  const [percentage, setPercentage] = useState(0);
  const [chapterLabel, setChapterLabel] = useState('');
  const [zoom, setZoom] = useState(1);
  const [selection, setSelection] = useState<SelectionState | null>(null);
  const [translateRequest, setTranslateRequest] = useState<PanelRequest | null>(null);
  const [discussRequest, setDiscussRequest] = useState<DiscussRequest | null>(null);

  /* ── Highlights ── */

  const drawHighlightsForPage = useCallback((page: number) => {
    const layer = textLayersRef.current.get(page);
    const hl = hlLayersRef.current.get(page);
    const wrap = pageWrapsRef.current.get(page);
    if (!layer || !hl || !wrap) return;
    hl.replaceChildren();
    const wrapRect = wrap.getBoundingClientRect();
    for (const mark of savedMarksRef.current) {
      const a = parseAnchor(mark.cfiRange);
      if (!a || a.page !== page) continue;
      const range = rangeFromOffsets(layer, a.start, a.end);
      if (!range) continue;
      for (const rect of Array.from(range.getClientRects())) {
        const div = document.createElement('div');
        div.className = 'pdf-hl';
        if (mark.cfiRange === activeLocatorRef.current) div.classList.add('is-active');
        div.style.left = `${rect.left - wrapRect.left}px`;
        div.style.top = `${rect.top - wrapRect.top}px`;
        div.style.width = `${rect.width}px`;
        div.style.height = `${rect.height}px`;
        div.onclick = () => {
          setDiscussRequest(null);
          setTranslateRequest({
            text: mark.sourceText,
            cfiRange: mark.cfiRange,
            preloaded: mark.translatedText,
            lang: mark.targetLang,
          });
        };
        hl.appendChild(div);
      }
    }
  }, []);

  const redrawAllHighlights = useCallback(() => {
    for (const page of textLayersRef.current.keys()) drawHighlightsForPage(page);
  }, [drawHighlightsForPage]);

  const refreshMarks = useCallback(async () => {
    try {
      savedMarksRef.current = await api.listSavedTranslations(bookId);
    } catch {
      return;
    }
    redrawAllHighlights();
  }, [bookId, redrawAllHighlights]);

  /* ── Page rendering (lazy, via IntersectionObserver) ── */

  const renderPage = useCallback(
    async (page: number) => {
      const pdf = pdfRef.current;
      const wrap = pageWrapsRef.current.get(page);
      if (!pdf || !wrap || renderedRef.current.has(page)) return;
      renderedRef.current.add(page);
      try {
        const pageProxy = await pdf.getPage(page);
        const scale = baseScaleRef.current * zoomRef.current;
        const viewport = pageProxy.getViewport({ scale });
        const outputScale = window.devicePixelRatio || 1;

        const canvas = document.createElement('canvas');
        canvas.width = Math.floor(viewport.width * outputScale);
        canvas.height = Math.floor(viewport.height * outputScale);
        canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;z-index:1;';
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const textDiv = document.createElement('div');
        textDiv.className = 'textLayer';
        textDiv.style.setProperty('--scale-factor', String(scale));

        const hlDiv = document.createElement('div');
        hlDiv.className = 'pdf-hl-layer';

        wrap.replaceChildren(canvas, hlDiv, textDiv);
        textLayersRef.current.set(page, textDiv);
        hlLayersRef.current.set(page, hlDiv);

        await pageProxy.render({
          canvasContext: ctx,
          viewport,
          transform: outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : undefined,
        }).promise;

        const textContent = await pageProxy.getTextContent();
        const textLayer = new pdfjsLib.TextLayer({
          textContentSource: textContent,
          container: textDiv,
          viewport,
        });
        await textLayer.render();

        drawHighlightsForPage(page);
      } catch {
        renderedRef.current.delete(page); // allow a retry on next intersection
      }
    },
    [drawHighlightsForPage],
  );

  const unrenderPage = useCallback((page: number) => {
    if (!renderedRef.current.has(page)) return;
    renderedRef.current.delete(page);
    textLayersRef.current.delete(page);
    hlLayersRef.current.delete(page);
    pageWrapsRef.current.get(page)?.replaceChildren();
  }, []);

  /* ── Initialise the document. ── */
  useEffect(() => {
    let cancelled = false;
    let observer: IntersectionObserver | null = null;

    async function init() {
      const [detail, buffer] = await Promise.all([api.getBook(bookId), api.getBookFile(bookId)]);
      if (cancelled || !scrollRef.current) return;

      const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise;
      if (cancelled) {
        await pdf.destroy();
        return;
      }
      pdfRef.current = pdf;
      setChapters(detail.chapters);
      setNumPages(pdf.numPages);

      // Base scale: fit the first page's width into the reading column.
      const first = await pdf.getPage(1);
      const unscaled = first.getViewport({ scale: 1 });
      const colWidth = Math.min((scrollRef.current.clientWidth || 900) - 48, 900);
      baseScaleRef.current = Math.max(0.4, Math.min(3, colWidth / unscaled.width));

      // Size every page wrapper up front (placeholders) so scroll math + restore
      // work before the canvases lazily render.
      const scale = baseScaleRef.current * zoomRef.current;
      for (let p = 1; p <= pdf.numPages; p++) {
        if (cancelled) return;
        const vp = (await pdf.getPage(p)).getViewport({ scale });
        const wrap = pageWrapsRef.current.get(p);
        if (wrap) {
          wrap.style.width = `${Math.floor(vp.width)}px`;
          wrap.style.height = `${Math.floor(vp.height)}px`;
        }
      }
      if (cancelled) return;
      setLoading(false);

      // Lazily render pages near the viewport; free those that scroll far away.
      observer = new IntersectionObserver(
        (entries) => {
          for (const e of entries) {
            const page = Number((e.target as HTMLElement).dataset.page);
            if (e.isIntersecting) void renderPage(page);
            else unrenderPage(page);
          }
        },
        { root: scrollRef.current, rootMargin: '800px 0px' },
      );
      for (const wrap of pageWrapsRef.current.values()) observer.observe(wrap);

      // Restore saved position (progress is stored as {page, y}).
      if (detail.progress?.cfi) {
        try {
          const prog = JSON.parse(detail.progress.cfi);
          const wrap =
            typeof prog?.page === 'number' ? pageWrapsRef.current.get(prog.page) : undefined;
          if (wrap) {
            scrollRef.current.scrollTop = wrap.offsetTop + (prog.y ?? 0) * wrap.offsetHeight;
          }
        } catch {
          /* ignore malformed progress */
        }
      }

      // Load saved highlights.
      void refreshMarks();
    }

    void init();
    return () => {
      cancelled = true;
      observer?.disconnect();
      if (saveTimer.current) clearTimeout(saveTimer.current);
      if (selectionTimer.current) clearTimeout(selectionTimer.current);
      void pdfRef.current?.destroy();
      pdfRef.current = null;
      renderedRef.current.clear();
      textLayersRef.current.clear();
      hlLayersRef.current.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId]);

  /* ── Re-layout + re-render on zoom change. ── */
  useEffect(() => {
    zoomRef.current = zoom;
    const pdf = pdfRef.current;
    if (!pdf || loading) return;
    let cancelled = false;
    (async () => {
      const scale = baseScaleRef.current * zoom;
      for (let p = 1; p <= pdf.numPages; p++) {
        if (cancelled) return;
        const vp = (await pdf.getPage(p)).getViewport({ scale });
        const wrap = pageWrapsRef.current.get(p);
        if (wrap) {
          wrap.style.width = `${Math.floor(vp.width)}px`;
          wrap.style.height = `${Math.floor(vp.height)}px`;
        }
      }
      // Force re-render of currently-rendered pages at the new scale.
      for (const page of Array.from(renderedRef.current)) {
        unrenderPage(page);
        void renderPage(page);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [zoom, loading, renderPage, unrenderPage]);

  /* ── Keep the active highlight in sync with the open translate panel. ── */
  useEffect(() => {
    activeLocatorRef.current = translateRequest?.cfiRange ?? null;
    redrawAllHighlights();
  }, [translateRequest, redrawAllHighlights]);

  /* ── Track scroll → reading progress (debounced save). ── */
  const onScroll = useCallback(() => {
    const root = scrollRef.current;
    if (!root || !numPages) return;
    const top = root.scrollTop;
    let current = 1;
    let frac = 0;
    for (let p = 1; p <= numPages; p++) {
      const wrap = pageWrapsRef.current.get(p);
      if (!wrap) continue;
      if (wrap.offsetTop <= top + 1) {
        current = p;
        frac = Math.min(1, Math.max(0, (top - wrap.offsetTop) / (wrap.offsetHeight || 1)));
      } else break;
    }
    const pct = Math.min(100, ((current - 1 + frac) / numPages) * 100);
    setPercentage(pct);

    // Chapter label: the last outline entry whose page is at/above the current.
    const idx0 = current - 1;
    let label = '';
    for (const c of chapters) {
      if (Number(c.href) <= idx0) label = c.label.trim();
      else break;
    }
    setChapterLabel(label);

    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      api
        .saveProgress({
          bookId,
          cfi: JSON.stringify({ page: current, y: frac }),
          percentage: pct,
          chapterLabel: label || undefined,
        })
        .catch(() => undefined);
    }, 800);
    setSelection(null);
  }, [bookId, numPages, chapters]);

  /* ── Text selection → translate / discuss popup. ── */
  const onMouseUp = useCallback(() => {
    if (selectionTimer.current) clearTimeout(selectionTimer.current);
    selectionTimer.current = setTimeout(() => {
      const sel = window.getSelection();
      const text = sel?.toString().trim();
      // A plain click (no text selected) dismisses any open popup.
      if (!sel || !text || sel.rangeCount === 0) {
        setSelection(null);
        return;
      }
      const range = sel.getRangeAt(0);

      // Resolve the page text layer that holds the selection start.
      let node: Node | null = range.startContainer;
      let layerEl: HTMLElement | null = null;
      while (node) {
        if (node instanceof HTMLElement && node.classList?.contains('textLayer')) {
          layerEl = node;
          break;
        }
        node = node.parentNode;
      }
      if (!layerEl) return;
      const page = Number(layerEl.parentElement?.dataset.page);
      if (!page) return;

      const start = charOffsetOf(layerEl, range.startContainer, range.startOffset);
      // End may fall in another page; clamp to this layer's text length.
      const sameLayer = layerEl.contains(range.endContainer);
      const end = sameLayer
        ? charOffsetOf(layerEl, range.endContainer, range.endOffset)
        : start + text.length;

      const rect = range.getBoundingClientRect();
      setSelection({
        text,
        locator: JSON.stringify({ page, start, end }),
        x: rect.left + rect.width / 2,
        y: rect.top,
      });
    }, 350);
  }, []);

  const goToPage = (page0: string) => {
    const wrap = pageWrapsRef.current.get(Number(page0) + 1);
    if (wrap && scrollRef.current) scrollRef.current.scrollTop = wrap.offsetTop;
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
            aria-label="Zoom out"
            onClick={() => setZoom((z) => Math.max(0.5, Math.round((z - 0.2) * 10) / 10))}
          >
            <Minus className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Zoom in"
            onClick={() => setZoom((z) => Math.min(3, Math.round((z + 0.2) * 10) / 10))}
          >
            <Plus className="h-4 w-4" />
          </Button>
          <ThemeToggle />
        </div>
      </header>

      {/* Body */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Table of contents (PDF outline) */}
        <aside className="w-72 shrink-0 overflow-y-auto border-r bg-card p-4">
          <h3 className="mb-3 px-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Contents
          </h3>
          {chapters.length === 0 ? (
            <p className="px-2 text-sm text-muted-foreground">No outline in this PDF.</p>
          ) : (
            <nav className="space-y-0.5">
              {chapters.map((item) => (
                <button
                  key={item.id}
                  onClick={() => goToPage(item.href)}
                  className="block w-full truncate rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
                >
                  {item.label.trim()}
                </button>
              ))}
            </nav>
          )}
        </aside>

        {/* Reading area */}
        <div className="relative min-h-0 flex-1 overflow-hidden">
          {loading && (
            <div className="absolute inset-0 z-20 flex items-center justify-center bg-background">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          )}

          <div
            ref={scrollRef}
            onScroll={onScroll}
            onMouseUp={onMouseUp}
            // `relative` makes this the offsetParent of the page wrappers, so
            // wrap.offsetTop is measured against scrollTop (progress + restore).
            className="relative h-full w-full overflow-y-auto bg-muted/40 py-6"
          >
            <div className="mx-auto flex w-fit flex-col items-center gap-6">
              {Array.from({ length: numPages }, (_, i) => i + 1).map((p) => (
                <div
                  key={p}
                  data-page={p}
                  ref={(el) => {
                    if (el) pageWrapsRef.current.set(p, el);
                    else pageWrapsRef.current.delete(p);
                  }}
                  className="relative bg-white shadow-md"
                />
              ))}
            </div>
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
                  setTranslateRequest({ text: selection.text, cfiRange: selection.locator });
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
                  setDiscussRequest({ text: selection.text, cfiRange: selection.locator });
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
        onTranslated={() => void refreshMarks()}
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
