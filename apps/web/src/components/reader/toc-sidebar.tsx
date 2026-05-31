'use client';

import { cn } from '@/lib/utils';

/**
 * Collapsible table-of-contents sidebar shared by the EPUB and PDF readers.
 * - Desktop (lg+): an inline column that can be hidden to widen the reading area.
 * - Mobile: an overlay drawer with a backdrop; tapping the backdrop closes it.
 *
 * The parent body container must be `relative` so the mobile overlay anchors to it.
 */
export function TocSidebar({
  open,
  onClose,
  title = 'Contents',
  children,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <>
      {open && (
        <div
          onClick={onClose}
          aria-hidden
          className="absolute inset-0 z-20 bg-black/40 lg:hidden"
        />
      )}
      <aside
        className={cn(
          'absolute inset-y-0 left-0 z-30 w-72 max-w-[80%] shrink-0 overflow-y-auto border-r bg-card p-4',
          'transition-transform duration-200 lg:static lg:z-auto lg:max-w-none lg:transition-none',
          open ? 'translate-x-0' : '-translate-x-full lg:hidden',
        )}
      >
        <h3 className="mb-3 px-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </h3>
        {children}
      </aside>
    </>
  );
}
