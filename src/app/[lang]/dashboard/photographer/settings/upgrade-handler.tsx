'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect } from 'react';
import { toast } from 'sonner';
import type { BillingPeriod } from '@/lib/plans';
import { createBillingCheckoutAction } from '../billing/actions';

/**
 * Client component to handle upgrade query parameter
 * Automatically triggers upgrade when ?upgrade=plan (with optional ?period=)
 * is in the URL — used after the post-signup redirect from the home page
 * pricing CTA so the right billing period is preserved.
 */
export function UpgradeHandler() {
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

          if ('url' in result) {
            // Redirect to Stripe Checkout
            window.location.href = result.url;
          } else if (result.updated) {
            // Subscription was updated directly
            toast.success('Subscription updated successfully');
            router.refresh();
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Failed to start checkout';
          toast.error(message);
          // Remove query parameter even on error
          router.replace('/dashboard/photographer/settings', { scroll: false });
        }
      };

      void handleUpgrade();
    }
  }, [upgradePlan, period, router]);

  return null;
}
