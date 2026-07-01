'use client';

import { Loader2, Sparkles } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import type { BillingPeriod } from '@/lib/plans';
import { cn } from '@/lib/utils';
import { createBillingCheckoutAction } from '../billing/actions';

interface UpgradePlanButtonProps {
  planId: 'starter' | 'pro';
  period?: BillingPeriod;
  variant?: 'default' | 'outline';
  size?: 'sm' | 'lg';
  className?: string;
  /** Translated messages, fed from the parent server component's dict (this
   * subtree has no TranslationsProvider). */
  checkoutErrorLabel: string;
  yearlyUnavailableLabel: string;
}

export function UpgradePlanButton({
  planId,
  period = 'monthly',
  variant = 'default',
  size = 'sm',
  className,
  checkoutErrorLabel,
  yearlyUnavailableLabel,
}: UpgradePlanButtonProps) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const handleUpgrade = () => {
    startTransition(async () => {
      try {
        const result = await createBillingCheckoutAction(planId, period);

        if ('error' in result) {
          // Controlled domain error — map the stable code to a translated,
          // actionable toast (yearly-not-configured gets its own guidance).
          toast.error(
            result.error === 'yearly_unavailable' ? yearlyUnavailableLabel : checkoutErrorLabel,
          );
        } else if ('url' in result) {
          // Redirect to Stripe Checkout
          window.location.href = result.url;
        } else if (result.updated) {
          // Subscription was updated directly
          toast.success('Subscription updated successfully');
          router.refresh();
        }
      } catch {
        // Safety net for the internal Unauthorized/Invalid-plan guards (whose
        // messages Next redacts in prod) — show the generic translated toast.
        toast.error(checkoutErrorLabel);
      }
    });
  };

  return (
    <Button
      variant={variant}
      size={size}
      onClick={handleUpgrade}
      disabled={isPending}
      className={cn('h-11 px-4 sm:h-8 sm:px-3', className)}
    >
      {isPending ? (
        <>
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Processing...
        </>
      ) : (
        <>
          <Sparkles className="mr-2 h-4 w-4" />
          {planId === 'pro' ? 'Upgrade to Pro' : 'Upgrade to Starter'}
        </>
      )}
    </Button>
  );
}
