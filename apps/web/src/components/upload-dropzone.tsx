'use client';

import { useCallback, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, UploadCloud } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { renderPdfCover } from '@/lib/pdf-cover';
import { cn } from '@/lib/utils';

export function UploadDropzone() {
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upload = useMutation({
    mutationFn: async (file: File) => {
      // PDFs carry no embedded cover — render page 1 here and send it along.
      const cover = file.name.toLowerCase().endsWith('.pdf') ? await renderPdfCover(file) : null;
      return api.uploadBook(file, cover);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['books'] }),
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Upload failed'),
  });

  const handleFiles = useCallback(
    (files: FileList | null) => {
      setError(null);
      const file = files?.[0];
      if (!file) return;
      const name = file.name.toLowerCase();
      if (!name.endsWith('.epub') && !name.endsWith('.pdf')) {
        setError('Only .epub and .pdf files are supported');
        return;
      }
      upload.mutate(file);
    },
    [upload],
  );

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => e.key === 'Enter' && inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          handleFiles(e.dataTransfer.files);
        }}
        className={cn(
          'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-8 text-center transition-colors',
          dragging ? 'border-primary bg-accent' : 'border-border hover:border-primary/60',
        )}
      >
        {upload.isPending ? (
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        ) : (
          <UploadCloud className="h-8 w-8 text-muted-foreground" />
        )}
        <p className="font-medium">
          {upload.isPending ? 'Uploading…' : 'Drop an EPUB or PDF here, or click to browse'}
        </p>
        <p className="text-sm text-muted-foreground">.epub and .pdf files</p>
        <input
          ref={inputRef}
          type="file"
          accept=".epub,application/epub+zip,.pdf,application/pdf"
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
      </div>
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
    </div>
  );
}
