'use client';

import { use } from 'react';
import dynamic from 'next/dynamic';
import { Loader2 } from 'lucide-react';
import { useAuthGuard } from '@/lib/use-auth-guard';

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

export default function ReadPage({ params }: { params: Promise<{ bookId: string }> }) {
  const { bookId } = use(params);
  const ready = useAuthGuard();
  if (!ready) return null;
  return <EpubReader bookId={bookId} />;
}
