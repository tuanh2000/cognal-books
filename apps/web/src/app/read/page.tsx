'use client';

import { Suspense } from 'react';
import dynamic from 'next/dynamic';
import { Loader2 } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

// Both readers touch the DOM/iframe/canvas APIs — load them client-side only.
const EpubReader = dynamic(
  () => import('@/components/reader/epub-reader').then((m) => m.EpubReader),
  { ssr: false, loading: () => <Spinner /> },
);
const PdfReader = dynamic(() => import('@/components/reader/pdf-reader').then((m) => m.PdfReader), {
  ssr: false,
  loading: () => <Spinner />,
});

function Spinner() {
  return (
    <div className="flex h-screen items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
    </div>
  );
}

function ReadView() {
  const bookId = useSearchParams().get('bookId');
  // Decide which reader to mount based on the book's format. The readers fetch
  // the file themselves; this only needs the lightweight metadata.
  const { data: book } = useQuery({
    queryKey: ['book', bookId],
    queryFn: () => api.getBook(bookId as string),
    enabled: !!bookId,
  });

  if (!bookId || !book) return <Spinner />;
  return book.format === 'pdf' ? <PdfReader bookId={bookId} /> : <EpubReader bookId={bookId} />;
}

export default function ReadPage() {
  // useSearchParams() must be wrapped in a Suspense boundary for static export.
  return (
    <Suspense fallback={<Spinner />}>
      <ReadView />
    </Suspense>
  );
}
