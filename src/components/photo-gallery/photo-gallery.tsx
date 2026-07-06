'use client';

import { Loader2 } from 'lucide-react';
import { type ComponentProps, type ReactNode, useEffect, useMemo } from 'react';
import PhotoAlbumViewer, { type PhotoAlbumItem } from '@/components/photo-album-viewer';
import { PhotoSelectionToolbar } from '@/components/photo-selection-toolbar';
import { Button } from '@/components/ui/button';
import { usePhotoSelection } from '@/hooks/use-photo-selection';
import { cn } from '@/lib/utils';
import type {
  PhotoGalleryBulkAction,
  PhotoGallerySection,
  PhotoGallerySelectionLabels,
} from './types';

/** The per-photo action config forwarded to the underlying grid. Selection
 * and the clean-mobile toggle are owned by `PhotoGallery`. */
type AlbumConfig = Omit<
  ComponentProps<typeof PhotoAlbumViewer>,
  'items' | 'selectionMode' | 'selectedIds' | 'onToggleSelect' | 'cleanOnCoarsePointer'
>;

interface PhotoGalleryProps {
  /** A flat gallery — provide this OR `sections`. */
  items?: PhotoAlbumItem[];
  /** A bucketed gallery (AI face-search results) — one selection set + one
   * grid per section. */
  sections?: PhotoGallerySection[];
  /** Per-photo / lightbox action config forwarded to the grid. */
  galleryProps: AlbumConfig;
  /** When false, no Select button and no selection mode. */
  selectable?: boolean;
  /** Bulk actions for the selection bars (desktop toolbar + mobile bottom bar). */
  bulkActions?: PhotoGalleryBulkAction[];
  /** A stable value the host bumps to force a selection reset (e.g. when the
   * AI face-search results change). */
  selectionResetKey?: string | number;
  /** Slot on the desktop toolbar — the filter tabs. */
  toolbarLeading?: ReactNode;
  toolbarClassName?: string;
  /** Extra classes on the grid wrapper — e.g. `-mx-3.5 sm:mx-0` to bleed the
   * grid near full-width on mobile while the padded toolbar stays put. */
  gridClassName?: string;
  /** Selection-bar copy — only needed when `selectable` (the default). */
  labels?: PhotoGallerySelectionLabels;
  /** Rendered when there are no photos. */
  emptyState?: ReactNode;
  /** "Load more" footer for the paginated flat grid. Ignored on the `sections`
   * (AI-results) path. Hidden when `hasMore` is false. */
  loadMore?: {
    hasMore: boolean;
    isLoading: boolean;
    onLoadMore: () => void;
    label: string;
  };
  /** Load-more batch sizes for the flat `items` grid — lays out each batch as
   * an independent segment so appending never re-flows on-screen photos. Only
   * applies to the flat `items` path (not `sections`). */
  segmentSizes?: number[];
}

const EMPTY_SELECTION_LABELS: PhotoGallerySelectionLabels = {
  select: '',
  clear: '',
  countNone: '',
  countOne: '',
  countMany: '',
  exitSelection: '',
};

/**
 * The event photo gallery: a clean grid, tap → lightbox, hover actions
 * (desktop), and a sticky `PhotoSelectionToolbar`. Selection mode is entered via
 * the "Select" button; the toolbar slot then shows the count + an exit (X) in
 * the same place (stable height → the grid never jumps). The bulk actions sit
 * inline in that toolbar on desktop, and in a fixed bottom bar over the nav on
 * mobile. Owns selection state; the host supplies the per-photo + bulk handlers.
 */
