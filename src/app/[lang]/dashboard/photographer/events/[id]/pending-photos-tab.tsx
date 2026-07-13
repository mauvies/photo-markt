'use client';

import { Check, X } from 'lucide-react';
import Image from 'next/image';
import { type ReactNode, useMemo, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { PhotoSelectionToolbar } from '@/components/photo-selection-toolbar';
import { Button } from '@/components/ui/button';
import { usePhotoSelection } from '@/hooks/use-photo-selection';
import { cn } from '@/lib/utils';
import { approvePendingPhotosAction, rejectPendingPhotosAction } from './actions';

type PendingPhoto = {
  id: string;
  url: string;
  uploaderLabel: string;
};

export type PendingPhotosLabels = {
  empty: string;
  approveAria: string;
  rejectAria: string;
  select: string;
  exitSelection: string;
  countOne: string;
  /** Template with `{n}`. */
  countMany: string;
  approveAll: string;
  approveSelected: string;
  rejectSelected: string;
  rejectConfirmTitle: string;
  /** Template with `{n}`. */
  rejectConfirmTitleMany: string;
  rejectConfirmDescription: string;
  /** Template with `{n}`. */
  rejectConfirmDescriptionMany: string;
  rejectConfirmAction: string;
  rejectConfirmCancel: string;
  rejectConfirmPending: string;
  approveSuccessOne: string;
  /** Template with `{n}`. */
  approveSuccessMany: string;
  rejectSuccessOne: string;
  /** Template with `{n}`. */
  rejectSuccessMany: string;
  actionError: string;
};

type PendingPhotosTabProps = {
  eventId: string;
  photos: PendingPhoto[];
  labels: PendingPhotosLabels;
  /** Node for the toolbar's left slot (same row as "Select") — the
   * Approved/Pending tab switcher, shown even when the queue is empty so the
   * owner can switch back (T-113). */
  toolbarLeading?: ReactNode;
};

const withCount = (template: string, n: number) => template.replace('{n}', String(n));

export function PendingPhotosTab({
  eventId,
  photos,
  labels,
  toolbarLeading,
}: PendingPhotosTabProps) {
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [isPending, startTransition] = useTransition();
  const selection = usePhotoSelection();
  // Ids queued for rejection — non-empty opens the confirmation dialog.
  const [rejectTargets, setRejectTargets] = useState<string[]>([]);

  const visible = useMemo(() => photos.filter((p) => !removed.has(p.id)), [photos, removed]);

  if (visible.length === 0) {
    // Keep the tab switcher (toolbarLeading) on screen even with an empty queue,
    // so the owner can switch back to Approved. No Select here — nothing to
    // select (T-113). Standalone usage (no switcher) keeps the plain message.
    return (
      <div className="space-y-1">
        {toolbarLeading ? (
          <PhotoSelectionToolbar
            isSelecting={false}
            countLabel=""
            selectLabel={labels.select}
            exitLabel={labels.exitSelection}
            onStartSelecting={() => {}}
            onClear={() => {}}
            selectable={false}
            leading={toolbarLeading}
          />
        ) : null}
        <p className="rounded-lg border border-dashed border-input p-6 text-center text-sm text-muted-foreground">
          {labels.empty}
        </p>
      </div>
    );
  }

  const selectedIds = selection.selectedIds.filter((id) => !removed.has(id));

  const finish = (ids: string[]) => {
    setRemoved((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.add(id);
      return next;
    });
    selection.clear();
  };

  const runApprove = (ids: string[]) => {
    if (ids.length === 0) return;
    startTransition(async () => {
      try {
        await approvePendingPhotosAction(ids, eventId);
        finish(ids);
        toast.success(
          ids.length === 1
            ? labels.approveSuccessOne
            : withCount(labels.approveSuccessMany, ids.length),
        );
      } catch (error) {
        console.error('Approve failed', error);
        toast.error(labels.actionError);
      }
    });
  };

  // Reject goes through the confirmation dialog (hard delete, no undo). The
  // dialog owns its pending state; we surface success/error via toast.
  const confirmReject = async () => {
    const ids = rejectTargets;
    try {
      await rejectPendingPhotosAction(ids, eventId);
      finish(ids);
      setRejectTargets([]);
      toast.success(
        ids.length === 1
          ? labels.rejectSuccessOne
          : withCount(labels.rejectSuccessMany, ids.length),
      );
    } catch (error) {
      console.error('Reject failed', error);
      toast.error(labels.actionError);
      throw error; // keep the dialog open so the owner can retry
    }
  };

  const countLabel =
    selectedIds.length === 1 ? labels.countOne : withCount(labels.countMany, selectedIds.length);

  const rejectCount = rejectTargets.length;

  const bulkButtons = (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={selectedIds.length === 0 || isPending}
        onClick={() => runApprove(selectedIds)}
      >
        <Check className="mr-2 h-4 w-4" />
        {labels.approveSelected}
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={selectedIds.length === 0 || isPending}
        onClick={() => setRejectTargets(selectedIds)}
      >
        <X className="mr-2 h-4 w-4" />
        {labels.rejectSelected}
      </Button>
    </>
  );

  return (
    <div className="space-y-1">
      <PhotoSelectionToolbar
        isSelecting={selection.isSelecting}
        countLabel={countLabel}
        selectLabel={labels.select}
        exitLabel={labels.exitSelection}
        onStartSelecting={selection.startSelecting}
        onClear={selection.clear}
        leading={
          // Tab switcher (when present) then "Approve all", left of "Select".
          <div className="flex items-center gap-3">
            {toolbarLeading}
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isPending}
              onClick={() => runApprove(visible.map((p) => p.id))}
            >
              <Check className="mr-2 h-4 w-4" />
              {labels.approveAll}
            </Button>
          </div>
        }
      >
        {bulkButtons}
      </PhotoSelectionToolbar>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {visible.map((photo) => {
          const isSelected = selectedIds.includes(photo.id);
          return (
            <div
              key={photo.id}
              className={cn(
                'group relative aspect-square overflow-hidden rounded-lg border border-input bg-muted',
                isSelected && 'ring-2 ring-primary ring-offset-2 ring-offset-background',
              )}
            >
              <Image
                src={photo.url}
                alt={photo.uploaderLabel}
                fill
                sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 20vw"
                className={cn('object-cover', isSelected && 'opacity-90')}
              />
              <div className="pointer-events-none absolute inset-x-0 top-0 bg-gradient-to-b from-black/70 to-transparent p-2 text-xs text-white">
                {photo.uploaderLabel}
              </div>

              {selection.isSelecting ? (
                // A full-tile toggle button in selection mode (real <button> so
                // aria-pressed + keyboard activation are native, no interactive
                // div). Its accessible name is the uploader label.
                <button
                  type="button"
                  aria-pressed={isSelected}
                  aria-label={photo.uploaderLabel}
                  onClick={() => selection.toggle(photo.id)}
                  className="absolute inset-0 flex cursor-pointer items-start justify-end p-2"
                >
                  <span
                    className={cn(
                      'flex size-6 items-center justify-center rounded-full border-2 transition-colors',
                      isSelected
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-white/80 bg-black/30',
                    )}
                  >
                    {isSelected ? <Check className="h-4 w-4" /> : null}
                  </span>
                </button>
              ) : (
                // Per-tile actions: always visible on touch, hover-revealed on
                // desktop (touch target stays 36px). Approve = solid check,
                // reject = muted — no loud red/green.
                <div className="absolute inset-x-0 bottom-0 flex items-center justify-end gap-1.5 p-2 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100">
                  <Button
                    type="button"
                    size="icon"
                    variant="default"
                    onClick={() => runApprove([photo.id])}
                    disabled={isPending}
                    aria-label={labels.approveAria}
                    className="size-9"
                  >
                    <Check className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="secondary"
                    onClick={() => setRejectTargets([photo.id])}
                    disabled={isPending}
                    aria-label={labels.rejectAria}
                    className="size-9"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {selection.isSelecting ? (
        // Mobile: bulk actions in a fixed bar over the bottom nav; desktop shows
        // them inline in the toolbar above (CSS hides one).
        <div className="fixed inset-x-0 bottom-0 z-[60] flex min-h-16 items-center gap-2 overflow-x-auto border-t border-border bg-background/95 px-3 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {bulkButtons}
        </div>
      ) : null}

      <ConfirmDialog
        open={rejectCount > 0}
        onOpenChange={(open) => {
          if (!open) setRejectTargets([]);
        }}
        title={
          rejectCount === 1
            ? labels.rejectConfirmTitle
            : withCount(labels.rejectConfirmTitleMany, rejectCount)
        }
        description={
          rejectCount === 1
            ? labels.rejectConfirmDescription
            : withCount(labels.rejectConfirmDescriptionMany, rejectCount)
        }
        confirmText={labels.rejectConfirmAction}
        cancelText={labels.rejectConfirmCancel}
        pendingText={labels.rejectConfirmPending}
        onConfirm={confirmReject}
      />
    </div>
  );
}
