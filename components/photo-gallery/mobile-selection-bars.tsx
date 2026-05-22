'use client';

import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';

interface MobileSelectionBarsProps {
  /** Localized "N selected" line. */
  countLabel: string;
  exitLabel: string;
  onExit: () => void;
  /** The bulk-action buttons for the bottom bar. */
  children: ReactNode;
}

/**
 * The mobile selection chrome — a floating top bar (count + X to exit) and a
 * floating bottom action bar (bulk actions). Both are `md:hidden` and sit at
 * `z-[60]`, above the `z-50` navbars (which they visually replace) and below
 * the `z-[100]` lightbox. They match the navbar boxes 1:1 — the top bar is
 * `h-(--header-height)` like the header; the bottom bar is `min-h-16` +
 * `pb-[env(safe-area-inset-bottom)]` like the bottom nav. Rendered only while
 * selecting on a touch device; the desktop inline toolbar is used otherwise.
 */
export function MobileSelectionBars({
  countLabel,
  exitLabel,
  onExit,
  children,
}: MobileSelectionBarsProps) {
  return (
    <>
      <section
        className="fixed inset-x-0 top-0 z-[60] flex h-(--header-height) items-center gap-2 border-b border-border bg-background/95 px-3 backdrop-blur md:hidden"
        aria-label={countLabel}
      >
        <Button type="button" variant="ghost" size="icon" onClick={onExit} aria-label={exitLabel}>
          <X className="h-5 w-5" />
        </Button>
        <span className="text-sm font-medium" aria-live="polite">
          {countLabel}
        </span>
      </section>
      <div className="fixed inset-x-0 bottom-0 z-[60] flex min-h-16 items-center gap-2 overflow-x-auto border-t border-border bg-background/95 px-3 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {children}
      </div>
    </>
  );
}
