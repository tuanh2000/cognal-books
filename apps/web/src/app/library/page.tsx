'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { BookOpen, Loader2, Settings } from 'lucide-react';
import { api } from '@/lib/api';
import { UploadDropzone } from '@/components/upload-dropzone';
import { BookCard } from '@/components/book-card';
import { ThemeToggle } from '@/components/theme-toggle';
import { Button } from '@/components/ui/button';

export default function LibraryPage() {
  const { data: books, isLoading } = useQuery({
    queryKey: ['books'],
    queryFn: api.listBooks,
  });

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 border-b bg-background/80 backdrop-blur">
        <div className="container flex h-16 items-center justify-between">
          <div className="flex items-center gap-2 text-primary">
            <BookOpen className="h-6 w-6" />
            <span className="text-xl font-semibold tracking-tight">Lumen</span>
          </div>
          <div className="flex items-center gap-1">
            <Button asChild variant="ghost" size="icon" aria-label="Settings">
              <Link href="/settings">
                <Settings className="h-5 w-5" />
              </Link>
            </Button>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="container py-8">
        <h1 className="mb-6 text-2xl font-semibold tracking-tight">Your Library</h1>

        <div className="mb-10 max-w-2xl">
          <UploadDropzone />
        </div>

        {isLoading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : books && books.length > 0 ? (
          <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {books.map((book) => (
              <BookCard key={book.id} book={book} />
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed py-20 text-center text-muted-foreground">
            <BookOpen className="mx-auto mb-3 h-10 w-10 opacity-50" />
            <p>No books yet. Upload your first EPUB above.</p>
          </div>
        )}
      </main>
    </div>
  );
}
