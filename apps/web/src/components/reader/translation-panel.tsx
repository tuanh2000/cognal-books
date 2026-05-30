'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Languages, Loader2, X, Database, Bookmark, RefreshCw } from 'lucide-react';
import { streamTranslation } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface PanelRequest {
  text: string;
  cfiRange?: string;
  /** When set, show this saved translation immediately (no AI call). */
  preloaded?: string;
}

interface Props {
  request: PanelRequest | null;
  bookId: string;
  onClose: () => void;
  /** Called when a fresh translation completes, so the reader can highlight it. */
  onTranslated?: (cfiRange: string, sourceText: string, translatedText: string) => void;
}

/** Side panel: streams a translation, or shows a saved one with a re-translate button. */
export function TranslationPanel({ request, bookId, onClose, onTranslated }: Props) {
  const [output, setOutput] = useState('');
  const [loading, setLoading] = useState(false);
  const [cached, setCached] = useState(false);
  const [saved, setSaved] = useState(false);
  const [provider, setProvider] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const run = useCallback(
    (force: boolean) => {
      if (!request) return;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setOutput('');
      setError(null);
      setCached(false);
      setSaved(false);
      setProvider(null);
      setLoading(true);

      streamTranslation(
        { text: request.text, targetLang: 'vi', bookId, cfiRange: request.cfiRange, force },
        {
          onMeta: (isCached) => setCached(isCached),
          onToken: (value) => setOutput((prev) => prev + value),
          onDone: (text, usedProvider) => {
            if (usedProvider) setProvider(usedProvider);
            setLoading(false);
            if (request.cfiRange) onTranslated?.(request.cfiRange, request.text, text);
          },
          onError: (message) => {
            setError(message);
            setLoading(false);
          },
        },
        controller.signal,
      );
    },
    [request, bookId, onTranslated],
  );

  useEffect(() => {
    if (!request) return;
    // A saved translation: show instantly, no API call.
    if (request.preloaded != null) {
      abortRef.current?.abort();
      setOutput(request.preloaded);
      setError(null);
      setCached(false);
      setProvider(null);
      setLoading(false);
      setSaved(true);
      return;
    }
    run(false);
    return () => abortRef.current?.abort();
  }, [request, run]);

  const open = request != null;

  return (
    <aside
      className={cn(
        'fixed right-0 top-0 z-40 flex h-full w-full max-w-md transform flex-col border-l bg-card shadow-2xl transition-transform duration-300',
        open ? 'translate-x-0' : 'translate-x-full',
      )}
    >
      <div className="flex items-center justify-between border-b px-5 py-4">
        <div className="flex items-center gap-2">
          <Languages className="h-5 w-5 text-primary" />
          <h2 className="font-semibold">Vietnamese</h2>
          {saved ? (
            <span className="flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-xs text-muted-foreground">
              <Bookmark className="h-3 w-3" /> saved
            </span>
          ) : cached ? (
            <span className="flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-xs text-muted-foreground">
              <Database className="h-3 w-3" /> cached
            </span>
          ) : (
            provider && (
              <span className="rounded-full bg-secondary px-2 py-0.5 text-xs capitalize text-muted-foreground">
                via {provider}
              </span>
            )
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Re-translate"
            title="Re-translate with AI"
            disabled={loading}
            onClick={() => run(true)}
          >
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
          </Button>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close">
            <X className="h-5 w-5" />
          </Button>
        </div>
      </div>

      <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
        {request && (
          <div>
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Original
            </p>
            <p className="rounded-lg bg-muted p-3 text-sm leading-relaxed">{request.text}</p>
          </div>
        )}

        <div>
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Translation
          </p>
          {error ? (
            <p className="text-sm text-destructive">{error}</p>
          ) : (
            <p className="whitespace-pre-wrap text-base leading-relaxed">
              {output}
              {loading && <Loader2 className="ml-1 inline h-4 w-4 animate-spin align-middle" />}
            </p>
          )}
        </div>
      </div>
    </aside>
  );
}
