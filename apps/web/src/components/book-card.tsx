'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { BookOpen } from 'lucide-react';
import type { BookListItem } from '@reader/shared';
import { api } from '@/lib/api';

export function BookCard({ book }: { book: BookListItem }) {
  const [coverUrl, setCoverUrl] = useState<string | null>(null);

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
    <Link
      href={`/read?bookId=${book.id}`}
      className="group flex flex-col overflow-hidden rounded-xl border bg-card transition-all hover:-translate-y-1 hover:shadow-lg"
    >
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
      </div>
      <div className="flex flex-1 flex-col p-3">
        <h3 className="line-clamp-2 font-medium leading-snug">{book.title}</h3>
        {book.author && (
          <p className="mt-0.5 line-clamp-1 text-sm text-muted-foreground">{book.author}</p>
        )}
        <p className="mt-auto pt-2 text-xs text-muted-foreground">
          {pct > 0 ? `${pct}% read` : 'Not started'}
        </p>
      </div>
    </Link>
  );
}
