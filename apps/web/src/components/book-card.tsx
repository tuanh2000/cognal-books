'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { BookOpen, Globe, Loader2, Lock, Trash2 } from 'lucide-react';
import type { BookListItem } from '@reader/shared';
import { api } from '@/lib/api';

export function BookCard({ book }: { book: BookListItem }) {
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const queryClient = useQueryClient();

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['books'] });
    queryClient.invalidateQueries({ queryKey: ['public-books'] });
  };

  const remove = useMutation({
    mutationFn: () => api.deleteBook(book.id),
    onSuccess: invalidate,
  });

  const share = useMutation({
    mutationFn: () => api.setBookPublic(book.id, !book.isPublic),
    onSuccess: invalidate,
  });

  useEffect(() => {
    let revoked: string | null = null;
    if (book.coverUrl) {
      api.getCoverObjectUrl(book.coverUrl).then((url) => {
        if (url) {
          revoked = url;
          setCoverUrl(url);
        }
      });
    }
    return () => {
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [book.coverUrl]);

  const pct = book.progress ? Math.round(book.progress.percentage) : 0;

  return (
    <div className="group relative flex flex-col overflow-hidden rounded-xl border bg-card transition-all hover:-translate-y-1 hover:shadow-lg">
      <Link href={`/read?bookId=${book.id}`} className="flex flex-1 flex-col">
        <div className="relative aspect-[2/3] w-full overflow-hidden bg-muted">
          {coverUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={coverUrl} alt={book.title} className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-muted-foreground">
              <BookOpen className="h-10 w-10" />
            </div>
          )}
          {pct > 0 && (
            <div className="absolute inset-x-0 bottom-0 h-1.5 bg-black/20">
              <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
            </div>
          )}
          {book.isPublic && (
            <span className="absolute left-2 top-2 flex items-center gap-1 rounded-full bg-primary/90 px-2 py-0.5 text-[10px] font-medium text-primary-foreground shadow-sm">
              <Globe className="h-3 w-3" /> Shared
            </span>
          )}
        </div>
        <div className="flex flex-1 flex-col p-3">
          <h3 className="line-clamp-2 font-medium leading-snug">{book.title}</h3>
          {book.author && (
            <p className="mt-0.5 line-clamp-1 text-sm text-muted-foreground">{book.author}</p>
          )}
          {!book.isOwner && book.ownerEmail && (
            <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
              Shared by {book.ownerEmail}
            </p>
          )}
          <p className="mt-auto pt-2 text-xs text-muted-foreground">
            {pct > 0 ? `${pct}% read` : 'Not started'}
          </p>
        </div>
      </Link>

      {/* Owner-only controls: share/unshare + delete. */}
      {book.isOwner && (
        <div className="absolute right-2 top-2 flex gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
          <button
            type="button"
            aria-label={book.isPublic ? 'Make private' : 'Share publicly'}
            title={book.isPublic ? 'Make private' : 'Share with everyone'}
            onClick={() => share.mutate()}
            disabled={share.isPending}
            className="rounded-full bg-black/50 p-1.5 text-white transition-colors hover:bg-black/70"
          >
            {share.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : book.isPublic ? (
              <Lock className="h-4 w-4" />
            ) : (
              <Globe className="h-4 w-4" />
            )}
          </button>
          <button
            type="button"
            aria-label="Remove book"
            onClick={() => setConfirming(true)}
            className="rounded-full bg-black/50 p-1.5 text-white transition-colors hover:bg-black/70"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      )}

      {confirming && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-background/95 p-4 text-center">
          <p className="text-sm font-medium">Remove this book?</p>
          <p className="line-clamp-2 text-xs text-muted-foreground">{book.title}</p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={remove.isPending}
              className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => remove.mutate()}
              disabled={remove.isPending}
              className="inline-flex items-center gap-1.5 rounded-md bg-destructive px-3 py-1.5 text-sm font-medium text-destructive-foreground hover:bg-destructive/90 disabled:opacity-60"
            >
              {remove.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Remove
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
