'use client';

import { Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { Button } from '@/components/ui/button';
import { cancelSubscriptionAction, reactivateSubscriptionAction } from '../billing/actions';

/**
 * Translated copy, fed from the billing page's server component — this subtree
 * has no TranslationsProvider, same as `BillingStatusToast` /
 * `AvailablePlansSection`.
 */
export interface SubscriptionActionLabels {
  cancel: string;
  dialogTitle: string;
  dialogBody: string;
  /** Rendered under the body, one line per exceeded Free limit. May be empty. */
  quotaWarnings: string[];
  dialogConfirm: string;
  dialogKeep: string;
  dialogPending: string;
  cancelSuccess: string;
  cancelError: string;
  /** Shown when the row points at a subscription Stripe no longer has. */
  subscriptionMissing: string;
  reactivate: string;
  reactivateSuccess: string;
  reactivateError: string;
}

/**
 * Cancel / reactivate the current paid subscription (T-214).
 *
 * Feedback is a direct `sonner` toast rather than a `?status=` code: those
 * codes exist for *redirect* returns (Stripe's cancel_url, the billing/resume
 * route), while these actions run in place — exactly like the in-place plan
 * change in `upgrade-plan-button.tsx`. Using `?status=cancelled` here would
 * also collide with that code's existing meaning (checkout abandoned).
 *
 * Both actions only ask Stripe; the row is written by the webhook, so
 * `router.refresh()` re-reads the server truth rather than this component
 * holding an optimistic copy of it.
 */
export function SubscriptionActions({
  pendingCancellation,
  labels,
}: {
  pendingCancellation: boolean;
  labels: SubscriptionActionLabels;
}) {
  const [isPending, startTransition] = useTransition();
  const [dialogOpen, setDialogOpen] = useState(false);
  const router = useRouter();

  const handleCancel = async () => {
    const result = await cancelSubscriptionAction();
    if ('error' in result) {
      // A missing Stripe subscription can never be retried into working, so it
      // gets copy that says what to do instead of "try again in a moment".
      toast.error(
        result.error === 'subscription_missing' ? labels.subscriptionMissing : labels.cancelError,
      );
      return;
    }
    toast.success(labels.cancelSuccess);
    router.refresh();
  };

  const handleReactivate = () => {
    startTransition(async () => {
      try {
        const result = await reactivateSubscriptionAction();
        if ('error' in result) {
          toast.error(
            result.error === 'subscription_missing'
              ? labels.subscriptionMissing
              : labels.reactivateError,
          );
          return;
        }
        toast.success(labels.reactivateSuccess);
        router.refresh();
      } catch {
        // Safety net for the `Unauthorized` throw, whose message Next redacts
        // in prod — show the generic translated toast.
        toast.error(labels.reactivateError);
      }
    });
  };

  if (pendingCancellation) {
    // Reactivating restores the status quo and charges nothing, so it gets no
    // confirmation — friction in the direction of keeping someone paying is
    // the dark pattern this feature is meant to avoid.
    return (
      <Button variant="outline" size="sm" onClick={handleReactivate} disabled={isPending}>
        {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        {labels.reactivate}
      </Button>
    );
  }

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setDialogOpen(true)}
        className="h-auto p-0 text-xs font-normal text-muted-foreground underline underline-offset-4 hover:bg-transparent hover:text-foreground"
      >
        {labels.cancel}
      </Button>
      <ConfirmDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title={labels.dialogTitle}
        description={
          <>
            {labels.dialogBody}
            {labels.quotaWarnings.map((warning) => (
              // `span`, not `p`: AlertDialogDescription already renders a <p>.
              <span key={warning} className="mt-2 block">
                {warning}
              </span>
            ))}
          </>
        }
        confirmText={labels.dialogConfirm}
        cancelText={labels.dialogKeep}
        pendingText={labels.dialogPending}
        onConfirm={handleCancel}
      />
    </>
  );
}
