'use client';

import { type ComponentProps, type ReactNode, useEffect, useMemo } from 'react';
import PhotoAlbumViewer, { type PhotoAlbumItem } from '@/components/photo-album-viewer';
import { PhotoSelectionToolbar } from '@/components/photo-selection-toolbar';
import { Button } from '@/components/ui/button';
import { useCoarsePointer } from '@/hooks/use-coarse-pointer';
import { usePhotoSelection } from '@/hooks/use-photo-selection';
import { MobileSelectionBars } from './mobile-selection-bars';
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
  /** Selection-bar copy — only needed when `selectable` (the default). */
  labels?: PhotoGallerySelectionLabels;
  /** Rendered when there are no photos. */
  emptyState?: ReactNode;
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
 * (desktop), and the selection bars. Selection mode is entered via the
 * "Select" button — on a touch device it shows floating top/bottom bars, on
 * desktop the inline `PhotoSelectionToolbar`. Owns selection state; the host
 * supplies the per-photo + bulk action handlers.
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
  labels = EMPTY_SELECTION_LABELS,
  emptyState,
}: PhotoGalleryProps) {
  const selection = usePhotoSelection();
  const coarsePointer = useCoarsePointer();

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
    <PhotoAlbumViewer items={items ?? []} {...albumSelectionProps} {...galleryProps} />
  );

  // Desktop: the inline toolbar always. Touch: the inline toolbar while NOT
  // selecting (it holds the Select button + filter tabs); the floating bars
  // replace it while selecting. The toolbar stays mounted whenever there's a
  // filter slot (`toolbarLeading`) — so the tabs never disappear, even when
  // the active tab is empty — or there are photos to select, or selection is
  // active. It's skipped only for a bare, photo-less, tab-less gallery.
  const hasToolbarContent =
    selection.isSelecting || toolbarLeading != null || (selectable && allItems.length > 0);
  const showInlineToolbar = hasToolbarContent && !(coarsePointer && selection.isSelecting);
  const showMobileBars = coarsePointer && selection.isSelecting;

  return (
    <div className="space-y-3">
      {showInlineToolbar ? (
        <PhotoSelectionToolbar
          className={toolbarClassName}
          leading={selection.isSelecting ? undefined : toolbarLeading}
          selectable={selectable}
          isSelecting={selection.isSelecting}
          countLabel={countLabel}
          selectLabel={labels.select}
          clearLabel={labels.clear}
          onStartSelecting={selection.startSelecting}
          onClear={selection.clear}
        >
          {bulkButtons}
        </PhotoSelectionToolbar>
      ) : null}

      {allItems.length === 0 ? emptyState : <div className="flex flex-col gap-4">{grids}</div>}

      {showMobileBars ? (
        <MobileSelectionBars
          countLabel={countLabel}
          exitLabel={labels.exitSelection}
          onExit={selection.clear}
        >
          {bulkButtons}
        </MobileSelectionBars>
      ) : null}
    </div>
  );
}
