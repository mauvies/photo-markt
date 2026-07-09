'use client';

import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/** Localized copy for the selection toolbar + bulk-download / bulk-cart actions. */
export type BulkDownloadLabels = {
  select: string;
  countNone: string;
  countOne: string;
  /** Template with `{n}`. */
  countMany: string;
  download: string;
  preparing: string;
  failed: string;
  /** Template with `{n}` (downloaded) and `{m}` (skipped). */
  skipped: string;
  nonePurchased: string;
  /** aria-label for the mobile selection bar's exit (X) button. */
  exitSelection: string;
  /** Bulk "Add to cart" action button label. */
  addToCart: string;
  /** Toast — exactly one photo added to the cart. */
  addedToCartOne: string;
  /** Toast — `{n}` photos added to the cart. */
  addedToCartMany: string;
  /** Toast — every selected photo was already in the cart. */
  alreadyInCart: string;
  /** "View cart" action label on the add-to-cart toast. */
  viewCart: string;
};

interface PhotoSelectionToolbarProps {
  isSelecting: boolean;
  /** Localized "N photos selected" line, shown while selecting. */
  countLabel: string;
  selectLabel: string;
  /** aria-label for the exit (X) button shown while selecting. */
  exitLabel: string;
  onStartSelecting: () => void;
  onClear: () => void;
  /** View-specific bulk actions (Download, Delete, …) rendered while selecting. */
  children?: ReactNode;
  /** Optional left-aligned content on the same row — e.g. the photo filter tabs. */
  leading?: ReactNode;
  /** When false, the Select/selection UI is hidden and only `leading` shows. */
  selectable?: boolean;
  /** Positioning — each view passes its own sticky offset / negative margins. */
  className?: string;
}

/**
 * Shared sticky bar above an event photo grid: a "Select" toggle, and — while
 * selecting — an X (exit/clear) icon, the selected-count, and the view's bulk
 * actions. Used by the photographer, talent and public event-detail views so
 * the selection UI stays identical across all viewports. An optional `leading`
 * slot (the photo filter tabs) sits on the same row, to the left.
 */
export function PhotoSelectionToolbar({
  isSelecting,
  countLabel,
  selectLabel,
  exitLabel,
  onStartSelecting,
  onClear,
  children,
  leading,
  selectable = true,
  className,
}: PhotoSelectionToolbarProps) {
  return (
    <div className={cn('z-30 bg-background/95 py-3 backdrop-blur-sm', className)}>
      {/* Single row in both states so the toolbar height never changes — no
          layout shift when entering/leaving selection. While selecting, the
          filter tabs (`leading`) are hidden entirely and replaced by the
          selection actions; min-h keeps the row height identical to the tabs
          row (which is a touch taller than the sm buttons). */}
      <div className="flex min-h-9 items-center gap-1 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {selectable && isSelecting ? (
          <>
            {/* The X (exit/clear) icon + count sit left-aligned on every
                viewport, so clearing the selection is the same gesture on
                desktop and mobile. On mobile the bulk actions render in the
                fixed bottom bar; on desktop they sit inline on the right. The
                row height matches the idle "Select" row, so entering selection
                never shifts the grid. */}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={onClear}
              aria-label={exitLabel}
              className="-ml-1 size-8 shrink-0"
            >
              <X className="h-5 w-5" />
            </Button>
            <div className="shrink-0 whitespace-nowrap text-sm font-medium">{countLabel}</div>
            <div className="ml-auto hidden shrink-0 items-center gap-2 md:flex">{children}</div>
          </>
        ) : (
          <>
            {leading}
            {selectable && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onStartSelecting}
                className="ml-auto shrink-0"
              >
                {selectLabel}
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
