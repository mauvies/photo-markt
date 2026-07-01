'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect } from 'react';
import { toast } from 'sonner';
import type { BillingPeriod } from '@/lib/plans';
import { createBillingCheckoutAction } from '../billing/actions';

interface UpgradeHandlerProps {
  /** Translated messages, fed from the parent server component's dict (this
   * subtree has no TranslationsProvider). */
  checkoutErrorMessage: string;
  yearlyUnavailableMessage: string;
}

/**
 * Client component to handle upgrade query parameter
 * Automatically triggers upgrade when ?upgrade=plan (with optional ?period=)
 * is in the URL — used after the post-signup redirect from the home page
 * pricing CTA so the right billing period is preserved.
 */
export function UpgradeHandler({
  checkoutErrorMessage,
  yearlyUnavailableMessage,
}: UpgradeHandlerProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const upgradePlan = searchParams.get('upgrade');
  const periodParam = searchParams.get('period');
  const period: BillingPeriod = periodParam === 'yearly' ? 'yearly' : 'monthly';

  useEffect(() => {
    if (upgradePlan && (upgradePlan === 'starter' || upgradePlan === 'pro')) {
      const handleUpgrade = async () => {
        try {
          const result = await createBillingCheckoutAction(
            upgradePlan as 'starter' | 'pro',
            period,
          );

          // Remove query parameter from URL
          router.replace('/dashboard/photographer/settings', { scroll: false });

          if ('error' in result) {
            // Controlled domain error — map the stable code to a translated,
            // actionable toast (yearly-not-configured gets its own guidance).
            toast.error(
              result.error === 'yearly_unavailable'
                ? yearlyUnavailableMessage
                : checkoutErrorMessage,
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
          toast.error(checkoutErrorMessage);
          // Remove query parameter even on error
          router.replace('/dashboard/photographer/settings', { scroll: false });
        }
      };

      void handleUpgrade();
    }
  }, [upgradePlan, period, router, checkoutErrorMessage, yearlyUnavailableMessage]);

  return null;
}
