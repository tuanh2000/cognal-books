'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Sparkles, Loader2, X, Send, Bot, User } from 'lucide-react';
import { streamDiscuss } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface DiscussRequest {
  text: string;
  cfiRange?: string;
}

interface Props {
  request: DiscussRequest | null;
  bookId: string;
  onClose: () => void;
}

interface Msg {
  role: 'user' | 'assistant';
  content: string;
}

// Vietnamese first turn: ask the model to summarise the selected passage.
const SUMMARY_PROMPT = 'Hãy tóm tắt những nội dung chính được thảo luận trong đoạn này.';

/**
 * Side panel that discusses a selected passage with the AI: it opens by
 * auto-streaming a Vietnamese summary, then lets the reader ask follow-up
 * questions. The book's metadata is added as context on the server. The
 * conversation is ephemeral — it resets each time a new passage is opened.
 */
export function DiscussPanel({ request, bookId, onClose }: Props) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [draft, setDraft] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [provider, setProvider] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Stream a reply for the given conversation `history` (the last turn must be a
  // user message). Shows the thread immediately with an assistant placeholder
  // the stream fills in. Shared by the auto-summary and follow-up questions.
  const send = useCallback(
    (history: Msg[]) => {
      if (!request) return;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setError(null);
      setProvider(null);
      setStreaming(true);
      setMessages([...history, { role: 'assistant', content: '' }]);

      streamDiscuss(
        { bookId, text: request.text, cfiRange: request.cfiRange, messages: history },
        {
          onToken: (value) =>
            setMessages((prev) => {
              const next = [...prev];
              const last = next[next.length - 1];
              if (last?.role === 'assistant')
                next[next.length - 1] = { ...last, content: last.content + value };
              return next;
            }),
          onDone: (usedProvider) => {
            if (usedProvider) setProvider(usedProvider);
            setStreaming(false);
          },
          onError: (message) => {
            setError(message);
            setStreaming(false);
            // Drop the empty assistant placeholder so the thread stays clean.
            setMessages((prev) =>
              prev.length &&
              prev[prev.length - 1].role === 'assistant' &&
              !prev[prev.length - 1].content
                ? prev.slice(0, -1)
                : prev,
            );
          },
        },
        controller.signal,
      );
    },
    [request, bookId],
  );

  // On (re)open with a new passage: reset and kick off the auto-summary.
  useEffect(() => {
    if (!request) return;
    setDraft('');
    send([{ role: 'user', content: SUMMARY_PROMPT }]);
    return () => abortRef.current?.abort();
    // `send` only depends on the passage + bookId, so this re-runs per passage.
  }, [request, send]);

  // Keep the latest message in view as tokens stream in.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  const submit = () => {
    const q = draft.trim();
    if (!q || streaming) return;
    setDraft('');
    send([...messages, { role: 'user', content: q }]);
  };

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
          <Sparkles className="h-5 w-5 text-primary" />
          <h2 className="font-semibold">Discuss</h2>
          {provider && (
            <span className="rounded-full bg-secondary px-2 py-0.5 text-xs capitalize text-muted-foreground">
              via {provider}
            </span>
          )}
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close">
          <X className="h-5 w-5" />
        </Button>
      </div>

      <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
        {request && (
          <div>
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Passage
            </p>
            <p className="max-h-32 overflow-y-auto rounded-lg bg-muted p-3 text-sm leading-relaxed">
              {request.text}
            </p>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={cn('flex gap-2', m.role === 'user' && 'flex-row-reverse')}>
            <span
              className={cn(
                'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full',
                m.role === 'user'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-secondary text-foreground',
              )}
            >
              {m.role === 'user' ? (
                <User className="h-3.5 w-3.5" />
              ) : (
                <Bot className="h-3.5 w-3.5" />
              )}
            </span>
            <div
              className={cn(
                'max-w-[85%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm leading-relaxed',
                m.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-muted',
              )}
            >
              {m.content}
              {m.role === 'assistant' && !m.content && streaming && (
                <Loader2 className="inline h-4 w-4 animate-spin align-middle" />
              )}
            </div>
          </div>
        ))}

        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>

      <div className="border-t p-3">
        <div className="flex items-end gap-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            rows={1}
            placeholder="Ask a follow-up question…"
            className="max-h-32 min-h-[2.5rem] flex-1 resize-none rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
          <Button
            size="icon"
            aria-label="Send"
            disabled={streaming || !draft.trim()}
            onClick={submit}
          >
            {streaming ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>
    </aside>
  );
}
