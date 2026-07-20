'use client';

import { ArrowRight, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { createBillingCheckoutAction } from '@/app/[lang]/dashboard/photographer/billing/actions';
import { Button } from '@/components/ui/button';
import { useLocalizedPath } from '@/hooks/use-localized-path';
import type { BillingPeriod } from '@/lib/plans';

interface PricingPlanButtonProps {
  planId: 'free' | 'starter' | 'pro';
  isFree: boolean;
  isAuthenticated?: boolean;
  /** Billing period the toggle currently has selected. Defaults to monthly
   * for callers that haven't been migrated yet. */
  period?: BillingPeriod;
  label: string;
  loadingLabel: string;
  className?: string;
}

export function PricingPlanButton({
  planId,
  isFree,
  isAuthenticated = false,
  period = 'monthly',
  label,
  loadingLabel,
  className,
}: PricingPlanButtonProps) {
  const router = useRouter();
  const lp = useLocalizedPath();
  const [isPending, startTransition] = useTransition();
  const isStarter = planId === 'starter';

  if (isFree) {
    return (
      // Carry the Free intent through signup so the flow is symmetric with the
      // paid CTAs; resolves to the dashboard overview (no subscription row).
      <Link href={lp('/signup?plan=free')} className={className}>
        <Button
          variant="outline"
          size="lg"
          className="w-full justify-center gap-2 text-sm font-medium tracking-tight"
        >
          {label}
          <ArrowRight className="h-4 w-4" />
        </Button>
      </Link>
    );
  }

  const buttonClassName = [
    'w-full justify-center gap-2 text-sm font-medium tracking-tight',
    isStarter
      ? 'bg-gradient-starter text-white hover:opacity-90 transition-opacity'
      : 'bg-primary text-primary-foreground hover:bg-primary/90',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  if (!isAuthenticated) {
    return (
      <Link href={lp(`/signup?plan=${planId}&period=${period}`)} className={className}>
        <Button variant="default" size="lg" className={buttonClassName}>
          {label}
          <ArrowRight className="h-4 w-4" />
        </Button>
      </Link>
    );
  }

  const handleUpgrade = () => {
    startTransition(async () => {
      try {
        const result = await createBillingCheckoutAction(planId as 'starter' | 'pro', period);
        if ('error' in result) {
          // Checkout couldn't start (Stripe failure or yearly not configured).
          // Fall back to the signup flow preserving plan/period — same as the
          // prior behavior when these failures threw.
          router.push(lp(`/signup?plan=${planId}&period=${period}`));
        } else if ('url' in result) {
          window.location.href = result.url;
        } else if (result.updated) {
          router.push(lp('/dashboard/photographer/settings?updated=true'));
        }
      } catch (error) {
        console.error('Checkout error:', error);
        router.push(lp(`/signup?plan=${planId}&period=${period}`));
      }
    });
  };

  return (
    <Button
      variant="default"
      size="lg"
      onClick={handleUpgrade}
      disabled={isPending}
      className={buttonClassName}
    >
      {isPending ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" />
          {loadingLabel}
        </>
      ) : (
        <>
          {label}
          <ArrowRight className="h-4 w-4" />
        </>
      )}
    </Button>
  );
}
