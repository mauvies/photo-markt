'use client';

import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/** Localized copy for the selection toolbar + bulk-download action. */
export type BulkDownloadLabels = {
  select: string;
  clear: string;
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
};

interface PhotoSelectionToolbarProps {
  isSelecting: boolean;
  /** Localized "N photos selected" line, shown while selecting. */
  countLabel: string;
  selectLabel: string;
  clearLabel: string;
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
 * selecting — the selected-count, a "Clear" button, and the view's bulk
 * actions. Used by the photographer, talent and public event-detail views so
 * the selection UI stays identical across all three. An optional `leading`
 * slot (the photo filter tabs) sits on the same row, to the left.
 */
export function PhotoSelectionToolbar({
  isSelecting,
  countLabel,
  selectLabel,
  clearLabel,
  onStartSelecting,
  onClear,
  children,
  leading,
  selectable = true,
  className,
}: PhotoSelectionToolbarProps) {
  return (
    <div className={cn('z-30 bg-background/95 py-3 backdrop-blur-sm', className)}>
      <div className="flex items-center gap-3 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {leading}
        {!selectable ? null : isSelecting ? (
          <>
            <div className="shrink-0 whitespace-nowrap text-sm font-medium">{countLabel}</div>
            <div className="ml-auto flex shrink-0 items-center gap-2">
              <Button type="button" variant="outline" size="sm" onClick={onClear}>
                {clearLabel}
              </Button>
              {children}
            </div>
          </>
        ) : (
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
      </div>
    </div>
  );
}
