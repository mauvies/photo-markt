'use client';

import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import type { UploadStage } from '@/lib/use-photo-upload';

export type UploadProgressLabels = {
  /** Dialog title across all stages. */
  title: string;
  preparing: string;
  /** Template — `{current}` and `{total}` are replaced with completed/total counts. */
  uploading: string;
  finalizing: string;
  done: string;
  /** Template — `{count}` is replaced with the failed-count. */
  partialFailed: string;
  /** Generic error sub-line; rendered as `subline ?? errorMessage`. */
  errorTitle: string;
  cancelButton: string;
  closeButton: string;
  retryFailedButton: string;
};

interface UploadProgressDialogProps {
  /**
   * Stage drives both visibility (mount/unmount) and rendered content.
   * The dialog is unmounted entirely on `idle`, `done`, and `cancelled` —
   * we deliberately don't toggle the Radix `open` prop, because Radix's
   * body-style cleanup (`pointer-events`, scroll lock) only runs at the
   * end of the close animation; if the parent unmounts mid-animation
   * (typical right after `router.push`), the overlay can be left dimming
   * the destination route. Hard-unmount sidesteps the race entirely.
   */
  stage: UploadStage;
  progressBytes: number;
  totalBytes: number;
  completedCount: number;
  totalCount: number;
  failedCount: number;
  errorMessage: string | null;
  labels: UploadProgressLabels;
  onCancel?: () => void;
  onRetryFailed?: () => void;
  onClose?: () => void;
}

export function UploadProgressDialog({
  stage,
  progressBytes,
  totalBytes,
  completedCount,
  totalCount,
  failedCount,
  errorMessage,
  labels,
  onCancel,
  onRetryFailed,
  onClose,
}: UploadProgressDialogProps) {
  // Mount only when the dialog should be visible. `done` / `idle` /
  // `cancelled` collapse to no-op — see prop docs above.
  if (
    stage !== 'preparing' &&
    stage !== 'uploading' &&
    stage !== 'finalizing' &&
    stage !== 'partial-failed' &&
    stage !== 'error'
  ) {
    return null;
  }
  const percent = totalBytes > 0 ? Math.min(99, Math.floor((progressBytes / totalBytes) * 100)) : 0;

  const renderStageLine = () => {
    switch (stage) {
      case 'preparing':
        return labels.preparing;
      case 'uploading':
        return labels.uploading
          .replace('{current}', String(completedCount))
          .replace('{total}', String(totalCount));
      case 'finalizing':
        return labels.finalizing;
      case 'partial-failed':
        return labels.partialFailed.replace('{count}', String(failedCount));
      case 'error':
        return errorMessage ?? labels.errorTitle;
      // `done` / `idle` / `cancelled` never reach this — the component
      // returns null above for those stages.
      default:
        return null;
    }
  };

  const isActive = stage === 'preparing' || stage === 'uploading' || stage === 'finalizing';
  // `isTerminal` here means "terminal but the user still has business in
  // the dialog" (retry / acknowledge). True success ('done') unmounts
  // before this code path runs.
  const isTerminal = stage === 'partial-failed' || stage === 'error';

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        // Don't allow closing while uploads are still in flight — use Cancel.
        if (!next && isTerminal) onClose?.();
      }}
    >
      <DialogContent
        className="max-w-sm"
        onPointerDownOutside={(e) => {
          if (isActive) e.preventDefault();
        }}
        onEscapeKeyDown={(e) => {
          if (isActive) e.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>{labels.title}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            {isActive ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : null}
            <p className="text-sm text-muted-foreground">{renderStageLine()}</p>
          </div>
          {isActive && totalBytes > 0 ? <Progress value={percent} className="h-2" /> : null}
          <div className="flex items-center justify-end gap-2 pt-2">
            {isActive && onCancel ? (
              <Button type="button" variant="outline" size="sm" onClick={onCancel}>
                {labels.cancelButton}
              </Button>
            ) : null}
            {stage === 'partial-failed' && onRetryFailed ? (
              <Button type="button" size="sm" onClick={onRetryFailed}>
                {labels.retryFailedButton.replace('{count}', String(failedCount))}
              </Button>
            ) : null}
            {isTerminal && onClose ? (
              <Button type="button" variant="outline" size="sm" onClick={onClose}>
                {labels.closeButton}
              </Button>
            ) : null}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
