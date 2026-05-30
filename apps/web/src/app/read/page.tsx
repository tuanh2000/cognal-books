'use client';

import { Suspense } from 'react';
import dynamic from 'next/dynamic';
import { Loader2 } from 'lucide-react';
import { useSearchParams } from 'next/navigation';

// EPUB.js touches the DOM/iframe APIs — load it client-side only.
const EpubReader = dynamic(
  () => import('@/components/reader/epub-reader').then((m) => m.EpubReader),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    ),
  },
);

const Spinner = () => (
  <div className="flex h-screen items-center justify-center">
    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
  </div>
);

function ReadView() {
  const bookId = useSearchParams().get('bookId');
  if (!bookId) return <Spinner />;
  return <EpubReader bookId={bookId} />;
}

export default function ReadPage() {
  // useSearchParams() must be wrapped in a Suspense boundary for static export.
  return (
    <Suspense fallback={<Spinner />}>
      <ReadView />
    </Suspense>
  );
}