export function PhotoGallery({
  items,
  sections,
  galleryProps,
  selectable = true,
  bulkActions = [],
  selectionResetKey,
  toolbarLeading,
  toolbarClassName,
  gridClassName,
  labels = EMPTY_SELECTION_LABELS,
  emptyState,
  loadMore,
  segmentSizes,
}: PhotoGalleryProps) {
  const selection = usePhotoSelection();

  // biome-ignore lint/correctness/useExhaustiveDependencies: resets intentionally when the host bumps the key
  useEffect(() => {
    selection.clear();
  }, [selectionResetKey, selection.clear]);

  const allItems = useMemo(
    () => items ?? (sections ?? []).flatMap((s) => s.items),
    [items, sections],
  );

  const countLabel =
    selection.selectedIds.length === 0
      ? labels.countNone
      : selection.selectedIds.length === 1
        ? labels.countOne
        : labels.countMany.replace('{n}', String(selection.selectedIds.length));

  const bulkButtons = bulkActions
    .filter((action) => action.visible !== false)
    .map((action) => (
      <Button
        key={action.key}
        type="button"
        variant="outline"
        size="sm"
        disabled={selection.selectedIds.length === 0 || action.isPending}
        onClick={() => action.onRun(selection.selectedIds)}
      >
        <action.icon className="mr-2 h-4 w-4" />
        {action.label}
      </Button>
    ));

  const albumSelectionProps = {
    selectionMode: selection.isSelecting,
    selectedIds: selection.selectedIds,
    onToggleSelect: selectable ? selection.toggle : undefined,
    cleanOnCoarsePointer: true,
  } as const;

  const grids = sections ? (
    sections.map((section) => (
      <section key={section.key} className="flex flex-col gap-2">
        {section.header ??
          (section.title ? (
            <header>
              <h3 className="text-sm font-semibold">{section.title}</h3>
              {section.subtitle ? (
                <p className="text-xs text-muted-foreground">{section.subtitle}</p>
              ) : null}
            </header>
          ) : null)}
        <PhotoAlbumViewer items={section.items} {...albumSelectionProps} {...galleryProps} />
      </section>
    ))
  ) : (
    <PhotoAlbumViewer
      items={items ?? []}
      segmentSizes={segmentSizes}
      {...albumSelectionProps}
      {...galleryProps}
    />
  );

  // One sticky inline toolbar serves both states on every device — the "Select"
  // button (+ filter tabs) when idle, and the count + exit (X) + bulk actions
  // while selecting. It keeps a stable height across states (see
  // PhotoSelectionToolbar), so entering selection never shifts the grid below.
  // The toolbar stays mounted whenever there's a filter slot (`toolbarLeading`)
  // — so the tabs never disappear, even when the active tab is empty — or there
  // are photos to select, or selection is active.
  const showInlineToolbar =
    selection.isSelecting || toolbarLeading != null || (selectable && allItems.length > 0);

  return (
    <div className="space-y-1">
      {showInlineToolbar ? (
        <PhotoSelectionToolbar
          className={toolbarClassName}
          leading={toolbarLeading}
          selectable={selectable}
          isSelecting={selection.isSelecting}
          countLabel={countLabel}
          selectLabel={labels.select}
          clearLabel={labels.clear}
          exitLabel={labels.exitSelection}
          onStartSelecting={selection.startSelecting}
          onClear={selection.clear}
        >
          {bulkButtons}
        </PhotoSelectionToolbar>
      ) : null}

      {allItems.length === 0 ? (
        emptyState
      ) : (
        <div className={cn('flex flex-col gap-4', gridClassName)}>{grids}</div>
      )}

      {/* "Load more" — flat grid only (never the AI-results `sections` path). */}
      {!sections && loadMore?.hasMore ? (
        <div className="flex justify-center pt-4">
          <Button
            type="button"
            variant="outline"
            onClick={loadMore.onLoadMore}
            disabled={loadMore.isLoading}
          >
            {loadMore.isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {loadMore.label}
          </Button>
        </div>
      ) : null}

      {selection.isSelecting && bulkButtons.length > 0 ? (
        // Mobile only: the bulk actions live in a fixed bar over the bottom nav
        // (same height), horizontally scrollable, staying visible until
        // selection exits. Desktop shows the same actions inline in the toolbar
        // above instead (so they render in both places, CSS hides one).
        <div className="fixed inset-x-0 bottom-0 z-[60] flex min-h-16 items-center gap-2 overflow-x-auto border-t border-border bg-background/95 px-3 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {bulkButtons}
        </div>
      ) : null}
    </div>
  );
}
