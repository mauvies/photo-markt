'use client';

import { AlertTriangle } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { Button } from '@/components/ui/button';
import { discardFailedUploadsAction, retryFailedUploadsAction } from './actions';

export interface FailedUploadsNoticeLabels {
  /** Template for exactly one failed upload. */
  failedOne: string;
  /** Template for many failed uploads. `{n}`. */
  failedMany: string;
  retry: string;
  retrying: string;
  discard: string;
  discardTitle: string;
  /** `{n}` — how many photos the discard destroys. */
  discardDescription: string;
  discardConfirm: string;
  discardCancel: string;
  discardPending: string;
  /** `{n}` — how many were re-queued. */
  retryToast: string;
  /** `{n}` — how many were destroyed. */
  discardToast: string;
  error: string;
}

interface FailedUploadsNoticeProps {
  eventId: string;
  /** Photos in `upload_status='failed'` — server-counted for the whole event. */
  failedCount: number;
  labels: FailedUploadsNoticeLabels;
}

/**
 * Owner-side notice for uploads the worker could not finish (T-231).
 *
 * These photos are terminal: the run exhausted its retries before reaching a
 * verdict, and the reconcile cron deliberately leaves exhausted photos alone.
 * Their bytes are still in Storage, so both ways out are real — retry the
 * pipeline, or discard and free the quota. Before this existed the same photos
 * sat `pending` forever with no aviso and no affordance: invisible on the
 * public gallery, absent from the Pending tab, and silently re-queued every 30
 * minutes.
 *
 * Sibling of `PhotosProcessingNotice` (which covers the healthy in-flight case)
 * and renders nothing when there is nothing to report.
 */
export function FailedUploadsNotice({ eventId, failedCount, labels }: FailedUploadsNoticeProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [discardOpen, setDiscardOpen] = useState(false);

  if (failedCount <= 0) return null;

  const text = (failedCount === 1 ? labels.failedOne : labels.failedMany).replace(
    '{n}',
    String(failedCount),
  );

  const runRetry = () => {
    startTransition(async () => {
      try {
        const { count } = await retryFailedUploadsAction(eventId);
        toast.success(labels.retryToast.replace('{n}', String(count)));
        router.refresh();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : labels.error);
      }
    });
  };

  const runDiscard = () => {
    startTransition(async () => {
      try {
        const { count } = await discardFailedUploadsAction(eventId);
        toast.success(labels.discardToast.replace('{n}', String(count)));
        router.refresh();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : labels.error);
      }
    });
  };

  return (
    <>
      <div
        className="flex flex-col gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive sm:flex-row sm:items-center sm:justify-between"
        role="alert"
      >
        <div className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{text}</span>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button size="sm" variant="outline" onClick={runRetry} disabled={isPending}>
            {isPending ? labels.retrying : labels.retry}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setDiscardOpen(true)}
            disabled={isPending}
          >
            {labels.discard}
          </Button>
        </div>
      </div>
      <ConfirmDialog
        open={discardOpen}
        onOpenChange={setDiscardOpen}
        title={labels.discardTitle}
        description={labels.discardDescription.replace('{n}', String(failedCount))}
        confirmText={labels.discardConfirm}
        cancelText={labels.discardCancel}
        pendingText={labels.discardPending}
        onConfirm={runDiscard}
      />
    </>
  );
}
